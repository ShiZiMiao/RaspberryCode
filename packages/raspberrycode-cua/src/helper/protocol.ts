/**
 * Windows CUA Helper 的命名管道协议常量与帧编解码。
 *
 * 协议形态：一行一条 JSON（NDJSON），一问一答。选择行分隔而非长度前缀，
 * 是为了让调试时可以直接用 nc / telnet 观察流量，也便于人工构造测试用例。
 *
 * 详见 docs/cua/2026-11-19-windows-cua-self-hosted-spec.md §4。
 */

/** 单条请求/响应的最大字节数。超过即视为协议错误并断开，防止被撑爆内存。 */
export const MAX_LINE_BYTES = 4 * 1024 * 1024;

/** 单次请求的处理超时。超时后回错误而不是无限等待。 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Helper 与宿主之间的协议版本。任一侧不匹配即拒绝连接。 */
export const HELPER_PROTOCOL_VERSION = 1;

/**
 * Helper 支持的方法名。
 *
 * 只列出 P0 阶段实现的部分；后续阶段（观察、动作）在此扩展。
 * 保持为常量表而非字符串字面量散落各处，便于一处核对全集。
 */
export const HELPER_METHODS = Object.freeze({
  /** 存活探测。宿主在每个动作前调用，要求极快且无副作用。 */
  PING: "ping",
  /** 协议版本与能力协商。连接建立后必须首先调用。 */
  HANDSHAKE: "handshake",
  /** UIA 运行时探活：确认 COM 可初始化、IUIAutomation 可创建。 */
  UIA_PROBE: "uia_probe",
  /** 枚举所有顶层窗口。 */
  LIST_WINDOWS: "list_windows",
  /** 采集指定窗口（或 pid）的无障碍树快照。 */
  CAPTURE: "capture",
  /** 用一级路径（消息投递）在元素中心执行点击。 */
  CLICK: "click",
  /**
   * 按预算选择路径执行动作，并返回完整收据。
   *
   * 与 `click` 的区别：`click` 是一级的专用入口（行为固定），
   * `act` 是带策略的通用入口（按 budget 选路径）。
   */
  ACT: "act",
  /**
   * 键盘输入：发送文本、按键或组合键。
   *
   * 单独成一个方法（而不是加到 act 里）：键盘与鼠标的路径选择规则完全不同。
   * 鼠标单击可以走消息投递（零干扰），键盘不行——键盘依赖焦点，
   * 投递给后台窗口的 `WM_KEYDOWN` 在 Chromium / WPF / WinUI 上都被忽略。
   * 因此键盘**恒走物理注入**，需要授权的判断在 runtime 侧。
   */
  KEY: "key",
  /** 滚动：滚轮消息或物理注入。 */
  SCROLL: "scroll",
  /** 拖拽：必须物理注入（需要连续轨迹）。 */
  DRAG: "drag",
  /**
   * 文本选区：按字符区间选中控件内的文本（UIA TextPattern）。
   *
   * 单独成一个方法：它是唯一一个「改变控件内部选择状态」的动作，
   * 既不是点击也不是写值。塞进 `act` 会让那套按意图规划的路径选择
   * 多出一条没有路径可选的意图（选区只有 TextPattern 一条路）。
   */
  SELECT_TEXT: "select_text",
  /**
   * 会话拓扑与跨会话能力探测。
   *
   * 单独成一个方法而不是塞进 ping：它是**诊断信息**，调用频率低、
   * 结果带解释文本，与「存活探测」的极简语义不同。
   * 模型问「能不能操作另一个会话的应用」时走这里。
   */
  SESSIONS: "sessions",
  /** 窗口画面回传（PNG）。用于无障碍树拿不到内容的场景。 */
  SCREENSHOT: "screenshot",
  /**
   * 独立桌面（子会话）能力判定。
   *
   * 只判定不创建：创建需要 SYSTEM 权限，本实现不做。
   * 但「能不能用、差在哪一道门」必须能查到，否则用户只能盲试。
   */
  ISOLATED_DESKTOP: "isolated_desktop",
  /**
   * 把窗口移出屏幕 / 移回。
   *
   * 用途：让窗口「用户看不见但客户区仍在」，从而使采集持续可用。
   * 这是最小化的替代方案——最小化会销毁客户区（`ClientRect=0x0`），
   * 两条采集路（PrintWindow / WGC）都失效。
   */
  WINDOW_OFFSCREEN: "window_offscreen",
} as const);

