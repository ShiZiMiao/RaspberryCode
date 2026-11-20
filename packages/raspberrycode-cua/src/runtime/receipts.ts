/**
 * 收据与错误码。
 *
 * 设计依据（spec §6）：
 *
 * 1. **三种发送状态必须区分**：`not_sent` / `sent` / `possibly_sent`。
 *    只有 `not_sent` 允许重试——`possibly_sent` 重试会造成重复副作用。
 *
 * 2. **收据块必须排在树之前**：宿主若截断长树，必须先保住 `dispatch_status`，
 *    否则模型会失去「这个动作到底有没有发出去」这个关键事实。
 *
 * 3. **错误码要能分流**：模型据此决定「换个操作」「重新观察」还是「告知用户」。
 *    一个笼统的 INTERNAL 会让模型反复徒劳重试。
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** 动作回执的 schema 版本。字段变更时递增，宿主据此做兼容。 */
export const ACTION_RECEIPT_SCHEMA = "raspberrycode-cua-action-receipt-v1";

/**
 * 派发错误码。
 *
 * 分三组，对应模型应当采取的不同行动：
 * - 参数/目标类（重试无意义，需修正参数或重新观察）
 * - 环境类（需用户介入）
 * - 平台类（不可恢复）
 */
export const DISPATCH_ERROR_CODES = Object.freeze({
  /** 参数缺失或类型错误。模型应修正参数。 */
  BAD_REQUEST: "bad_request",
  /** 目标窗口不存在。模型应重新列出窗口。 */
  WINDOW_NOT_FOUND: "window_not_found",
  /** 元素索引越界或元素已消失。模型应重新观察。 */
  ELEMENT_UNAVAILABLE: "element_unavailable",
  /** stateId 已失效（Helper 重启或快照被淘汰）。模型必须重新观察。 */
  STATE_INVALIDATED: "state_invalidated",
  /** Helper 不可用。模型应停止尝试并告知用户。 */
  HELPER_UNAVAILABLE: "helper_unavailable",
  /**
   * 当前预算不允许完成该动作。
   *
   * 注意这是**用户设定的限制**，不是失败。模型应换等效操作，
   * 或如实告知用户「该操作需要前台窗口」。
   */
  FOREGROUND_REQUIRED: "foreground_required",
  /**
   * 需要用户显式授权物理注入（三级）。v1 里三级即使用户授权也不执行，
   * 因此这是终态，模型不应重试。
   */
  AUTHORIZATION_REQUIRED: "authorization_required",
  /** 工具名未实现。属编程错误，不应由重试解决。 */
  UNKNOWN_TOOL: "unknown_tool",
  /** 当前平台不支持。不可恢复。 */
  UNSUPPORTED_PLATFORM: "unsupported_platform",
  /** 内部错误。未分类的异常兜底。 */
  INTERNAL: "internal",
});

export type DispatchErrorCode =
  (typeof DISPATCH_ERROR_CODES)[keyof typeof DISPATCH_ERROR_CODES];

/**
 * 错误码 → 建议的恢复动作。
 *
 * 这个映射是给模型的提示，写在错误文本里——因为模型看不到本文件的源码，
 * 只能从错误消息推断下一步。缺了它模型会倾向于盲目重试。
 */
const RECOVERY_HINT: Readonly<Record<string, string>> = {
  [DISPATCH_ERROR_CODES.BAD_REQUEST]: "修正参数后重试。",
  [DISPATCH_ERROR_CODES.WINDOW_NOT_FOUND]: "先调用 list_windows 重新确认目标窗口。",
  [DISPATCH_ERROR_CODES.ELEMENT_UNAVAILABLE]: "重新观察以获取新的元素索引，不要复用旧索引。",
  [DISPATCH_ERROR_CODES.STATE_INVALIDATED]: "重新观察以获取新的 stateId，旧索引已全部失效。",
  [DISPATCH_ERROR_CODES.HELPER_UNAVAILABLE]: "停止尝试，告知用户需要重启应用。",
  [DISPATCH_ERROR_CODES.FOREGROUND_REQUIRED]:
    "该操作在当前预算下做不到。换用不需要前台窗口的等效操作；若确实必须，如实告知用户需要放宽预算。",
  [DISPATCH_ERROR_CODES.AUTHORIZATION_REQUIRED]:
    "该操作需要用户在设置中显式授权物理注入。不要重试，如实告知用户。",
  [DISPATCH_ERROR_CODES.UNKNOWN_TOOL]: "这是实现缺陷，不要重试。",
  [DISPATCH_ERROR_CODES.UNSUPPORTED_PLATFORM]: "当前平台不支持该能力，不要重试。",
  [DISPATCH_ERROR_CODES.INTERNAL]: "先重新观察；若仍失败，如实报告无法完成。",
};

/** 分类后的错误。 */
export interface ClassifiedError {
  code: DispatchErrorCode;
  message: string;
  /** 动作是否可能已经发出。对重试决策至关重要。 */
  actionSent: boolean;
  detail?: Record<string, unknown>;
}

/**
 * 把任意异常映射成稳定的错误码。
 *
 * 优先读异常自带的 `code`（Helper 的协议错误码直接透传），
 * 否则按错误消息特征归类，最后兜底 INTERNAL。
 *
 * 关键判断：Helper 连接类错误一律视为 `actionSent: false`——
 * 连接断开说明请求没送达。但如果是「请求已发出后超时」，
 * 就属于 possibly_sent，必须标记为可能已发送。
 */
