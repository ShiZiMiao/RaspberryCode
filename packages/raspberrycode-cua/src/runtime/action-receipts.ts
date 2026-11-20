/**
 * 键盘 / 滚动 / 拖拽的收据构造。
 *
 * 与 `receipts.ts` 的区别：那个模块管「错误码与失败收据」，
 * 这里管「动作成功的收据」。分开的理由是两者的演进节奏不同——
 * 失败语义由 spec §6.2 的协议冻结，成功收据的字段还会随能力扩展增加。
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ACTION_RECEIPT_SCHEMA } from "./receipts.ts";

// ---------------------------------------------------------------------------
// 结果构造（键盘/滚动/拖拽）
// ---------------------------------------------------------------------------

/** Helper 的键盘结果形状。 */
export interface KeyReceipt {
  path: string;
  dispatchStatus: "sent" | "not_sent" | "possibly_sent";
  effect: string;
  grabInput?: boolean;
  cursorRestored?: boolean;
  injectedEvents?: number;
  steps?: { step: string; ok: boolean; injected: number; unknownKey?: string }[];
  elapsedMs: number;
}

export function buildKeyResult(receipt: KeyReceipt, method: string): CallToolResult {
  const lines = [
    `path=${receipt.path}`,
    `dispatch_status=${receipt.dispatchStatus}`,
    `effect=${receipt.effect}`,
    `grab_input=true`,
    `cursor_restored=${receipt.cursorRestored !== false}`,
  ];
  return {
    content: [{ type: "text", text: lines.join(" ") }],
    structuredContent: {
      action_receipt: {
        schema_version: ACTION_RECEIPT_SCHEMA,
        method,
        action_sent: receipt.dispatchStatus === "sent",
        dispatch_status: receipt.dispatchStatus,
        effect: receipt.effect,
        retry_action: receipt.dispatchStatus === "not_sent",
      },
      path: receipt.path,
      grabbed_input: true,
      cursor_restored: receipt.cursorRestored,
      injected_events: receipt.injectedEvents,
      steps: receipt.steps,
      elapsed_ms: receipt.elapsedMs,
    },
  };
}

export interface ScrollReceipt {
  path: string;
  dispatchStatus: "sent" | "not_sent" | "possibly_sent";
  effect: string;
  grabInput?: boolean;
  wheelCount: number;
  budget: string;
  elapsedMs: number;
}

export function buildScrollResult(receipt: ScrollReceipt, method: string): CallToolResult {
  const lines = [
    `path=${receipt.path}`,
    `dispatch_status=${receipt.dispatchStatus}`,
    `wheel_count=${receipt.wheelCount}`,
    `grab_input=${receipt.grabInput === true}`,
  ];
  return {
    content: [{ type: "text", text: lines.join(" ") }],
    structuredContent: {
      action_receipt: {
        schema_version: ACTION_RECEIPT_SCHEMA,
        method,
        action_sent: receipt.dispatchStatus === "sent",
        dispatch_status: receipt.dispatchStatus,
        effect: receipt.effect,
        retry_action: receipt.dispatchStatus === "not_sent",
      },
      path: receipt.path,
      budget: receipt.budget,
      wheel_count: receipt.wheelCount,
      grabbed_input: receipt.grabInput === true,
      elapsed_ms: receipt.elapsedMs,
    },
  };
}

export interface DragReceipt {
  path: string;
  dispatchStatus: "sent" | "not_sent" | "possibly_sent";
  effect: string;
  grabInput?: boolean;
  cursorRestored?: boolean;
  injectedEvents?: number;
  failureReason?: string;
  elapsedMs: number;
}

export function buildDragResult(receipt: DragReceipt, method: string): CallToolResult {
  const lines = [
    `path=${receipt.path}`,
    `dispatch_status=${receipt.dispatchStatus}`,
    `effect=${receipt.effect}`,
    "grab_input=true",
    `cursor_restored=${receipt.cursorRestored !== false}`,
  ];
  if (receipt.failureReason) lines.push(`reason=${receipt.failureReason}`);
  return {
    content: [{ type: "text", text: lines.join(" ") }],
    structuredContent: {
      action_receipt: {
        schema_version: ACTION_RECEIPT_SCHEMA,
        method,
        action_sent: receipt.dispatchStatus === "sent",
        dispatch_status: receipt.dispatchStatus,
        effect: receipt.effect,
        retry_action: receipt.dispatchStatus === "not_sent",
      },
      path: receipt.path,
      grabbed_input: true,
      cursor_restored: receipt.cursorRestored,
      injected_events: receipt.injectedEvents,
      failure_reason: receipt.failureReason,
      elapsed_ms: receipt.elapsedMs,
    },
  };
}

/** 在结果后追加一段说明文本，保持 structuredContent 不变。 */
export function appendText(result: CallToolResult, note: string): CallToolResult {
  return {
    content: [...result.content, { type: 'text', text: note }],
    structuredContent: result.structuredContent,
  };
}
