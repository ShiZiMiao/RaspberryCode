/**
 * Host 创建者（creator）。
 *
 * 职责单一：**拉起 host 并保持它活着**，自己不做任何 UIA 调用。
 *
 * 为什么需要单独一个进程来「保持」：
 * 子会话的生命周期绑定在持有它的进程上（spec §1.24 观察到 WorkBuddy 的
 * creator 就是这个角色）。creator 进程退出，会话随之注销，里面的 host 也就没了。
 * 把「保持」与「执行」分开以后，host 崩溃可以重启而会话不丢。
 *
 * 本实现的范围：
 * - **同会话**：creator 直接 spawn host，转发它的就绪信号，之后只做看护
 * - **跨会话**：先尝试 `spawnHelperInSession`，成功则等 host 回报管道地址；
 *   失败（本机必然如此）就把原因作为结构化事件输出，退出码非零
 *
 * 不做的事：不尝试提权。拿 `SeTcbPrivilege` 那条链（schtasks / 借 winlogon 令牌）
 * 等于整机最高权限，本实现明确不做——理由见 §1.23。
 *
 * 输出协议：单行 JSON 事件，写 stdout。主进程按行解析：
 *   {"event":"creator_starting","mode":"same_session",...}
 *   {"event":"host_spawned","pid":123,...}
 *   {"event":"host_ready","socket":"...","sessionId":1,...}   ← 原样转发 host 的
 *   {"event":"creator_failed","code":"...","message":"..."}
 *   {"event":"creator_stopped","reason":"...","uptimeMs":...}
 */

import { spawn, type ChildProcess } from "node:child_process";
import { currentSession } from "./session.ts";
import { spawnHelperInSession } from "./session-spawn.ts";
import { createBootstrapChannel } from "./address-broker.ts";

/**
 * 等待跨会话 host 回报地址的上限。
 *
 * 比同会话的启动超时更长：跨会话要走进另一个桌面、初始化 UIA、
 * 再反向连管道，每一步都比同会话慢。但这个值也不能太大——
 * 卡住时用户需要一个明确的失败，而不是一直转圈。
 */
const CROSS_SESSION_HANDSHAKE_TIMEOUT_MS = 30_000;

interface CreatorOptions {
  /** host 入口脚本。 */
  entryPath: string;
  /** 启动 host 用的可执行文件。默认当前进程。 */
  command: string;
  /** 目标会话。省略表示当前会话。 */
  targetSessionId: number | undefined;
  /** host 空闲超时（ms）。 */
  idleTimeoutMs: number;
}

function parseArgs(argv: string[]): CreatorOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(key, next);
      i += 1;
    } else {
      values.set(key, "true");
    }
  }

  const entryPath = values.get("host-entry");
  if (!entryPath) {
    throw new Error("missing required argument: --host-entry <path>");
  }

  const idleRaw = values.get("idle-timeout");
  const idleTimeoutMs = idleRaw ? Number.parseInt(idleRaw, 10) : 10 * 60 * 1000;

  const targetRaw = values.get("target-session");
  const parsedTarget = targetRaw ? Number.parseInt(targetRaw, 10) : Number.NaN;

  return {
    entryPath,
    command: values.get("command") ?? process.execPath,
    targetSessionId: Number.isInteger(parsedTarget) ? parsedTarget : undefined,
    idleTimeoutMs: Number.isInteger(idleTimeoutMs) && idleTimeoutMs > 0 ? idleTimeoutMs : 600_000,
  };
}

function emit(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

const startedAt = Date.now();
let host: ChildProcess | undefined;
let stopping = false;

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const here = currentSession();
  const target = options.targetSessionId ?? here;

  emit({
    event: "creator_starting",
    mode: target === here ? "same_session" : "cross_session",
    currentSession: here,
    targetSession: target,
    entryPath: options.entryPath,
  });

  if (target !== here) {
    startCrossSession(options, target);
    return;
  }

  startSameSession(options, target);
}

/**
 * 跨会话启动。
 *
 * 两条回传通道的区别：
 * - 同会话：host 的 stdout 归本进程管，就绪事件里带着地址，直接转发
 * - 跨会话：host 由 `CreateProcessAsUser` 直接创建，**没有连到本进程的 stdout**，
 *   所以改用引导管道——本进程先建一个名字可预测的管道传给 host，
 *   host 起来后连上它报自己的地址。
 *
 * 若 `spawnHelperInSession` 失败（本机因缺 `SeTcbPrivilege` 必然如此），
 * 输出结构化原因后退出——**不降级到当前会话**。静默降级会让调用方
 * 以为 host 在目标会话里，而实际在别的桌面，观察结果全错。
 */