export function classifyError(error: unknown): ClassifiedError {
  const record = error as
    | { code?: string; message?: string; detail?: Record<string, unknown> }
    | undefined;
  const message = record?.message ?? (error instanceof Error ? error.message : String(error));
  // 调用方挂上来的结构化细节（如请求的 path、预算）原样透传，
  // 让模型的错误收据里也能看到「我是按哪条路走的、为什么被拒」。
  const passthroughDetail =
    record?.detail && typeof record.detail === "object" ? record.detail : undefined;

  // Helper 侧透传的协议错误码
  switch (record?.code) {
    case "state_invalidated":
      return {
        code: DISPATCH_ERROR_CODES.STATE_INVALIDATED,
        message,
        actionSent: false,
        detail: passthroughDetail,
      };
    case "element_unavailable":
      return {
        code: DISPATCH_ERROR_CODES.ELEMENT_UNAVAILABLE,
        message,
        actionSent: false,
        detail: passthroughDetail,
      };
    case "window_not_found":
      return {
        code: DISPATCH_ERROR_CODES.WINDOW_NOT_FOUND,
        message,
        actionSent: false,
        detail: passthroughDetail,
      };
    case "bad_request":
      return {
        code: DISPATCH_ERROR_CODES.BAD_REQUEST,
        message,
        actionSent: false,
        detail: passthroughDetail,
      };
    case "foreground_required":
      return {
        code: DISPATCH_ERROR_CODES.FOREGROUND_REQUIRED,
        message,
        actionSent: false,
        detail: passthroughDetail,
      };
    case "authorization_required":
      return {
        code: DISPATCH_ERROR_CODES.AUTHORIZATION_REQUIRED,
        message,
        actionSent: false,
        detail: passthroughDetail,
      };
    case "unsupported_platform":
      return {
        code: DISPATCH_ERROR_CODES.UNSUPPORTED_PLATFORM,
        message,
        actionSent: false,
        detail: passthroughDetail,
      };
    case "helper_unavailable":
      // 超时属于「可能已发送」——请求可能到了对端但响应丢了
      return {
        code: DISPATCH_ERROR_CODES.HELPER_UNAVAILABLE,
        message,
        actionSent: (record.detail?.reason as string | undefined) === "timeout",
        detail: passthroughDetail,
      };
    default:
      break;
  }

  if (record?.code === "timeout") {
    return {
      code: DISPATCH_ERROR_CODES.HELPER_UNAVAILABLE,
      message,
      actionSent: true,
      detail: { reason: "timeout" },
    };
  }

  if (/helper 请求超时/.test(message)) {
    return {
      code: DISPATCH_ERROR_CODES.HELPER_UNAVAILABLE,
      message,
      actionSent: true,
      detail: { reason: "request_timeout" },
    };
  }
  if (/helper/.test(message)) {
    return { code: DISPATCH_ERROR_CODES.HELPER_UNAVAILABLE, message, actionSent: false };
  }
  if (/out of range|no bounding rectangle|no usable window handle/i.test(message)) {
    return { code: DISPATCH_ERROR_CODES.ELEMENT_UNAVAILABLE, message, actionSent: false };
  }
  if (/stale stateId/i.test(message)) {
    return { code: DISPATCH_ERROR_CODES.STATE_INVALIDATED, message, actionSent: false };
  }
  if (/not found/i.test(message)) {
    return { code: DISPATCH_ERROR_CODES.WINDOW_NOT_FOUND, message, actionSent: false };
  }

  return { code: DISPATCH_ERROR_CODES.INTERNAL, message, actionSent: false };
}

/**
 * 构造纯文本结果。
 *
 * 用于观察类返回（树文本本身是主体，不需要结构化包装）。
 */
export function buildTextResult(
  text: string,
  structured?: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/**
 * 构造错误结果。
 *
 * 三条不可省略的信息：
 * 1. `code` —— 机器可读，供上层分流
 * 2. `action_sent` —— 决定能不能重试
 * 3. 恢复建议 —— 让模型知道下一步该做什么，而不是盲目重试
 */
export function buildErrorResult(
  code: DispatchErrorCode,
  message: string,
  options: {
    tool?: string;
    actionSent?: boolean;
    detail?: Record<string, unknown>;
  } = {},
): CallToolResult {
  const hint = RECOVERY_HINT[code];
  const lines = [message];
  if (hint) lines.push(hint);
  if (options.actionSent) {
    lines.push("注意：该动作可能已经生效，请先观察当前状态再决定，不要直接重试。");
  }
  // 把请求上下文写进文本：模型看不到 structuredContent 之外的东西，
  // 而「我原本想走哪条路 / 当前预算是什么」是它判断下一步的关键。
  if (options.detail) {
    const requestedPath = options.detail.requested_path;
    const budget = options.detail.budget;
    if (typeof requestedPath === "string") lines.push(`requested_path=${requestedPath}`);
    if (typeof budget === "string") lines.push(`budget=${budget}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: true,
    structuredContent: {
      action_receipt: {
        schema_version: ACTION_RECEIPT_SCHEMA,
        action_sent: options.actionSent === true,
        dispatch_status: options.actionSent ? "possibly_sent" : "not_sent",
        retry_action: options.actionSent !== true && isRetryable(code),
      },
      code,
      tool: options.tool,
      ...(options.detail ? { detail: options.detail } : {}),
    },
  };
}

/** 只有「确定未发送且非环境类」的错误才建议重试。 */
function isRetryable(code: DispatchErrorCode): boolean {
  return (
    code === DISPATCH_ERROR_CODES.BAD_REQUEST ||
    code === DISPATCH_ERROR_CODES.WINDOW_NOT_FOUND ||
    code === DISPATCH_ERROR_CODES.ELEMENT_UNAVAILABLE ||
    code === DISPATCH_ERROR_CODES.STATE_INVALIDATED
  );
}
