/**
 * 宿主侧的 Helper 客户端。
 *
 * 对应 spec §7 的三层保活：
 * - 动作前探活（`ping`，超时 300ms）
 * - 一次性重启（失败只重试一次）
 * - 熔断（第二次失败即标记不可用，不再尝试）
 *
 * 以及 §7.2 的三条硬规则：不在动作中途重启、重启后清空状态、一次失败即熔断。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import koffi from "koffi";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  HELPER_METHODS,
  HELPER_PROTOCOL_VERSION,
  parseResponseLine,
  takeLines,
  type HelperResponse,
} from "../helper/protocol.ts";
import type { HelperRequest } from "../helper/protocol.ts";
import {
  HelperUnavailableError,
  type ActReceipt,
  type HelperClientOptions,
  type HelperState,
  type PendingRequest,
} from "./helper-client-types.ts";
import {
  capture as captureRequest,
  isolatedDesktop as isolatedDesktopRequest,
  listWindows as listWindowsRequest,
  screenshot as screenshotRequest,
  windowOffscreen as windowOffscreenRequest,
} from "./helper-client-observation.ts";

export { HelperUnavailableError } from "./helper-client-types.ts";
export type {
  ActReceipt,
  HelperClientOptions,
  HelperState,
} from "./helper-client-types.ts";

/** 探测超时。本地管道，300ms 足够；超时即判定无响应。 */
const PING_TIMEOUT_MS = 300;

/** 冷启动上限。实测 spawn→可操作 65ms，给 20 倍余量。 */
const STARTUP_TIMEOUT_MS = 15_000;

/**
 * 连续启动失败多少次后熔断。
 *
 * 2 意味着「首次 + 一次重试」：Helper 起不来通常是环境问题
 * （杀软拦截、缺 DLL、权限丢失），重试一次足够区分「偶发」与「真的不行」，
 * 再多只会拖长用户等待（spec §7.2 规则三）。
 *
 * 注意：**成功启动必须把它清零**。否则第一次崩溃恢复就会被当成
 * 「第二次尝试」而直接熔断，等于恢复能力不存在。这个 bug 在 P5 验收中实测到了。
 */
const MAX_START_ATTEMPTS = 2;


/**
 * Helper 客户端。
 *
 * 单一所有者：本实例持有 Helper 进程与连接。所有动作都必须经过
 * `ensureReady()` + `request()`，不允许旁路。
 */
export class CuaHelperClient {
  private state: HelperState = "stopped";
  private child: ChildProcess | undefined;
  private socket: Socket | undefined;
  private socketPath: string;
  private pending = new Map<string, PendingRequest>();
  private readBuffer = "";
  /** 熔断标记：置位后本实例不再尝试拉起，直到上层重建客户端。 */
  private tripped = false;
  /** 本轮连续启动失败次数。成功启动即清零。 */
  private consecutiveStartFailures = 0;
  /** Helper 自报的会话号。握手时记录，未握手时为 undefined。 */
  private helperSessionId: number | undefined;

  constructor(private readonly options: HelperClientOptions) {
    this.socketPath = options.socketPath ?? defaultSocketPath();
  }

  get currentState(): HelperState {
    return this.state;
  }

  get running(): boolean {
    return this.state === "ready" && Boolean(this.socket);
  }

  /**
   * 确保 Helper 可用。
   *
   * 顺序：已就绪 → 探活；探活失败或未就绪 → 启动。
   *
   * 关键语义：**探活发现进程已死时，不算「启动失败」**。这是恢复路径，
   * 不是失败路径——用户手动杀了进程、系统回收内存都会走到这里，
   * 此时应该正常拉起，而不是记一次失败并倾向于熔断。
   */
  /**
   * 连上一个**已经在跑**的 Helper，不启动新进程。
   *
   * 用于跨会话场景：host 由 `CreateProcessAsUser` 在另一个会话里启动，
   * 本进程只知道它的管道地址（经引导管道拿到），不能也不该再 spawn 一次。
   *
   * 与 `ensureReady` 的区别必须清楚：
   * - `ensureReady` 会按需 spawn，并管理连续失败计数
   * - 本方法只连接 + 握手，连不上就抛错，不重试也不拉起
   *
   * 混用会导致两个 Helper 同时存在、快照分裂。
   */
  async attachToReadyHelper(): Promise<void> {
    if (this.state === "ready" && this.socket) return;
    if (this.tripped) {
      throw new HelperUnavailableError("helper 已熔断，需要重建客户端");
    }

    this.state = "starting";
    try {
      await this.connect();
      const handshake = (await this.request(
        HELPER_METHODS.HANDSHAKE,
        { protocolVersion: HELPER_PROTOCOL_VERSION },
        STARTUP_TIMEOUT_MS,
      )) as { sessionId?: number } | undefined;

      this.helperSessionId = handshake?.sessionId;
      this.state = "ready";
      this.log("debug", "已连接到外部启动的 helper", {
        socket: this.socketPath,
        sessionId: this.helperSessionId,
      });
    } catch (error) {
      // 连不上时清掉半开的连接，避免后续请求挂在死 socket 上
      await this.cleanupSocketOnly();
      this.state = "stopped";
      throw error;
    }
  }

