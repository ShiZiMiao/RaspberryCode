/**
 * 坐标目标与定向文本输入的公共实现。
 *
 * 从 `action-handlers.ts` 抽出：这两块都不依赖「按预算选路径」的核心逻辑，
 * 只依赖快照、窗口矩形和元素解析。抽出的另一个收益是动作文件不再持续膨胀。
 */

import { DISPATCH_PATH, type InterferenceBudget } from "./dispatch-plan.ts";
import { normalizeHwnd } from "./dispatch.ts";
import { captureDesktopState, restoreCursorTo, verifyRestoration } from "./foreground.ts";
import { sendEmReplaceSel, sendKeyChord, sendText } from "./input.ts";
import { focusElement, readValuePatternValue, runSemanticAction } from "./patterns.ts";
import type { SnapshotStore } from "./snapshot-store.ts";
import { readNativeWindowHandle } from "./tree.ts";
import { hwndFromWindowKey, isWindowAlive, windowRectOf } from "./window-visibility.ts";

export interface CoordinatePoint {
  x: number;
  y: number;
}

/** 读取坐标目标。只做形状校验，换算在 `resolveCoordinate` 里。 */
export function readCoordinate(
  params: unknown,
  key = "coordinate",
): CoordinatePoint | undefined {
  if (!params || typeof params !== "object") return undefined;
  const raw = (params as Record<string, unknown>)[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.x !== "number" || typeof record.y !== "number") return undefined;
  return { x: record.x, y: record.y };
}

/**
 * 读取坐标空间。
 *
 * 两种坐标语义并存：
 * - 带 `coordinate_space`：`x/y` 是该空间内的像素，按比例换算到窗口。
 * - 不带：`x/y` 是窗口客户区像素（SDK 的 `[x, y]` 历史语义）。
 */
export function readCoordinateSpace(
  params: unknown,
): { width: number; height: number } | undefined {
  if (!params || typeof params !== "object") return undefined;
  const raw = (params as Record<string, unknown>).coordinate_space;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.width !== "number" ||
    typeof record.height !== "number" ||
    record.width <= 0 ||
    record.height <= 0
  ) {
    return undefined;
  }
  return { width: record.width, height: record.height };
}

export interface ResolvedCoordinate {
  snapshot: NonNullable<ReturnType<SnapshotStore["findByStateId"]>>;
  hwnd: bigint;
  screenX: number;
  screenY: number;
  coordinate: CoordinatePoint;
}

/**
 * 把坐标换算成屏幕像素。
 *
 * 必须用**当前窗口矩形**，不能用元素 bounds：元素 bounds 是诊断信息，
 * 窗口移动/缩放后它们与截图不再对应。窗口矩形读不到时明确报错，
 * 不猜一个近似值。
 */
export function resolveCoordinate(
  params: unknown,
  key: string,
  snapshots: SnapshotStore,
): ResolvedCoordinate {
  if (process.platform !== "win32") {
    throw Object.assign(new Error("坐标动作只在 Windows 自研实现上可用。"), {
      code: "unsupported_platform",
    });
  }
  const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
  const stateId = typeof record.stateId === "string" ? record.stateId : undefined;
  if (!stateId) {
    throw Object.assign(new Error("坐标动作需要 stateId（先观察拿到快照）"), {
      code: "bad_request",
    });
  }
  const snapshot = snapshots.findByStateId(stateId);
  if (!snapshot) {
    throw Object.assign(new Error(`stale stateId: ${stateId}（快照已失效，请重新观察）`), {
      code: "state_invalidated",
    });
  }
  const coordinate = readCoordinate(params, key);
  if (!coordinate) {
    throw Object.assign(new Error("坐标动作需要 coordinate: { x, y }"), {
      code: "bad_request",
    });
  }
  // 窗口关闭后 HWND 变成悬空句柄，读矩形只会得到笼统失败。
  // 提前用 windowKey 判定（不碰可能已失效的 COM 指针），
  // 返回 window_closed 让 runtime 映射成 cleanup_pending。
  const stateHwnd = hwndFromWindowKey(snapshot.windowKey);
  if (stateHwnd && !isWindowAlive(stateHwnd)) {
    throw Object.assign(
      new Error(`目标窗口已关闭（stateId=${stateId}），请重新观察或重新选择窗口`),
      { code: "window_closed" },
    );
  }
  const hwnd = normalizeHwnd(readNativeWindowHandle(snapshot.rootElement));
  if (!hwnd) {
    throw Object.assign(new Error("无法获取窗口句柄，坐标动作不可用"), {
      code: "element_unavailable",
    });
  }
  const rect = windowRectOf(hwnd);
  if (!rect) {
    throw Object.assign(new Error("读不到窗口矩形，坐标动作不可用"), {
      code: "element_unavailable",
    });
  }
  const space = readCoordinateSpace(params);
  const screenX = space
    ? rect.x + Math.round((coordinate.x / space.width) * rect.width)
    : rect.x + Math.round(coordinate.x);
  const screenY = space
    ? rect.y + Math.round((coordinate.y / space.height) * rect.height)
    : rect.y + Math.round(coordinate.y);
  return { snapshot, hwnd, screenX, screenY, coordinate };
}

/** 元素解析函数的最小形状（由 `action-handlers.ts` 注入）。 */
export type ResolveElementForText = (
  stateId: string | undefined,
  index: number | undefined,
) => {
  node: { kind: string; name: string; inputTarget: boolean };
  element: unknown;
};

