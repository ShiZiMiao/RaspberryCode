/**
 * Host 进程主管。
 *
 * 「Host」指运行在**目标会话内**的助手进程。它与主桌面侧的 runtime 通过
 * 命名管道通信，职责是让 UIA 调用发生在目标会话里——因为 UIA 与窗口枚举
 * 只看得到自己所在的会话（spec §1.3）。
 *
 * 与 `helper-registry` 的分工：
 * - `helper-registry` 管「同会话内的多实例复用」（引用计数、延迟回收）
 * - 本模块管「host 应该落在哪个会话」以及「它现在到底在不在那儿」
 *
 * 为什么需要单独一层：把 host 放进别的会话需要 `SeTcbPrivilege`（仅 SYSTEM），
 * 而本实现不做提权。所以现实中会有三种结果：
 * 1. 目标 = 当前会话 → 直接 spawn，完全可用
 * 2. 目标 ≠ 当前会话且无特权 → **明确失败并说清原因**，不是假装成功
 * 3. 目标 ≠ 当前会话且有特权 → 走 `session-spawn` 的令牌路径
 *
 * 三条路的状态必须能被查询，否则调用方只能盲试。
 */

import { CuaHelperClient } from "../runtime/helper-client.ts";
import { currentSession } from "./session.ts";
import { spawnHelperInSession } from "./session-spawn.ts";
import { createBootstrapChannel } from "./address-broker.ts";

/** Host 生命周期状态。 */
export type HostHealth =
  /** 尚未启动。 */
  | "stopped"
  /** 正在启动（spawn 或等待握手）。 */
  | "starting"
  /** 已就绪，可接受请求。 */
  | "healthy"
  /** 启动失败或已熔断。 */
  | "failed";

/** Host 现状快照。 */
export interface HostStatus {
  health: HostHealth;
  /** 进程 ID（已知时）。 */
  pid: number | undefined;
  /** Host 自报所在的会话。未握手时为 undefined。 */
  sessionId: number | undefined;
  /** 期望 host 落在的会话。 */
  targetSessionId: number;
  /**
   * Host 是否真的在期望的会话里。
   *
   * `false` 意味着**它能看到的东西和目标会话不是同一批窗口**。
   * 这是必须让用户知道的事实：他以为模型在看目标桌面，实际不是。
   */
  inExpectedSession: boolean;
  /** 一句话说明。失败时说清是哪一步、为什么。 */
  detail: string;
}

export interface HostSupervisorOptions {
  /** Helper（host）的入口脚本路径。 */
  entryPath: string;
  /** 启动 host 用的可执行文件。默认当前进程。 */
  command?: string;
  /** 传给 host 的额外环境变量。 */
  commandEnv?: Record<string, string>;
  /**
   * 目标会话。省略表示「当前会话」。
   *
   * 传别的会话时，只有在具备 `SeTcbPrivilege` 的环境里才可能成功；
   * 否则 `ensure()` 返回失败状态并说明原因。
   */
  targetSessionId?: number;
}

/**
 * Host 主管。
 *
 * 刻意做成「一个主管管理一个 host」而不是全局单例：
 * 将来若要同时操作两个会话，需要两个 host，各自一个主管。
 * 全局单例会让这种扩展变成改结构。
 */
export class HostSupervisor {
  private readonly options: HostSupervisorOptions;
  private client: CuaHelperClient | undefined;
  private health: HostHealth = "stopped";
  private detail = "尚未启动";
  private pid: number | undefined;
  private sessionId: number | undefined;
  private lastError: string | undefined;

  constructor(options: HostSupervisorOptions) {
    this.options = options;
  }

  /** 目标会话号（未指定时为当前会话）。 */
  get targetSessionId(): number {
    return this.options.targetSessionId ?? currentSession();
  }