  async ensureReady(): Promise<void> {
    if (this.tripped) {
      throw new HelperUnavailableError("helper 已熔断，需要上层重建客户端");
    }

    if (this.state === "ready" && this.socket) {
      try {
        await this.ping();
        return;
      } catch (error) {
        // 探活失败：进程可能已死。清理后重新拉起。
        // 这里把连续失败计数清零，理由见方法注释。
        this.log("warn", "helper 探活失败，准备重启", {
          reason: error instanceof Error ? error.message : String(error),
        });
        this.consecutiveStartFailures = 0;
        await this.stop();
      }
    }

    await this.start();
  }

  /**
   * 启动 Helper。
   *
   * 连续失败 `MAX_START_ATTEMPTS` 次即熔断。成功一次就清零计数，
   * 因此这个实例可以经历任意多次「崩溃 → 恢复」循环。
   */
  private async start(): Promise<void> {
    if (this.consecutiveStartFailures >= MAX_START_ATTEMPTS) {
      this.tripped = true;
      this.state = "unavailable";
      throw new HelperUnavailableError("helper 重启失败，已熔断", {
        reason: "restart",
        attempts: this.consecutiveStartFailures,
      });
    }
    this.state = "starting";

    // 经 creator 启动时，参数与就绪判定都不同：
    // - 不传 --socket（host 自己生成后回报）
    // - 就绪信号由 creator 原样转发，因此仍然出现在同一个 stdout 上
    const viaCreator = this.options.creatorPath !== undefined;
    const args = viaCreator
      ? [
          this.options.creatorPath as string,
          "--host-entry",
          this.options.entryPath,
          "--command",
          this.options.command,
          ...(this.options.targetSessionId !== undefined
            ? ["--target-session", String(this.options.targetSessionId)]
            : []),
          ...(this.options.idleTimeoutMs !== undefined
            ? ["--idle-timeout", String(this.options.idleTimeoutMs)]
            : []),
        ]
      : [
          this.options.entryPath,
          "--socket",
          this.socketPath,
          "--parent-pid",
          String(process.pid),
          ...(this.options.idleTimeoutMs !== undefined
            ? ["--idle-timeout", String(this.options.idleTimeoutMs)]
            : []),
        ];

    const child = spawn(this.options.command, args, {
      cwd: this.options.cwd,
      env: {
        ...process.env,
        ...this.options.commandEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new HelperUnavailableError(`helper 启动超时（${STARTUP_TIMEOUT_MS}ms）`));
      }, STARTUP_TIMEOUT_MS);

      let stdoutBuffer = "";
      child.stdout?.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        const { lines, rest } = takeLines(stdoutBuffer);
        stdoutBuffer = rest;
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as {
              event?: string;
              socket?: string;
              code?: string;
              message?: string;
            };
            if (event.event === "helper_ready") {
              // 经 creator 启动时管道名由 host 决定，必须从事件里取。
              // 直接 spawn 时主进程已持有路径，两者应当一致——
              // 不一致说明 host 报错了自己的地址，那是必须暴露的故障。
              if (typeof event.socket === "string" && event.socket) {
                if (!viaCreator && event.socket !== this.socketPath) {
                  this.log("warn", "helper 回报的管道与预期不符", {
                    expected: this.socketPath,
                    reported: event.socket,
                  });
                }
                this.socketPath = event.socket;
              }
              clearTimeout(timer);
              resolve();
            } else if (event.event === "creator_failed") {
              // creator 的失败必须立刻终止等待，否则要白等到超时。
              clearTimeout(timer);
              reject(
                new HelperUnavailableError(
                  event.message ?? `creator 失败（code=${event.code ?? "unknown"}）`,
                  { reason: event.code },
                ),
              );
            }
          } catch {
            // Helper 的 stdout 只承载事件行；解析失败说明是调试输出，忽略
          }
        }
      });

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        this.log("warn", "helper stderr", { chunk: chunk.trim().slice(0, 500) });
      });

      child.once("error", (error) => {
        clearTimeout(timer);
        reject(new HelperUnavailableError(`helper 启动失败: ${error.message}`));
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        if (this.state === "starting") {
          reject(new HelperUnavailableError(`helper 启动前退出: code=${code} signal=${signal}`));
        }
      });
    });

    try {
      await ready;
      // 连管道
      await this.connect();
      // 握手：确认协议版本一致，并记录 Helper 所在的会话。
      const handshake = (await this.request(
        HELPER_METHODS.HANDSHAKE,
        { protocolVersion: HELPER_PROTOCOL_VERSION },
        STARTUP_TIMEOUT_MS,
      )) as { sessionId?: number } | undefined;

      // 会话归属校验。UIA 与窗口枚举只看得到 Helper 所在的会话
      // （spec §1.3），所以「Helper 在哪个会话」等于「模型能看到哪个桌面」。
      //
      // 这里**不拒绝**不一致的情况——那是上层（`sessions` 诊断）的职责，
      // 它能把原因解释清楚。这里只记录事实，并在不一致时打一条醒目的日志：
      // 用户以为模型在看自己的屏幕，实际不是，这种错位必须留痕。
      this.helperSessionId = handshake?.sessionId;
      if (
        this.helperSessionId !== undefined &&
        this.helperSessionId !== currentSessionId()
      ) {
        this.log("warn", "Helper 会话与主进程不一致，观察结果属于另一个桌面", {
          helperSession: this.helperSessionId,
          mainSession: currentSessionId(),
        });
      }
    } catch (error) {
      // 任何一步失败都算一次启动失败。三处共用同一个计数，
      // 否则「spawn 成功但握手失败」会绕过熔断判断，变成无限重试。
      this.consecutiveStartFailures += 1;
      await this.stop();
      throw error;
    }

    // 成功启动 → 清零。这一步不可省：不清零的话，
    // 本实例只能启动一次，之后任何崩溃都无法恢复（P5 验收实测到的 bug）。
    this.consecutiveStartFailures = 0;
    this.state = "ready";
    this.log("debug", "helper 就绪", { socket: this.socketPath, pid: child.pid });
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new HelperUnavailableError("连接 helper 管道超时"));
      }, STARTUP_TIMEOUT_MS);

      socket.once("connect", () => {
        clearTimeout(timer);
        this.socket = socket;
        this.attachSocket(socket);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(new HelperUnavailableError(`连接 helper 管道失败: ${error.message}`));
      });
    });
  }

  private attachSocket(socket: Socket): void {
    socket.setEncoding("utf8");
    socket.setNoDelay(true);
    this.readBuffer = "";

    socket.on("data", (chunk: string) => {
      this.readBuffer += chunk;
      const { lines, rest } = takeLines(this.readBuffer);
      this.readBuffer = rest;
      for (const line of lines) {
        // 响应帧没有 method 字段，不能用 parseRequestLine 解析——
        // 那是给请求侧用的。这里只做最宽松的 JSON 校验后交给 settle。
        const response = parseResponseLine(line);
        if (!response) continue;
        this.settle(response);
      }
    });

    socket.on("close", () => {
      if (this.state === "ready") {
        this.log("warn", "helper 连接断开");
        this.state = "stopped";
        this.socket = undefined;
      }
      this.rejectAllPending(new HelperUnavailableError("helper 连接已断开"));
    });

    socket.on("error", () => {
      // 错误后必跟 close，统一在那里处理
    });
  }

  private settle(response: HelperResponse): void {
    const id = String(response.id ?? "");
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (response.ok) {
      pending.resolve(response.result);
    } else {
      // 保留 code 供上层按错误码分流（spec §6.2）
      const error = new Error(response.error.message);
      (error as Error & { code?: string }).code = response.error.code;
      pending.reject(error);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  /** 发一次请求。不做探活，调用方负责先 ensureReady。 */
  request(method: string, params?: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(new HelperUnavailableError("helper 未连接"));
    }
    return new Promise<unknown>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HelperUnavailableError(`helper 请求超时: ${method}`, { reason: "timeout" }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const payload: HelperRequest = { id, method, params };
      socket.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new HelperUnavailableError(`发送请求失败: ${error.message}`));
      });
    });
  }

  /** 探活。快速失败，不重试。 */
  async ping(): Promise<{ pid: number; sessionId: number; uptimeMs: number }> {
    return (await this.request(HELPER_METHODS.PING, undefined, PING_TIMEOUT_MS)) as {
      pid: number;
      sessionId: number;
      uptimeMs: number;
    };
  }

  /** UIA 运行时探活。 */
  async probeUia(): Promise<{
    ok: boolean;
    elapsedMs: number;
    sessionId: number;
    reason?: string;
  }> {
    return (await this.request(HELPER_METHODS.UIA_PROBE, undefined, 5_000)) as {
      ok: boolean;
      elapsedMs: number;
      sessionId: number;
      reason?: string;
    };
  }

  /** 枚举顶层窗口。 */
  async listWindows(params?: {
    scope?: "running" | "all";
    includeWindowIds?: boolean;
    windowLimit?: number;
  }): Promise<{
    windows: {
      runtimeId: string;
      window_id?: string;
      title: string;
      className: string;
      processId: number | undefined;
      frameworkId: string;
      bounds: { left: number; top: number; width: number; height: number } | undefined;
    }[];
    scope: string;
    total: number;
    truncated: boolean;
    elapsedMs: number;
  }> {
    return await listWindowsRequest(this, params);
  }

  /**
   * 采集窗口无障碍树。
   *
   * `treeShownToModel` 决定是否移动差分基线——只有本次结果真的会给模型看时
   * 才置 true，否则内部观察会污染基线（spec §5.3）。
   */
  async capture(params: {
    runtimeId?: string;
    processId?: number;
    /** 按应用名匹配窗口（SDK 的 `{name}` / `{bundle_id}` 形式）。 */
    appName?: string;
    disableDiffing?: boolean;
    treeShownToModel?: boolean;
    budget?: { maxNodes?: number; maxDepth?: number; deadlineMs?: number };
  }): Promise<{
    text: string;
    mode: "full" | "delta";
    stateId: string;
    windowTitle: string;
    processId: number | undefined;
    frameworkId: string;
    windowKey: string;
    nodeCount: number;
    truncated: boolean;
    truncationReason: string | undefined;
    brittleTree: boolean;
    capacityExceeded: boolean;
    coordinateRootId: string;
    coordinateSpace: { width: number; height: number };
    relatedWindows: {
      window_id: string;
      title: string;
      class_name: string;
      is_modal: boolean;
    }[];
    /** 结构化元素表（SDK 的 appStateOf 强制要求）。 */
    elements: {
      index: number;
      kind: string;
      name: string;
      value: string;
      value_known: boolean;
      input_target: boolean;
      states: string[];
      bounds: { left: number; top: number; width: number; height: number } | undefined;
      actions: string[];
    }[];
    elapsedMs: number;
  }> {
    return await captureRequest(this, params);
  }

  /**
   * 一级派发：消息投递点击。
   *
   * 返回收据。`dispatchStatus` 为 `sent` 只代表消息入队成功，
   * `effect` 恒为 `unverifiable`——要确认生效必须读回状态（见 spec §6.1）。
   */
  async click(params: {
    stateId: string;
    index: number;
    button?: "left" | "right" | "middle";
    clickCount?: number;
  }): Promise<{
    path: string;
    dispatchStatus: "sent" | "not_sent";
    effect: "unverifiable" | "refused";
    stateId: string;
    index: number;
    elementKind: string;
    elementName: string;
    screenPoint: { x: number; y: number };
    clientPoint: { x: number; y: number };
    targetDepth: number;
    messages: { name: string; ok: boolean }[];
    elapsedMs: number;
  }> {
    return (await this.request(HELPER_METHODS.CLICK, params, 10_000)) as {
      path: string;
      dispatchStatus: "sent" | "not_sent";
      effect: "unverifiable" | "refused";
      stateId: string;
      index: number;
      elementKind: string;
      elementName: string;
      screenPoint: { x: number; y: number };
      clientPoint: { x: number; y: number };
      targetDepth: number;
      messages: { name: string; ok: boolean }[];
      elapsedMs: number;
    };
  }

  /**
   * 按预算选择路径执行动作。
   *
   * 返回的 `path` 字段是关键信息：`post_message` 完全无感，
   * `ax` 会激活窗口（虽不抢键鼠），`foreground_send_input` 会抢键鼠。
   *
   * `allowPhysicalInjection` 必须来自用户设置。本方法不做默认开启，
   * 也不读环境变量——授权只有一个来源，否则审计时说不清。
   */
  async act(params: {
    stateId: string;
    index?: number;
    coordinate?: { x: number; y: number };
    coordinate_space?: { width: number; height: number };
    budget?: "quiet" | "balanced" | "unrestricted";
    allowPhysicalInjection?: boolean;
    intent?: {
      kind?: "click" | "set_value";
      button?: "left" | "right" | "middle";
      clickCount?: number;
      semantic?: string;
      value?: string;
    };
    preferPath?: "post_message" | "ax" | "ax_text" | "foreground_send_input";
  }): Promise<ActReceipt> {
    return (await this.request(HELPER_METHODS.ACT, params, 30_000)) as ActReceipt;
  }

  /**
   * 定向文本输入。
   *
   * 优先 ValuePattern / EM_REPLACESEL，不激活窗口；两条都不可用时抛
   * `element_unavailable`，由 runtime 决定是否在授权后降级到物理注入。
   */
  async typeIntoElement(params: {
    stateId: string;
    index: number;
    text: string;
  }): Promise<ActReceipt> {
    return (await this.request(HELPER_METHODS.TYPE_INTO_ELEMENT, params, 30_000)) as ActReceipt;
  }

  /** 显式启动应用。 */
  async launchApp(params: { app: string }): Promise<{
    ok: boolean;
    pid: number | null;
    dispatched: boolean;
    mode: "spawn" | "shell_execute";
    reason?: string;
    message: string;
    elapsedMs: number;
  }> {
    return (await this.request(HELPER_METHODS.LAUNCH_APP, params, 30_000)) as {
      ok: boolean;
      pid: number | null;
      dispatched: boolean;
      mode: "spawn" | "shell_execute";
      reason?: string;
      message: string;
      elapsedMs: number;
    };
  }

  /** 两阶段窗口恢复。 */
  async restoreWindow(params: {
    phase: "prepare" | "restore";
    stateId?: string;
    windowId?: string;
    pid?: number;
    hwnd?: string | number;
    recovery_id?: string;
    foreground?: boolean;
  }): Promise<{
    ok: boolean;
    recovery_id?: string;
    window_visual_state?: {
      minimized: boolean;
      visible: boolean;
      offscreen: boolean;
      rect: { x: number; y: number; width: number; height: number } | undefined;
    };
    restored?: boolean;
    foreground?: boolean;
    reason?: string;
    message: string;
  }> {
    return (await this.request(HELPER_METHODS.RESTORE_WINDOW, params, 30_000)) as {
      ok: boolean;
      recovery_id?: string;
      window_visual_state?: {
        minimized: boolean;
        visible: boolean;
        offscreen: boolean;
        rect: { x: number; y: number; width: number; height: number } | undefined;
      };
      restored?: boolean;
      foreground?: boolean;
      reason?: string;
      message: string;
    };
  }

  /** 键盘输入。恒为物理注入，调用方需先确认授权。 */
  async sendKey(params: {
    stateId?: string;
    targetIndex?: number;
    chord?: string;
    text?: string;
    holdMs?: number;
  }): Promise<{
    path: string;
    dispatchStatus: "sent" | "not_sent";
    effect: string;
    grabInput: boolean;
    cursorRestored: boolean;
    injectedEvents: number;
    steps: { step: string; ok: boolean; injected: number; unknownKey?: string }[];
    elapsedMs: number;
  }> {
    return (await this.request(HELPER_METHODS.KEY, params, 30_000)) as {
      path: string;
      dispatchStatus: "sent" | "not_sent";
      effect: string;
      grabInput: boolean;
      cursorRestored: boolean;
      injectedEvents: number;
      steps: { step: string; ok: boolean; injected: number; unknownKey?: string }[];
      elapsedMs: number;
    };
  }

  /** 滚动。按预算选择消息投递或物理注入。 */
  async sendScroll(params: {
    stateId: string;
    index?: number;
    coordinate?: { x: number; y: number };
    coordinate_space?: { width: number; height: number };
    wheelCount: number;
    budget?: "quiet" | "balanced" | "unrestricted";
    allowPhysicalInjection?: boolean;
    preferPath?: "post_message" | "foreground_send_input";
  }): Promise<{
    path: string;
    dispatchStatus: "sent" | "not_sent";
    effect: string;
    grabInput: boolean;
    wheelCount: number;
    budget: string;
    coordinate?: { x: number; y: number };
    screenPoint?: { x: number; y: number };
    elapsedMs: number;
  }> {
    return (await this.request(HELPER_METHODS.SCROLL, params, 30_000)) as {
      path: string;
      dispatchStatus: "sent" | "not_sent";
      effect: string;
      grabInput: boolean;
      wheelCount: number;
      budget: string;
      coordinate?: { x: number; y: number };
      screenPoint?: { x: number; y: number };
      elapsedMs: number;
    };
  }

  /** 拖拽。恒为物理注入。 */
  async drag(params: {
    stateId: string;
    fromIndex?: number;
    toIndex?: number;
    fromCoordinate?: { x: number; y: number };
    toCoordinate?: { x: number; y: number };
    coordinate_space?: { width: number; height: number };
    button?: "left" | "right" | "middle";
    steps?: number;
  }): Promise<{
    path: string;
    dispatchStatus: "sent" | "not_sent";
    effect: string;
    grabInput: boolean;
    cursorRestored: boolean;
    injectedEvents: number;
    failureReason?: string;
    fromCoordinate?: { x: number; y: number };
    toCoordinate?: { x: number; y: number };
    elapsedMs: number;
  }> {
    return (await this.request(HELPER_METHODS.DRAG, params, 60_000)) as {
      path: string;
      dispatchStatus: "sent" | "not_sent";
      effect: string;
      grabInput: boolean;
      cursorRestored: boolean;
      injectedEvents: number;
      failureReason?: string;
      fromCoordinate?: { x: number; y: number };
      toCoordinate?: { x: number; y: number };
      elapsedMs: number;
    };
  }

  /**
   * 文本选区：按字符区间选中控件内的文本。
   *
   * Helper 侧只有 UIA TextPattern 一条路径，不支持会抛
   * `element_unavailable` 并在 detail 里带上原因与文档长度。
   */
  async selectText(params: {
    stateId: string;
    index: number;
    start: number;
    length: number;
  }): Promise<{
    path: string;
    dispatchStatus: "sent" | "not_sent";
    effect: string;
    activatesWindow: boolean;
    grabInput: boolean;
    semanticAction: string;
    selection: {
      start: number;
      length: number;
      selectedText?: string;
      documentLength?: number;
    };
    elapsedMs: number;
  }> {
    return (await this.request(HELPER_METHODS.SELECT_TEXT, params, 30_000)) as {
      path: string;
      dispatchStatus: "sent" | "not_sent";
      effect: string;
      activatesWindow: boolean;
      grabInput: boolean;
      semanticAction: string;
      selection: {
        start: number;
        length: number;
        selectedText?: string;
        documentLength?: number;
      };
      elapsedMs: number;
    };
  }

  /** 会话拓扑与跨会话能力探测。不抛错：失败信息本身是结果。 */
  async sessions(): Promise<{
    current_session_id: number;
    sessions: {
      session_id: number;
      state: string;
      station: string;
      is_current: boolean;
      has_interactive_desktop: boolean;
    }[];
    child_sessions_enabled: boolean;
    child_session_id: number | null;
    can_change_session: boolean;
    session_change_blocker?: string;
    cross_session_available: boolean;
    guidance: string;
  }> {
    return (await this.request(HELPER_METHODS.SESSIONS, {}, 10_000)) as {
      current_session_id: number;
      sessions: {
        session_id: number;
        state: string;
        station: string;
        is_current: boolean;
        has_interactive_desktop: boolean;
      }[];
      child_sessions_enabled: boolean;
      child_session_id: number | null;
      can_change_session: boolean;
      session_change_blocker?: string;
      cross_session_available: boolean;
      guidance: string;
    };
  }

  /**
   * 把窗口移出屏幕 / 移回。
   *
   * 移出屏幕是「后台持续出画面」的正确做法：客户区完好，采集正常；
   * 而最小化会销毁客户区（`ClientRect=0x0`），PrintWindow 与 WGC 都失效。
   */
  async windowOffscreen(params: {
    action: "hide" | "restore";
    hwnd: number;
    x?: number;
    y?: number;
  }): Promise<{
    ok: boolean;
    mode?: string;
    reason?: string;
    message: string;
    previousRect?: { x: number; y: number; width: number; height: number };
    targetPosition?: { x: number; y: number };
    visibleWidth?: number;
  }> {
    return await windowOffscreenRequest(this, params);
  }

  /** 独立桌面（子会话）能力判定。 */
  async isolatedDesktop(): Promise<{
    capability: "unsupported" | "supported" | "enabled" | "session_ready";
    actionable: boolean;
    current_session_id: number;
    child_session_id: number | null;
    can_spawn_into_child: boolean;
    gates: {
      id: string;
      label: string;
      passed: boolean;
      detail: string;
      resolvable: boolean;
    }[];
    summary: string;
    next_step: string;
  }> {
    return await isolatedDesktopRequest(this);
  }

  /** 窗口截图，返回 base64 PNG。 */
  async screenshot(params: {
    stateId?: string;
    hwnd?: string;
  }): Promise<{
    mime_type: string;
    width: number;
    height: number;
    base64: string;
    byte_length: number;
    frame_id: string;
    coordinate_root_id: string;
    coordinate_space: { width: number; height: number };
    blank: boolean;
    blank_reason?: string;
    may_be_frozen: boolean;
    frozen_reason?: string;
    window_title: string;
    elapsedMs: number;
  }> {
    return await screenshotRequest(this, params);
  }

  /** 观察模块的请求入口。只暴露 request，不暴露连接状态。 */
  async requestRaw(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    return await this.request(method, params, timeoutMs);
  }

  /** 停止并清理。可重复调用。 */
  /**
   * 只断开连接，不碰进程。
   *
   * 跨会话的 host 不归本进程管理——它由目标会话里的 creator/启动方持有，
   * 本进程强杀它只会让那边留下一个死会话。因此连接失败时只能清 socket。
   */
  private async cleanupSocketOnly(): Promise<void> {
    this.rejectAllPending(new HelperUnavailableError("helper 连接已清理"));
    const socket = this.socket;
    this.socket = undefined;
    if (socket && !socket.destroyed) socket.destroy();
  }

  async stop(): Promise<void> {
    this.state = "stopped";
    this.rejectAllPending(new HelperUnavailableError("helper 已停止"));

    const socket = this.socket;
    this.socket = undefined;
    if (socket && !socket.destroyed) {
      socket.destroy();
    }

    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        // 优雅退出超时则强杀，避免留下占着管道的孤儿
        try {
          child.kill("SIGKILL");
        } catch {
          // 已退出
        }
        resolve();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  private log(level: "debug" | "warn" | "error", message: string, meta?: unknown): void {
    this.options.logger?.[level]?.(message, meta);
  }
}

/** 生成一个唯一的命名管道路径。 */
/**
 * 取当前进程所在会话号。
 *
 * 不用 helper 里的 `currentSession()`：runtime 层不该依赖执行层的实现细节，
 * 而且这里只需要一个数，重复实现一行比引入跨层依赖更省事。
 * 失败返回 undefined——会话号只用于告警，缺了不影响功能。
 */
function currentSessionId(): number | undefined {
  try {
    const kernel32 = koffi.load("kernel32.dll");
    const ProcessIdToSessionId = kernel32.func(
      "int __stdcall ProcessIdToSessionId(uint32 pid, _Out_ uint32 *sid)",
    );
    const GetCurrentProcessId = kernel32.func("uint32 __stdcall GetCurrentProcessId()");
    const sid = [0];
    return ProcessIdToSessionId(GetCurrentProcessId(), sid) ? sid[0] : undefined;
  } catch {
    return undefined;
  }
}

function defaultSocketPath(): string {
  const id = randomUUID();
  return process.platform === "win32" ? `\\\\.\\pipe\\raspberrycode-cua-${id}` : `/tmp/raspberrycode-cua-${id}.sock`;
}
