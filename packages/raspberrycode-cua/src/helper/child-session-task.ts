/**
 * 子会话计划任务。
 *
 * 这是**让子会话出现**的正确途径。详见
 * `docs/cua/2026-11-19-child-session-task.md`。
 *
 * ## 核心机制（实测确认）
 *
 * 子会话**不是靠 RDP 登录创建的**，而是靠「在会话里跑起一个进程」。
 * 实测 WorkBuddy 的计划任务：
 *
 * ```
 * Principal: lecoo / LogonType=Interactive / RunLevel=Limited   ← 不是 SYSTEM
 * Action:    conhost.exe --headless <cu.exe> --child-host-launcher
 * Triggers:  TaskLogonTrigger + TaskSessionStateChangeTrigger
 * ```
 *
 * 运行后子会话 #6 出现，host 进程的 `SessionId=6`，
 * 且 **3389 始终未监听、`ClientProtocolType=0`（非 RDP 协议）**。
 *
 * ## 为什么不走 RDP
 *
 * `WinStationCreateChildSessionTransport` 返回的管道实测「可写但服务端不响应」
 * （X.224 CR 写进去 19 字节，15 秒零响应）。FreeRDP 用的是同一根管道，
 * 因此同样无解。计划任务这条路绕开了整个 RDP 协议栈。
 *
 * ## 为什么不提权
 *
 * 普通用户可以创建**自己的**计划任务，不需要管理员。
 * 实测 WorkBuddy 的任务主体是 `lecoo` + `RunLevel=Limited`。
 *
 * 这一点很重要：它意味着本模块不需要用户点 UAC，也不需要 SYSTEM。
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import koffi from "koffi";

/** 计划任务操作结果。 */
export interface TaskOperationResult {
  ok: boolean;
  code?:
    | "schtasks_unavailable"
    | "access_denied"
    | "task_not_found"
    | "invalid_definition"
    | "timeout"
    | "unknown";
  /** 原始错误信息（排查用）。 */
  detail?: string;
  message: string;
}

/** 任务状态。 */
export interface TaskStatus {
  exists: boolean;
  /** `schtasks` 报的状态字（Ready / Running / Disabled…）。 */
  state?: string;
}

/** 注册任务所需的一切。 */
export interface ChildSessionTaskDefinition {
  /** 任务名。建议加前缀避免与其他软件冲突。 */
  taskName: string;
  /** host 可执行文件路径。 */
  hostExePath: string;
  /** 传给 host 的参数。 */
  hostArgs: string[];
  /** 可选描述。 */
  description?: string;
  /**
   * 触发器绑定的用户（`DOMAIN\user` 形式）。
   *
   * 必须显式指定：不指定时任务会对所有用户生效，
   * 而 `SessionStateChangeTrigger` 需要一个具体用户才能把任务
   * 投进该用户的会话。
   */
  userId?: string;
}

/** `ensureChildSession` 的结果。 */
export interface EnsureChildSessionResult {
  ok: boolean;
  /** 子会话号（成功时）。 */
  sessionId?: number;
  /**
   * 本次是否**新建**会话。
   *
   * `false` 表示复用了调用前已存在的会话——那不是本实现的产物，
   * 上层清理时不该注销它。
   */
  created: boolean;
  reason?:
    | "task_register_failed"
    | "task_run_failed"
    | "session_timeout"
    | "session_preexisting";
  message: string;
}

// ---------------------------------------------------------------------------
// schtasks 调用
// ---------------------------------------------------------------------------

/**
 * 「schtasks 不可用」的错误特征。
 *
 * Windows 上找不到可执行文件时 Node 抛 `ENOENT`；
 * 被安全策略拦截时抛别的错误（实测 WorkBuddy 的沙箱给的是
 * `spawnSync schtasks EPERM`）。两者都要能识别，否则会把
 * 「被拦」误报成「不存在」。
 */
function classifySpawnError(error: unknown): TaskOperationResult {
  const err = error as NodeJS.ErrnoException;
  const code = err?.code ?? "";
  const stderr = stderrOf(error);

  if (code === "ENOENT") {
    return {
      ok: false,
      code: "schtasks_unavailable",
      detail: "找不到 schtasks.exe",
      message: "系统里找不到 schtasks.exe，无法使用计划任务。",
    };
  }
  if (code === "EPERM" || code === "EACCES" || /denied|拒绝访问/i.test(stderr)) {
    return {
      ok: false,
      code: "access_denied",
      detail: stderr || code,
      message:
        "无权限执行 schtasks。可能被安全策略拦截，或当前用户无权创建计划任务。",
    };
  }
  return {
    ok: false,
    code: "unknown",
    detail: stderr || (err?.message ?? String(error)),
    message: `schtasks 调用失败：${stderr || err?.message || String(error)}`,
  };
}

/**
 * 跑一次 schtasks，返回 stdout。
 *
 * **不指定 `encoding`**：schtasks 的输出是系统 ANSI 代码页（中文系统上是
 * GBK），按 utf8 解码会得到 `����`，任何基于文本的判断全部失效。
 * 这里拿 Buffer 再按 GBK 解码。
 */
