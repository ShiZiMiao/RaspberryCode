/**
 * SDK 契约适配层。
 *
 * 上游的模型面是 14 个方法（`list_apps` / `left_click` / `type` / `key` …），
 * 由 plugin SDK 通过 bridge 直接以方法名调用 `runtime.execute({ toolName })`。
 * 本模块负责把这套外部契约翻译成 Helper 的内部能力。
 *
 * 为什么不把 Helper 的方法改成这 14 个名字：Helper 是执行层，它的方法与
 * 「模型想做什么」不是一一对应——例如 `left_click` 在 Helper 侧要按预算拆成
 * `post_message` / `ax` / `foreground_send_input` 三条完全不同的路径。
 * 保持两层分离，执行层才能独立演进（将来加四级提权不必动模型面）。
 *
 * 参数命名也必须翻译：SDK 用 snake_case（`app_ref`、`disable_diffing`、`tree_shown_to_model`），
 * 这是 `.strict()` 校验过的外部契约，改不了。Helper 内部用 camelCase。
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ActReceipt } from "./helper-client.ts";

/** SDK 暴露的 14 个方法名。事实来源是 plugin SDK 的 COMPUTER_METHOD_NAMES。 */
export const SDK_METHODS = Object.freeze({
  LIST_APPS: "list_apps",
  LIST_WINDOWS: "list_windows",
  GET_APP_STATE: "get_app_state",
  LEFT_CLICK: "left_click",
  SCROLL: "scroll",
  LEFT_CLICK_DRAG: "left_click_drag",
  TYPE: "type",
  SET_VALUE: "set_value",
  SELECT_TEXT: "select_text",
  KEY: "key",
  PERFORM_ACTION: "perform_action",
  PASTE: "paste",
  REQUEST_ACCESS: "request_access",
  STOP_COMPUTER_CONTROL: "stop_computer_control",
} as const);

export type SdkMethod = (typeof SDK_METHODS)[keyof typeof SDK_METHODS];

/** 需要改变 UI 的方法。它们的失败语义是 `possibly_sent`，不可盲目重试。 */
export const MUTATING_METHODS: ReadonlySet<string> = new Set([
  SDK_METHODS.LEFT_CLICK,
  SDK_METHODS.SCROLL,
  SDK_METHODS.LEFT_CLICK_DRAG,
  SDK_METHODS.TYPE,
  SDK_METHODS.SET_VALUE,
  SDK_METHODS.SELECT_TEXT,
  SDK_METHODS.KEY,
  SDK_METHODS.PERFORM_ACTION,
  SDK_METHODS.PASTE,
  SDK_METHODS.STOP_COMPUTER_CONTROL,
]);

/** 预算与授权。由宿主从会话上下文注入，不从方法参数读。 */
export interface DispatchPolicy {
  budget: "quiet" | "balanced" | "unrestricted";
  allowPhysicalInjection: boolean;
}

// ---------------------------------------------------------------------------
// 结果构造
// ---------------------------------------------------------------------------

/**
 * 构造观察结果。
 *
 * SDK 的 `appStateOf` 强制要求 `state_id` / `elements` / `app` / `window` 四个字段，
 * 缺任何一个直接抛 `STRUCTURED_STATE_UNAVAILABLE`，模型完全看不到树。
 * 因此这四个字段不是「可选增强」，是**硬性契约**。
 *
 * `elements` 的形状按 SDK 的消费方式决定：它用 `elements[index].value` 做
 * `selectText` 的文本定位，用 `elements[index].index` 做元素目标。
 */
export interface ObservationInput {
  text: string;
  stateId: string;
  appName: string;
  processId: number | undefined;
  frameworkId: string;
  mode: "full" | "delta";
  nodeCount: number;
  truncated: boolean;
  truncationReason: string | undefined;
  brittleTree: boolean;
  elapsedMs: number;
  windowKey: string;
  elements: {
    index: number;
    kind: string;
    name: string;
    value: string;
    states: string[];
    bounds: { left: number; top: number; width: number; height: number } | undefined;
    actions: string[];
  }[];
  baseStateId?: string;
}

export function buildObservationResult(input: ObservationInput): CallToolResult {
  const app = {
    name: input.appName,
    process_id: input.processId ?? null,
    app_ref: String(input.processId ?? input.appName),
  };
  const window = {
    title: input.appName,
    key: input.windowKey,
    framework: input.frameworkId || "unknown",
  };

  return {
    content: [{ type: "text", text: input.text }],
    structuredContent: {
      // SDK 的 appStateOf 直接读这四个顶层键
      state_id: input.stateId,
      app,
      window,
      elements: input.elements,
      text: input.text,
      snapshot_mode: input.mode,
      ...(input.baseStateId ? { base_state_id: input.baseStateId } : {}),
      // 诊断字段
      node_count: input.nodeCount,
      truncated: input.truncated,
      truncation_reason: input.truncationReason,
      brittle_tree: input.brittleTree,
      elapsed_ms: input.elapsedMs,
      // app 关联元数据：broker 用它给会话打 computer_use 标签
      _meta: {
        "raspberrycode/cua-app-associations": {
          primary: {
            appKey: String(input.processId ?? input.appName),
            displayName: input.appName,
          },
        },
      },
    },
  };
}

/**
 * 构造动作结果。
 *
 * SDK 只对**变更类**方法检查收据；观察类不检查。因此这里统一给出收据，
 * 让 SDK 的 `possibly_sent` 判定有据可依。
 */
export function buildActionResult(
  receipt: ActReceipt,
  method: string,
): CallToolResult {
  const lines = [
    `path=${receipt.path}`,
    `dispatch_status=${receipt.dispatchStatus}`,
    `effect=${receipt.effect}`,
  ];
  if (receipt.semanticAction) lines.push(`semantic=${receipt.semanticAction}`);
  if (receipt.activatesWindow) lines.push("activated_window=true");
  if (receipt.path === "foreground_send_input") {
    lines.push("grab_input=true");
    lines.push(`cursor_restored=${receipt.cursorRestored !== false}`);
  }
  if (receipt.screenPoint) {
    lines.push(`point=${receipt.screenPoint.x},${receipt.screenPoint.y}`);
  }

  return {
    content: [{ type: "text", text: lines.join(" ") }],
    structuredContent: {
      action_receipt: {
        schema_version: "raspberrycode-cua-action-receipt-v1",
        method,
        action_sent:
          receipt.dispatchStatus === "sent" || receipt.dispatchStatus === "possibly_sent",
        dispatch_status: receipt.dispatchStatus,
        effect: receipt.effect,
        retry_action: receipt.dispatchStatus === "not_sent",
      },
      path: receipt.path,
      budget: receipt.budget,
      escalated: receipt.escalated,
      state_id: receipt.stateId,
      element_index: receipt.index,
      semantic_action: receipt.semanticAction,
      activates_window: receipt.activatesWindow ?? false,
      grabbed_input: receipt.path === "foreground_send_input",
      cursor_restored: receipt.cursorRestored,
      // 降级来源：让用户能查到「为什么这个动作走了更重的那条路」
      ...(receipt.degradedFrom ? { degraded_from: receipt.degradedFrom } : {}),
      elapsed_ms: receipt.elapsedMs,
    },
  };
}