function startCrossSession(options: CreatorOptions, target: number): void {
  // 先建引导管道：必须在 spawn 之前，否则 host 连不上。
  const bootstrap = createBootstrapChannel();

  const attempt = spawnHelperInSession({
    exePath: options.command,
    args: [
      options.entryPath,
      // 不指定 --socket：跨会话时主进程无法预先建业务管道
      //（句柄不能跨会话继承），host 自己生成并回报。
      "--parent-pid",
      String(process.pid),
      "--idle-timeout",
      String(options.idleTimeoutMs),
      "--target-session",
      String(target),
      "--bootstrap",
      bootstrap.name,
    ],
    sessionId: target,
  });

  if (!attempt.ok) {
    bootstrap.close();
    emit({
      event: "creator_failed",
      code: attempt.reason ?? "spawn_failed",
      message: attempt.message,
      targetSession: target,
      currentSession: currentSession(),
    });
    // 非零退出：让调用方明确区分「没起来」与「起来了但没握手」。
    process.exitCode = 2;
    return;
  }

  emit({
    event: "host_spawned",
    pid: attempt.processId,
    sessionId: attempt.sessionId,
    note: "跨会话启动成功；等待 host 经引导管道回报地址",
  });

  // 等 host 报地址。超时即失败——不要无限等，那会让启动流程卡住而无线索。
  void bootstrap
    .waitForAddress(CROSS_SESSION_HANDSHAKE_TIMEOUT_MS)
    .then((report) => {
      // 把 host 的回报当成一条 helper_ready 转发出去，
      // 让客户端只认一种事件格式，不必区分两种启动方式。
      emit({
        event: "helper_ready",
        socket: report.socket,
        pid: report.pid,
        parentPid: process.pid,
        sessionId: report.sessionId,
        protocolVersion: report.protocolVersion ?? null,
        targetSessionId: target,
        creatorPid: process.pid,
        viaBootstrap: true,
      });
      bootstrap.close();
    })
    .catch((error: unknown) => {
      bootstrap.close();
      emit({
        event: "creator_failed",
        code: "bootstrap_timeout",
        message:
          `host 已启动（pid=${attempt.processId}）但未能在 ` +
          `${CROSS_SESSION_HANDSHAKE_TIMEOUT_MS}ms 内回报管道地址：` +
          `${error instanceof Error ? error.message : String(error)}`,
        targetSession: target,
      });
      process.exitCode = 3;
    });
}

/** 同会话启动：完全可用，stdout 可转发。 */
function startSameSession(options: CreatorOptions, target: number): void {
  host = spawn(
    options.command,
    [
      options.entryPath,
      "--parent-pid",
      String(process.pid),
      "--idle-timeout",
      String(options.idleTimeoutMs),
      "--target-session",
      String(target),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
    },
  );

  if (!host.pid) {
    emit({
      event: "creator_failed",
      code: "spawn_failed",
      message: "host 进程创建失败（无 pid）",
    });
    process.exitCode = 2;
    return;
  }

  emit({ event: "host_spawned", pid: host.pid, sessionId: target });

  // 转发 host 的就绪信号与其他事件。主进程靠这一路拿到管道地址。
  host.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (parsed.event === "helper_ready") {
          // 原样转发，但补上 creator 自己的 pid，
          // 让主进程知道「这个 host 是哪个 creator 带的」。
          emit({ ...parsed, creatorPid: process.pid });
        }
      } catch {
        // host 的非 JSON 输出（栈跟踪等）直接透传，
        // 排查时它是唯一线索，丢掉等于自断后路。
        process.stderr.write(`${trimmed}\n`);
      }
    }
  });

  host.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

  host.on("exit", (code, signal) => {
    if (stopping) return;
    // host 意外退出：如实报告并退出。
    // 不自动重启——宿主反复崩溃是真问题，掩盖它只会让排查更难。
    emit({
      event: "creator_failed",
      code: "host_exited",
      message: `host 意外退出（code=${code ?? "null"}, signal=${signal ?? "null"}）`,
      uptimeMs: Date.now() - startedAt,
    });
    process.exitCode = 4;
  });

  host.on("error", (error) => {
    emit({
      event: "creator_failed",
      code: "host_error",
      message: error.message,
    });
    process.exitCode = 5;
  });
}

function shutdown(reason: string): void {
  if (stopping) return;
  stopping = true;
  emit({
    event: "creator_stopped",
    reason,
    uptimeMs: Date.now() - startedAt,
  });
  // creator 退出必须连带结束 host：否则 host 会因为 parent-gone 自行退出，
  // 但那要等 5 秒的看护间隔，期间它还占着管道。
  if (host && !host.killed) {
    host.kill();
  }
}

process.on("SIGTERM", () => shutdown("sigterm"));
process.on("SIGINT", () => shutdown("sigint"));

// 注意：**不要监听 stdin 的 end**。
//
// 曾经在这里挂 `process.stdin.on("end")` 当「上家不要我了」的信号，
// 结果 creator 一启动就退出：父进程用 `stdio: ["ignore", ...]` 启动时
// stdin 立刻是 EOF，`end` 在 main() 之前就到了，于是 shutdown 把刚拉起的
// host 一起杀掉，主进程只看到 `code=0` 的「启动前退出」。
//
// 父进程死亡的检测已经由 host 侧的 parent-pid 看护覆盖，
// 不需要再加一条会被误触发的捷径。

main();