export type HelperMethod = (typeof HELPER_METHODS)[keyof typeof HELPER_METHODS];

/** 请求帧。`id` 由调用方生成，响应原样带回，用于匹配一问一答。 */
export interface HelperRequest {
  id: string | number;
  method: string;
  params?: unknown;
}

/** 成功响应。 */
export interface HelperSuccessResponse {
  id: string | number | null;
  ok: true;
  result: unknown;
}

/** 失败响应。`code` 是稳定的机器可读错误码，`message` 面向人。 */
export interface HelperErrorResponse {
  id: string | number | null;
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type HelperResponse = HelperSuccessResponse | HelperErrorResponse;

/** 协议层错误码。动作层的错误码在后续阶段单独定义。 */
export const HELPER_ERROR_CODES = Object.freeze({
  /** 请求体不是合法 JSON。 */
  BAD_JSON: "bad_json",
  /** 缺 id / method，或字段类型不符。 */
  BAD_REQUEST: "bad_request",
  /** 方法名不在 HELPER_METHODS 中。 */
  METHOD_NOT_FOUND: "method_not_found",
  /** 单条超过 MAX_LINE_BYTES。 */
  LINE_TOO_LONG: "line_too_long",
  /** 处理超时。 */
  TIMEOUT: "timeout",
  /** 处理过程中抛出未预期异常。 */
  INTERNAL: "internal",
  /** 协议版本不匹配。 */
  VERSION_MISMATCH: "version_mismatch",
} as const);

/**
 * 从字节流的缓冲区中切出完整行。
 *
 * 返回切出的行与剩余缓冲。剩余部分保留给下一次读取，因为一次 data 事件
 * 可能包含半行（大响应）或多行（批量请求）。
 */
export function takeLines(buffer: string, maxLineBytes = MAX_LINE_BYTES): {
  lines: string[];
  rest: string;
  tooLong: boolean;
} {
  const lines: string[] = [];
  let rest = buffer;
  let nl: number;
  while ((nl = rest.indexOf("\n")) >= 0) {
    const line = rest.slice(0, nl);
    rest = rest.slice(nl + 1);
    // 容忍 CRLF：Windows 侧的管道对端可能带上 \r
    lines.push(line.endsWith("\r") ? line.slice(0, -1) : line);
  }
  // 剩余缓冲超过上限说明对端没有按行协议发数据，判定为畸形输入
  const tooLong = rest.length > maxLineBytes;
  return { lines, rest: tooLong ? "" : rest, tooLong };
}

/** 解析一行请求。返回 undefined 表示不是合法请求，调用方应回 BAD_REQUEST。 */
export function parseRequestLine(line: string): HelperRequest | undefined {
  if (!line.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  if (typeof record.method !== "string" || !record.method) return undefined;
  return { id, method: record.method, params: record.params };
}

/**
 * 解析一行响应。
 *
 * 与 parseRequestLine 分开：响应帧没有 method 字段，
 * 共用请求解析器会把所有响应判为非法而静默丢弃。
 */
export function parseResponseLine(line: string): HelperResponse | undefined {
  if (!line.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== "string" && typeof id !== "number" && id !== null) return undefined;

  if (record.ok === true) {
    return { id, ok: true, result: record.result };
  }
  if (record.ok === false) {
    const error = record.error;
    if (!error || typeof error !== "object") return undefined;
    const errorRecord = error as Record<string, unknown>;
    if (typeof errorRecord.code !== "string" || typeof errorRecord.message !== "string") {
      return undefined;
    }
    return { id, ok: false, error: { code: errorRecord.code, message: errorRecord.message } };
  }
  return undefined;
}

/** 序列化响应为一行（含结尾换行）。 */
export function serializeResponse(response: HelperResponse): string {
  return `${JSON.stringify(response)}\n`;
}

/** 构造成功响应。 */
export function okResponse(id: string | number | null, result: unknown): HelperSuccessResponse {
  return { id, ok: true, result };
}

/** 构造失败响应。 */
export function errorResponse(
  id: string | number | null,
  code: string,
  message: string,
): HelperErrorResponse {
  return { id, ok: false, error: { code, message } };
}