  /**
   * 确保 host 在运行。
   *
   * 已有健康实例时直接返回（并复查它是否还在期望会话里）——
   * 不做无谓的重启，因为重启会丢掉全部快照缓存。
   */
  async ensure(): Promise<HostStatus> {
    if (this.client && this.health === "healthy") {
      const stillHealthy = await this.recheck();
      if (stillHealthy) return this.status();
    }

    if (this.health === "starting") {
      // 并发调用：不重复启动。返回当前状态让调用方知道正在起。
      return this.status();
    }

    const target = this.targetSessionId;
    const here = currentSession();

    // 需要跨会话：先确认能否把进程放进目标会话。
    // 这一步在本机必然失败（缺 SeTcbPrivilege），但失败信息要能指导行动，
    // 所以走 session-spawn 而不是自己拼错误。
    if (target !== here) {
      this.health = "starting";
      this.detail = `准备把 host 放进会话 ${target}（当前在 ${here}）`;

      // 跨会话时必须先建引导管道：host 由 CreateProcessAsUser 直接创建，
      // 没有连到本进程的 stdout，只能靠它反向连回报自己的地址。
      const bootstrap = createBootstrapChannel();

      const spawn = spawnHelperInSession({
        exePath: this.options.command ?? process.execPath,
        args: [
          this.options.entryPath,
          "--parent-pid",
          String(process.pid),
          "--target-session",
          String(target),
          "--bootstrap",
          bootstrap.name,
        ],
        sessionId: target,
      });

      if (!spawn.ok) {
        bootstrap.close();
        this.health = "failed";
        this.lastError = spawn.reason ?? "spawn_failed";
        this.detail = `无法把 host 放进会话 ${target}：${spawn.message}`;
        return this.status();
      }

      // host 起来了，等它回报地址。
      try {
        const report = await bootstrap.waitForAddress(30_000);
        bootstrap.close();

        this.pid = report.pid;
        this.sessionId = report.sessionId;
        this.client = new CuaHelperClient({
          entryPath: this.options.entryPath,
          command: this.options.command ?? process.execPath,
          commandEnv: this.options.commandEnv ?? { ELECTRON_RUN_AS_NODE: "1" },
          cwd: undefined,
          idleTimeoutMs: 10 * 60 * 1000,
          // 关键：直接用 host 报上来的地址，不自己生成。
          socketPath: report.socket,
        });
        // 这里不能用 ensureReady（那会重新 spawn 一个），
        // 只做连接与握手。
        await this.client.attachToReadyHelper();
        this.health = "healthy";
        this.detail =
          `host 就绪（pid=${report.pid}，会话 ${report.sessionId}，经引导管道握手）`;
        return this.status();
      } catch (error) {
        bootstrap.close();
        this.health = "failed";
        this.lastError = error instanceof Error ? error.message : String(error);
        this.detail =
          `host 已启动（pid=${spawn.processId}）但握手失败：${this.lastError}`;
        return this.status();
      }
    }

    // 同会话：直接 spawn，完全可用。
    this.health = "starting";
    this.detail = "正在启动 host";

    try {
      this.client = new CuaHelperClient({
        entryPath: this.options.entryPath,
        command: this.options.command ?? process.execPath,
        commandEnv: this.options.commandEnv ?? { ELECTRON_RUN_AS_NODE: "1" },
        cwd: undefined,
        idleTimeoutMs: 10 * 60 * 1000,
      });
      await this.client.ensureReady();

      // 握手拿到的 sessionId 是判定「它在哪儿」的唯一依据。
      const ping = await this.client.ping();
      this.pid = ping.pid;
      this.sessionId = ping.sessionId;
      this.health = "healthy";
      this.lastError = undefined;
      this.detail = `host 就绪（pid=${ping.pid}，会话 ${ping.sessionId}）`;
      return this.status();
    } catch (error) {
      this.health = "failed";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.detail = `host 启动失败：${this.lastError}`;
      return this.status();
    }
  }

  /** 当前状态，不做任何 IO。 */
  status(): HostStatus {
    const target = this.targetSessionId;
    return {
      health: this.health,
      pid: this.pid,
      sessionId: this.sessionId,
      targetSessionId: target,
      inExpectedSession: this.sessionId !== undefined && this.sessionId === target,
      detail: this.detail,
    };
  }

  /** 拿底层客户端（供 runtime 复用同一条管道）。未就绪时返回 undefined。 */
  get helper(): CuaHelperClient | undefined {
    return this.health === "healthy" ? this.client : undefined;
  }

  /** 上次失败的原因（诊断用）。 */
  get error(): string | undefined {
    return this.lastError;
  }

  /** 停止 host。可重复调用。 */
  async stop(): Promise<void> {
    const current = this.client;
    this.client = undefined;
    this.health = "stopped";
    this.pid = undefined;
    this.sessionId = undefined;
    this.detail = "已停止";
    if (current) await current.stop().catch(() => undefined);
  }

  /**
   * 复查已有 host 是否还活着、还在期望的会话里。
   *
   * 只做探活而不重启：探活失败时把状态降级，让调用方决定是重建还是报告。
   * 静默重启会掩盖「宿主反复崩溃」这类真问题。
   */
  private async recheck(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const ping = await this.client.ping();
      this.pid = ping.pid;
      this.sessionId = ping.sessionId;
      if (ping.sessionId !== this.targetSessionId) {
        // 会话变了（极少见：进程被移到别的会话）。降级而不是假装正常。
        this.health = "failed";
        this.lastError = "session_changed";
        this.detail =
          `host 现在在会话 ${ping.sessionId}，但期望 ${this.targetSessionId}。` +
          "观察结果会属于错误的桌面。";
        return false;
      }
      return true;
    } catch (error) {
      this.health = "failed";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.detail = `host 探活失败：${this.lastError}`;
      return false;
    }
  }
}