/**
 * 构造定向文本输入 handler。
 *
 * 两条路径，按可靠性排序：
 *   1. ValuePattern：读当前值 → 追加文本 → SetValue。
 *   2. EM_REPLACESEL：直接投给元素自己的 HWND。
 *
 * 两条都不可用时明确报错，由 runtime 决定是否在授权后降级到物理注入。
 */
export function createTypeIntoElementHandler(resolveElement: ResolveElementForText) {
  return (params: unknown) => {
    const startedAt = Date.now();
    const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
    const stateId = typeof record.stateId === "string" ? record.stateId : undefined;
    const index = typeof record.index === "number" ? record.index : undefined;
    const text = typeof record.text === "string" ? record.text : undefined;
    if (text === undefined) {
      throw Object.assign(new Error("type_into_element 需要 text"), { code: "bad_request" });
    }

    const { node, element } = resolveElement(stateId, index);
    if (!node.inputTarget) {
      throw Object.assign(
        new Error(
          `元素 ${index}（${node.kind}${node.name ? ` "${node.name}"` : ""}）标记为 ` +
            "input_target=false，不能作为文本输入目标。请换一个可编辑元素，或先重新观察。",
        ),
        { code: "element_unavailable", detail: { inputTarget: false } },
      );
    }

    const current = readValuePatternValue(element);
    if (current.ok) {
      const next = `${current.value ?? ""}${text}`;
      const outcome = runSemanticAction(element, "set_value", next);
      if (outcome?.ok) {
        return {
          path: DISPATCH_PATH.AX_TEXT,
          dispatchStatus: "sent",
          effect: "unverifiable",
          activatesWindow: false,
          grabInput: false,
          receiverFocus: "unknown",
          stateId,
          index,
          elementKind: node.kind,
          elementName: node.name,
          semanticAction: "set_value",
          pattern: outcome.pattern,
          hresult: outcome.hresult,
          insertedLength: text.length,
          elapsedMs: Date.now() - startedAt,
        };
      }
    }

    const hwnd = normalizeHwnd(readNativeWindowHandle(element));
    if (hwnd) {
      const ok = sendEmReplaceSel(hwnd, text);
      if (ok) {
        return {
          path: DISPATCH_PATH.AX_TEXT,
          dispatchStatus: "sent",
          effect: "unverifiable",
          activatesWindow: false,
          grabInput: false,
          receiverFocus: "unknown",
          stateId,
          index,
          elementKind: node.kind,
          elementName: node.name,
          semanticAction: "em_replacesel",
          insertedLength: text.length,
          elapsedMs: Date.now() - startedAt,
        };
      }
    }

    throw Object.assign(
      new Error(
        `元素 ${index}（${node.kind}${node.name ? ` "${node.name}"` : ""}）不支持定向文本输入：` +
          "ValuePattern 与 EM_REPLACESEL 都不可用。可改用 set_value 整体替换，" +
          "或在授权后走物理注入。",
      ),
      { code: "element_unavailable", detail: { inputTarget: node.inputTarget } },
    );
  };
}

/**
 * 通过「聚焦 → 全选 → 输入」写入文本。
 *
 * 这是 `set_value` 的**降级路径**，在 ValuePattern 不可用时启用：
 * 控件只读、provider 没实现该 pattern、或 UIA 拒绝了写操作。
 *
 * 与 `key` 方法的区别：这个带「先清空」语义（Ctrl+A 再输入），
 * 因此结果与 ValuePattern 的「整体替换」一致，而不是追加。
 *
 * 全程物理注入，调用方必须已确认授权。
 */
export function setValueByTyping(input: {
  element: unknown;
  node: { kind: string; name: string };
  value: string;
  startedAt: number;
  budget: InterferenceBudget;
  stateId: string;
  index: number;
}): Record<string, unknown> {
  const before = captureDesktopState();
  const steps: { step: string; ok: boolean; injected: number; unknownKey?: string }[] = [];

  try {
    // 1. 聚焦目标。UIA 的 SetFocus 会激活窗口，这是必然的干扰，如实披露。
    focusElement(input.element);

    // 2. 全选后输入等价于「整体替换」。
    //    目标值为空时只全选再删除，避免残留旧内容。
    const selectAll = sendKeyChord("ctrl+a");
    steps.push({ step: "select_all", ok: selectAll.ok, injected: selectAll.injected });

    const text = input.value;
    const typed = text.length > 0 ? sendText(text) : sendKeyChord("Delete");
    steps.push({
      step: text.length > 0 ? `text:${text.length}chars` : "clear",
      ok: typed.ok,
      injected: typed.injected,
    });
  } finally {
    restoreCursorTo(before);
  }

  const restored = verifyRestoration(before);
  const totalInjected = steps.reduce((sum, s) => sum + s.injected, 0);

  return {
    path: DISPATCH_PATH.FOREGROUND_SEND_INPUT,
    dispatchStatus: totalInjected > 0 ? "sent" : "not_sent",
    effect: "unverifiable",
    escalated: true,
    budget: input.budget,
    stateId: input.stateId,
    index: input.index,
    elementKind: input.node.kind,
    elementName: input.node.name,
    activatesWindow: true,
    grabInput: true,
    cursorRestored: restored.cursorRestored,
    injectedEvents: totalInjected,
    // 明确标注这是降级路径：set_value 名义上是二阶能力，实际走了三级。
    // 用户有权知道「写个文本框为什么抢了我的键盘」。
    degradedFrom: "value_pattern",
    steps,
    messages: [],
    elapsedMs: Date.now() - input.startedAt,
  };
}
