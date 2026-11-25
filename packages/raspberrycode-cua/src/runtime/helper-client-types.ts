/**
 * Helper 客户端的公共类型与错误。
 *
 * 从 `helper-client.ts` 抽出：这些类型被 runtime、SDK 契约和测试共用，
 * 放在实现文件里会让实现文件随字段增长持续膨胀。
 */

export type HelperState = "stopped" | "starting" | "ready" | "unavailable";

/**
 * 动作收据。
 *
 * `dispatchStatus` 决定能否重试，`path` 决定用户会不会被打扰，
 * `effect` 表达「是否确认生效」。三者都是模型与用户需要的事实。
 */
export interface ActReceipt {
  path: string;
  dispatchStatus: "not_sent" | "sent" | "possibly_sent";
  effect: "confirmed" | "unverifiable" | "suspected_noop" | "refused";
  /**
   * 更细的发送状态。
   *
   * `not_sent` 确定没发出；`partial` 部分发出；`unknown` 可能已发出。
   * 与 `dispatchStatus` 并存是为了兼容既有消费方，新消费方应优先读这个字段。
   */
  delivery?: "not_sent" | "sent" | "partial" | "unknown";
  escalated: boolean;
  budget: string;
  stateId: string;
  index: number;
  elementKind: string;
  elementName: string;
  /** 二级路径专用的语义动作名。 */
  semanticAction?: string;
  /** 二级路径专用的 pattern 名。 */
  pattern?: string;
  /** 二级路径专用的原始 HRESULT。 */
  hresult?: string;
  /** 二级及以上会激活目标窗口，收据里明确标出。 */
  activatesWindow?: boolean;
  /** 三级路径专用：是否抢占了键鼠（恒为 true）。 */
  grabInput?: boolean;
  /** 三级路径专用：光标是否已回到动作前位置（实测）。 */
  cursorRestored?: boolean;
  /** 三级路径专用：前台窗口是否已还原（实测）。 */
  foregroundRestored?: boolean;
  /** 三级路径专用：实际注入的输入事件数。 */
  injectedEvents?: number;
  /** 失败原因（仅未抛错但未生效时出现）。 */
  failureReason?: string;
  /**
   * 键盘焦点是否真的在目标控件上。
   *
   * `matched` 只证明 HWND 焦点，不证明输入焦点；`unknown` 表示无法判定。
   */
  receiverFocus?: "matched" | "unknown" | "not_applicable";
  /** 坐标动作专用：归一化坐标与屏幕点。 */
  coordinate?: { x: number; y: number };
  screenPoint?: { x: number; y: number };
  /** 坐标动作绑定的截图帧。 */
  frameId?: string;
  /**
   * 降级来源：原本想走的能力不可用，改用了另一条路径。
   *
   * 目前只有 `set_value` 会产生它——ValuePattern 在某些控件上不可用
   * （只读或 provider 未实现），降级为物理注入。
   * 这个字段是给用户的：写个文本框却抢了键盘，应该能查到原因。
   */
  degradedFrom?: string;
  availableSemantic: string[];
  clientPoint?: { x: number; y: number };
  targetDepth?: number;
  hwndSource?: string;
  messages: { name: string; ok: boolean }[];
  elapsedMs: number;
}

export interface HelperClientOptions {
  /** Helper 脚本路径。 */
  entryPath: string;
  /** 运行 Helper 的可执行文件（通常是 process.execPath，即 Electron）。 */
  command: string;
  /** 传给 Helper 的环境变量，例如 ELECTRON_RUN_AS_NODE=1。 */
  commandEnv?: Record<string, string>;
  /** Helper 工作目录。 */
  cwd?: string;
  /** 命名管道路径。未提供时自动生成。 */
  socketPath?: string;
  /**
   * 经 creator 启动，而不是直接 spawn host。
   *
   * 传了这个就改用 creator 作为父进程：creator 负责拉起并**保持** host，
   * 自己不做 UIA 调用。这样 host 崩溃可以重启而会话不丢。
   *
   * 管道地址由 host 自己生成、经 creator 的 stdout 回报——
   * 这也是跨会话唯一可行的握手方式（句柄不能跨会话继承）。
   * 因此指定本选项时 `socketPath` 会被忽略。
   */
  creatorPath?: string;
  /** 期望 host 落在的会话。省略表示当前会话。 */
  targetSessionId?: number;
  /** 空闲超时，传给 Helper。 */
  idleTimeoutMs?: number;
  /** 用于测试注入。 */
  logger?: {
    debug: (message: string, meta?: unknown) => void;
    warn: (message: string, meta?: unknown) => void;
    error: (message: string, meta?: unknown) => void;
  };
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class HelperUnavailableError extends Error {
  readonly code = "helper_unavailable";
  constructor(
    message: string,
    readonly detail?: { reason?: string; attempts?: number },
  ) {
    super(message);
    this.name = "HelperUnavailableError";
  }
}