function runSchtasks(args: string[]): { stdout: string; stderr: string } {
  const result = execFileSync("schtasks", args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 30_000,
  });
  return {
    stdout: decodeAnsi(result as Buffer),
    stderr: "",
  };
}

/**
 * 按系统 ANSI 代码页解码。
 *
 * 中文 Windows 上 schtasks 输出 GBK。Node 的 `TextDecoder` 支持 gbk
 * （ICU 内置），所以不用引第三方库。
 *
 * 解码失败时退回 utf8 —— 宁可得到部分乱码，也不要抛错让整个调用失败。
 */
function decodeAnsi(buffer: Buffer): string {
  try {
    return new TextDecoder("gbk").decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

/** 从 execFileSync 抛出的错误里取出 stderr 并解码。 */
function stderrOf(error: unknown): string {
  const err = error as { stderr?: Buffer | string };
  if (!err?.stderr) return "";
  return typeof err.stderr === "string" ? err.stderr : decodeAnsi(err.stderr);
}

// ---------------------------------------------------------------------------
// 任务 XML
// ---------------------------------------------------------------------------

/**
 * 取当前用户的 `DOMAIN\user` 形式标识。
 *
 * 计划任务的触发器需要它才把任务投进这个用户的会话。
 * 取不到时返回空串——那会让触发器对所有用户生效，
 * 在单用户机器上通常仍能工作，但不够精确。
 */
function currentUserIdentity(): string {
  const fromEnv = process.env.USERDOMAIN && process.env.USERNAME
    ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
    : "";
  return fromEnv;
}

/**
 * 构造计划任务的 XML 定义。
 *
 * 为什么用 XML 而不是 `schtasks /Create` 的命令行参数：
 * 命令行不支持 `SessionStateChange` 触发器，也不方便设
 * `ExecutionTimeLimit=PT0S`（不限时）。这两项都是 host 长期驻留必需的。
 *
 * **编码必须是 UTF-16LE 且带 BOM**：`schtasks /XML` 要求如此，
 * 用 UTF-8 会被拒绝并报 `ERROR: The task XML is malformed`。
 */
function buildTaskXml(definition: ChildSessionTaskDefinition): string {
  const escapeXml = (text: string): string =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const args = definition.hostArgs.map(escapeXml).join(" ");
  const description = escapeXml(
    definition.description ??
      "RaspberryCode 隔离桌面宿主。此任务由应用自动注册，用于在独立会话中运行助手进程。",
  );

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${description}</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${escapeXml(definition.userId ?? currentUserIdentity())}</UserId>
    </LogonTrigger>
    <SessionStateChangeTrigger>
      <Enabled>true</Enabled>
      <!-- RemoteConnect 是这个方案的枢纽：它在「远程连接建立」时触发，
           把任务投进**新产生的那个会话**。实测 WorkBuddy 用的就是它。
           换成 SessionUnlock 之类不会把进程送进子会话。 -->
      <StateChange>RemoteConnect</StateChange>
      <UserId>${escapeXml(definition.userId ?? currentUserIdentity())}</UserId>
    </SessionStateChangeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <DisallowStartOnRemoteAppSession>false</DisallowStartOnRemoteAppSession>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>conhost.exe</Command>
      <Arguments>--headless "${escapeXml(definition.hostExePath)}" ${args}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------

/**
 * 注册（或覆盖）子会话计划任务。幂等。
 *
 * 用 `/Create /F`（force）覆盖，因此重复调用不会报「已存在」。
 * 这不只是方便：升级应用后 host 路径可能变，覆盖能自动跟上。
 */
export function registerChildSessionTask(
  definition: ChildSessionTaskDefinition,
): TaskOperationResult {
  if (!definition.taskName.trim()) {
    return {
      ok: false,
      code: "invalid_definition",
      message: "任务名不能为空。",
    };
  }
  if (!definition.hostExePath.trim()) {
    return {
      ok: false,
      code: "invalid_definition",
      message: "host 可执行文件路径不能为空。",
    };
  }

  const xml = buildTaskXml(definition);
  // schtasks /XML 要求 UTF-16LE + BOM
  const xmlBuffer = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(xml, "utf16le"),
  ]);

  // 写临时文件：schtasks 只接受文件路径，不接受 stdin
  const xmlPath = join(tmpdir(), `raspberrycode-task-${process.pid}-${Date.now()}.xml`);

  try {
    writeFileSync(xmlPath, xmlBuffer);
    runSchtasks(["/Create", "/TN", definition.taskName, "/XML", xmlPath, "/F"]);
    return { ok: true, message: `计划任务 ${definition.taskName} 已注册。` };
  } catch (error) {
    const classified = classifySpawnError(error);
    // 注册阶段的失败若表现为「XML 格式错误」，归到 invalid_definition——
    // 那通常意味着路径里有 schtasks 不接受的字符
    if (/XML|malformed/i.test(classified.detail ?? "")) {
      return {
        ok: false,
        code: "invalid_definition",
        detail: classified.detail,
        message:
          "任务 XML 被拒绝。常见原因：路径含特殊字符，或 conhost.exe 不存在。",
      };
    }
    return {
      ...classified,
      message: `注册计划任务失败：${classified.message}`,
    };
  } finally {
    try {
      unlinkSync(xmlPath);
    } catch {
      // 临时文件清理失败不影响结果
    }
  }
}

/** 查询任务是否存在。 */
export function queryChildSessionTask(taskName: string): TaskStatus {
  try {
    const { stdout } = runSchtasks(["/Query", "/TN", taskName, "/FO", "LIST"]);
    // 「状态:  就绪」/「Status:  Ready」两种语言都匹配
    const match = /(?:状态|Status)\s*[:：]\s*(\S+)/i.exec(stdout);
    return { exists: true, state: match?.[1] };
  } catch {
    return { exists: false };
  }
}

/** 立即运行任务。不等待会话出现。 */
export function runChildSessionTask(taskName: string): TaskOperationResult {
  try {
    runSchtasks(["/Run", "/TN", taskName]);
    return { ok: true, message: `计划任务 ${taskName} 已触发。` };
  } catch (error) {
    const classified = classifySpawnError(error);
    if (/cannot find|不存在|找不到/i.test(classified.detail ?? "")) {
      return {
        ok: false,
        code: "task_not_found",
        detail: classified.detail,
        message: `计划任务 ${taskName} 不存在，需要先注册。`,
      };
    }
    return { ...classified, message: `运行计划任务失败：${classified.message}` };
  }
}

/** 注销任务。任务不存在时也返回成功（幂等）。 */
export function unregisterChildSessionTask(taskName: string): TaskOperationResult {
  try {
    runSchtasks(["/Delete", "/TN", taskName, "/F"]);
    return { ok: true, message: `计划任务 ${taskName} 已注销。` };
  } catch (error) {
    const classified = classifySpawnError(error);
    if (/cannot find|不存在|找不到/i.test(classified.detail ?? "")) {
      return { ok: true, message: `计划任务 ${taskName} 本就不存在。` };
    }
    return { ...classified, ok: false, message: `注销计划任务失败：${classified.message}` };
  }
}

// ---------------------------------------------------------------------------
// 会话探测
// ---------------------------------------------------------------------------

/** 查子会话号。`0xFFFFFFFF` 表示已启用但无会话。 */
export function probeChildSessionId(): number | undefined {
  try {
    const wtsapi = koffi.load("wtsapi32.dll");
    const fn = wtsapi.func("int __stdcall WTSGetChildSessionId(_Out_ uint32 *sid)");
    const sid = [0];
    if (!fn(sid)) return undefined;
    return sid[0] === 0xffffffff ? undefined : sid[0];
  } catch {
    return undefined;
  }
}

/** 同步等待。用 `Atomics.wait` 而不是忙等，避免占满 CPU 核。 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 确保子会话存在。
 *
 * 上层应该用这个入口，而不是自己拼 `register` + `run` + 轮询——
 * 三段拼起来时容易漏掉「复用已有会话」这个情况。
 *
 * 流程：
 * 1. 已有会话？→ 直接返回 `created: false`
 * 2. 注册任务（幂等）
 * 3. 运行任务
 * 4. 等会话出现
 */
export function ensureChildSession(
  definition: ChildSessionTaskDefinition,
  timeoutMs = 30_000,
): EnsureChildSessionResult {
  // 1. 已有会话就直接用。
  // 不能在这里报 ok: true 却不标 created——上层会把别人的会话当成自己的。
  const baseline = probeChildSessionId();
  if (baseline !== undefined) {
    return {
      ok: true,
      sessionId: baseline,
      created: false,
      reason: "session_preexisting",
      message:
        `子会话 ${baseline} 已存在，直接复用。` +
        "它不是本次创建的，清理时不要当作本实现的产物。",
    };
  }

  // 2. 注册
  const registered = registerChildSessionTask(definition);
  if (!registered.ok) {
    return {
      ok: false,
      created: false,
      reason: "task_register_failed",
      message: registered.message,
    };
  }

  // 3. 运行
  const ran = runChildSessionTask(definition.taskName);
  if (!ran.ok) {
    return {
      ok: false,
      created: false,
      reason: "task_run_failed",
      message: ran.message,
    };
  }

  // 4. 等会话
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = probeChildSessionId();
    if (current !== undefined) {
      return {
        ok: true,
        sessionId: current,
        created: true,
        message: `子会话 ${current} 已由计划任务创建。`,
      };
    }
    sleepSync(250);
  }

  return {
    ok: false,
    created: false,
    reason: "session_timeout",
    message:
      `已触发计划任务 ${definition.taskName}，但 ${timeoutMs / 1000} 秒内` +
      "未出现子会话。可能原因：host 进程启动失败、或 SessionStateChange " +
      "触发器在本系统上不生效。可用 queryChildSessionTask 查看任务状态。",
  };
}
