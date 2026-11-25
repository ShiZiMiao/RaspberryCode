/**
 * Runtime 侧的工具处理函数。
 *
 * 从 `index.ts` 抽出，理由：入口文件要管 `createComputerUseRuntime` 的
 * 生命周期、熔断与路径解析，再塞进 12 个 handler 会超出可读范围。
 *
 * 每个 handler 只做「参数翻译 + 调用 Helper + 组织结果」三件事。
 * 真正的路径选择（一级/二级/三级）在 Helper 里，因为只有它知道元素支持什么。
 *
 * 会话诊断在 `session-diagnostics.ts`，动作收据在 `action-receipts.ts`。
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CuaHelperClient } from "./helper-client.ts";
import {
  DISPATCH_ERROR_CODES,
  buildErrorResult,
  buildTextResult,
  classifyError,
} from "./receipts.ts";
import {
  SDK_METHODS,
  buildActionResult,
  buildObservationResult,
  type DispatchPolicy,
} from "./sdk-contract.ts";
import {
  appendText,
  buildDragResult,
  buildKeyResult,
  buildScrollResult,
} from "./action-receipts.ts";
import { rememberAppState } from "./window-lanes.ts";
import {
  appRefObject,
  coerceProcessId,
  ensureObservation,
  parseSdkTarget,
  requireElementTarget,
  requirePhysicalInjection,
  resolveActionTarget,
  resolveOptionalTarget,
  resolvePreferPath,
  titleTailKeys,
  withRequestContext,
} from "./handler-utils.ts";

/** 内部诊断工具名（不属于模型面，仅供脚本与测试直接驱动）。 */
export { handleRequestAccess, handleStopComputerControl } from "./session-diagnostics.ts";

export const TOOL_NAMES = Object.freeze({
  GET_APP_STATE_INTERNAL: "get_app_state",
  ACT: "act",
  CLICK: "click",
  /** 会话拓扑诊断。不属于模型面，供脚本与「能否跨会话」判定使用。 */
  SESSIONS: "sessions",
  /** 独立桌面（子会话）能力判定。同样不属于模型面。 */
  ISOLATED_DESKTOP: "isolated_desktop",
  /**
   * 窗口移出屏幕 / 移回。
   *
   * 不属于模型面：这是「让用户看不见」的控制手段，不是操作界面的动作。
   * 由上层（UI）在需要后台采集时调用。
   */
  WINDOW_OFFSCREEN: "window_offscreen",
});

// ---------------------------------------------------------------------------
// 观察
// ---------------------------------------------------------------------------

/**
 * 列出窗口。
 *
 * SDK 的 `list_apps` 与 `list_windows` 都映射到这里：Windows 上「应用」与
 * 「顶层窗口」不是一一对应（一个进程可能有多窗口，UWP 的窗口属于不同进程），
 * 因此统一按窗口返回，让模型自己按 pid/标题判断。
 */
export async function handleListWindows(
  client: CuaHelperClient,
  method: string,
  params: Record<string, unknown> = {},
): Promise<CallToolResult> {
  const scopeRaw = params.scope;
  const scope = scopeRaw === "running" || scopeRaw === "all" ? scopeRaw : undefined;
  const includeWindowIds =
    params.include_window_ids === true || params.includeWindowIds === true;
  const windowLimitRaw = params.window_limit ?? params.windowLimit;
  const windowLimit =
    typeof windowLimitRaw === "number" && Number.isInteger(windowLimitRaw) && windowLimitRaw > 0
      ? windowLimitRaw
      : undefined;

  const { windows, elapsedMs, total, truncated } = await client.listWindows({
    ...(scope ? { scope } : {}),
    ...(includeWindowIds ? { includeWindowIds } : {}),
    ...(windowLimit ? { windowLimit } : {}),
  });
  const lines = windows.map((window) => {
    const bounds = window.bounds
      ? `${Math.round(window.bounds.width)}x${Math.round(window.bounds.height)}@${Math.round(window.bounds.left)},${Math.round(window.bounds.top)}`
      : "no-bounds";
    const framework = window.frameworkId || "unknown";
    return `${window.processId ?? "?"} [${framework}] "${window.title}" ${bounds}`;
  });
  return buildTextResult(
    `Top-level windows (${windows.length}${truncated ? ` of ${total}` : ""}, ${elapsedMs}ms):\n${lines.join("\n")}`,
    {
      method,
      window_count: windows.length,
      total,
      truncated,
      elapsed_ms: elapsedMs,
      windows: windows.map((w) => ({
        process_id: w.processId ?? null,
        window_id: w.window_id ?? w.runtimeId,
        title: w.title,
        class_name: w.className,
        framework: w.frameworkId || "unknown",
        bounds: w.bounds ?? null,
        app_ref: String(w.processId ?? w.title),
      })),
    },
  );
}

export { handleLaunchApp, handleRestoreWindow } from "./window-handlers.ts";

/**
 * 观察应用状态。
 *
 * `include_screenshot` 为真时额外抓一张 PNG 塞进 content。
 * 为什么走 content 而不是 structuredContent：SDK 的 `imageBytesOf` 只认
 * `content[*].type === "image"`，结构化通道是给代码读的，模型看不到图。
 */
export async function handleGetAppState(
  client: CuaHelperClient,
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const processId = coerceProcessId(params);
  const runtimeId =
    typeof params.runtimeId === "string"
      ? params.runtimeId
      : typeof params.app_ref === "string" && !/^\d+$/.test(params.app_ref)
        ? params.app_ref
        : undefined;

  // `app_ref` 的对象形式（SDK 的主要形态）：`{pid}` / `{name}` / `{bundle_id}`。
  //
  // 为什么必须支持：SDK 的 `appRefFor()` 把裸字符串一律转成
  // `{name: "..."}` 或 `{bundle_id: "..."}`（见 computer-use-client.mjs），
  // 只有显式传进进程号时才是字符串。早先只认字符串/数字，
  // 于是模型最常用的 `getApp("记事本")` 直接得到
  // 「需要 app_ref（进程号或窗口标识）」——而它明明给了。
  const objectRef = appRefObject(params);
  if (processId === undefined && !runtimeId && objectRef === undefined) {
    return buildErrorResult(
      DISPATCH_ERROR_CODES.BAD_REQUEST,
      "get_app_state 需要 app_ref（进程号、窗口标题，或 {pid}/{name} 形式）",
      { tool: SDK_METHODS.GET_APP_STATE, actionSent: false },
    );
  }

  const maxDepthRaw = params.max_depths ?? params.maxDepths;
  const maxDepth =
    typeof maxDepthRaw === "number" && Number.isInteger(maxDepthRaw) && maxDepthRaw > 0
      ? maxDepthRaw
      : undefined;
  const disableScreenshot =
    params.disable_screenshot === true || params.disableScreenshot === true;
  const disableDiff =
    params.disable_diff === true ||
    params.disableDiff === true ||
    params.disable_diffing === true ||
    params.disableDiffing === true;

  const snapshot = await client.capture({
    runtimeId,
    processId,
    // `{name}` / `{bundle_id}` 形式：按显示名或进程名在顶层窗口里找目标。
    ...(objectRef ? { appName: objectRef } : {}),
    // SDK 传 disable_diffing / tree_shown_to_model（snake_case），
    // 这是它 .strict() 校验过的契约；内部用 camelCase。
    disableDiffing: disableDiff,
    treeShownToModel: params.tree_shown_to_model === true || params.treeShownToModel === true,
    ...(maxDepth ? { budget: { maxDepth } } : {}),
  });

  let observation = buildObservationResult({
    text: snapshot.text,
    stateId: snapshot.stateId,
    appName: snapshot.windowTitle,
    processId: snapshot.processId,
    frameworkId: snapshot.frameworkId,
    mode: snapshot.mode,
    nodeCount: snapshot.nodeCount,
    truncated: snapshot.truncated,
    truncationReason: snapshot.truncationReason,
    brittleTree: snapshot.brittleTree,
    capacityExceeded: snapshot.capacityExceeded,
    elapsedMs: snapshot.elapsedMs,
    windowKey: snapshot.windowKey,
    coordinateRootId: snapshot.coordinateRootId,
    coordinateSpace: snapshot.coordinateSpace,
    relatedWindows: snapshot.relatedWindows,
    elements: snapshot.elements,
  });

  if (snapshot.capacityExceeded) {
    // 历史快照已满：旧 stateId 可能已被淘汰。明确提示，避免模型拿旧索引反复失败。
    observation = appendText(
      observation,
      "\n[capacity_exceeded: 快照历史已满，旧 stateId 可能失效；请使用本次 state_id。]",
    );
  }

  // 登记「这个应用最近一次观察」，供不带 state_id 的动作解析索引用。
  // SDK 的动作调用只发 app_ref，见 ensureObservation 的注释。
  //
  // 键要覆盖调用方**可能用来找我**的每一种写法：
  // - 进程号（`{pid}` / "1234"）
  // - 窗口标题（list_windows 报出来的那个）
  // - 调用方这次用的 app_ref 原文（`{name:"Notepad"}` → "Notepad"）
  // 少登记一种，那种调用方式就会得到「还没观察过」——
  // 而这在模型看来是「我明明刚观察完」。
  rememberAppState(
    [
      ...(snapshot.processId !== undefined ? [String(snapshot.processId)] : []),
      snapshot.windowTitle,
      ...(typeof params.app_ref === "string" ? [params.app_ref] : []),
      ...(appRefObject(params) ? [appRefObject(params) as string] : []),
      // 常见写法是把进程名（Notepad）当应用名，标题却是「无标题 - Notepad」。
      // 把标题的末段也登记上，`getApp("Notepad")` 与 `getApp("无标题 - Notepad")` 都能命中。
      ...titleTailKeys(snapshot.windowTitle),
    ].filter(Boolean) as string[],
    snapshot.stateId,
  );

  if (
    disableScreenshot ||
    (params.include_screenshot !== true && params.includeScreenshot !== true)
  ) {
    return observation;
  }

  let capture;
  try {
    capture = await client.screenshot({ stateId: snapshot.stateId });
  } catch (error) {
    return appendText(
      observation,
      `\n[screenshot unavailable: ${error instanceof Error ? error.message : String(error)}]`,
    );
  }

  if (capture.blank) {
    // 纯色图的典型成因是硬件加速窗口没有真正绘制（Chromium 部分模式、
    // WPF 的 GPU 合成）。重试不会改变结果，所以直接说明并指回无障碍树——
    // 否则模型会从「没有图」推断「截图坏了」，进而去抢焦点或改用 shell 排查。
    return appendText(
      observation,
      `\n[screenshot blank: ${capture.blank_reason ?? "窗口未真正绘制"}] ` +
        "The accessibility tree above is complete — act on element indices. " +
        "Re-observing will not change this; do not activate the app to force a repaint.",
    );
  }

  const shotStructured = {
    width: capture.width,
    height: capture.height,
    byte_length: capture.byte_length,
    frame_id: capture.frame_id,
    coordinate_root_id: capture.coordinate_root_id,
    coordinate_space: capture.coordinate_space,
    blank: false,
    ...(capture.may_be_frozen ? { may_be_frozen: true } : {}),
  };

  // 画面可能冻结时**仍然把图交出去**——它有结构信息，比没有好。
  // 但要加一句警告：这张图可能是过期的。
  //
  // 不改成失败的原因：冻结不等于无内容，模型仍可据它判断界面结构。
  // 真正的问题是把过期画面当成当前状态，所以警告而不是拒绝。
  const imageBlock = {
    type: "image" as const,
    data: capture.base64,
    mimeType: capture.mime_type,
  };

  if (capture.may_be_frozen) {
    return {
      content: [
        ...observation.content,
        {
          type: "text" as const,
          text:
            `\n[screenshot may be stale: ${capture.frozen_reason ?? "窗口完全在屏幕外，画面不再更新"}] ` +
            "The tree above is current — act on element indices. " +
            "Do not trust pixel details in this image for verification.",
        },
        imageBlock,
      ],
      structuredContent: {
        ...observation.structuredContent,
        screenshot: shotStructured,
      },
    };
  }

  return {
    content: [...observation.content, imageBlock],
    structuredContent: {
      ...observation.structuredContent,
      screenshot: shotStructured,
    },
  };
}

// ---------------------------------------------------------------------------
// 动作
// ---------------------------------------------------------------------------

/**
 * 点击（SDK 的 `left_click`）。
 *
 * 支持元素索引与坐标两种目标。坐标目标需要先有一次观察才能换算成元素——
 * 这不是限制而是有意的：没有观察就没有 stateId，无法校验界面是否已变化，
 * 盲目点击可能落在完全不同的控件上。
 */
export async function handleLeftClick(
  client: CuaHelperClient,
  params: Record<string, unknown>,
  policy: DispatchPolicy,
): Promise<CallToolResult> {
  const resolved = await resolveActionTarget(client, params);
  if ("error" in resolved) return resolved.error;

  const buttonRaw = params.mouse_button ?? params.button;
  const button = buttonRaw === "right" || buttonRaw === "middle" ? buttonRaw : "left";
  const clickCount =
    typeof params.click_count === "number"
      ? params.click_count
      : typeof params.clickCount === "number"
        ? params.clickCount
        : 1;

  const preferPath = resolvePreferPath(params, policy);
  const receipt = await withRequestContext(
    client.act({
      stateId: resolved.stateId,
      ...("index" in resolved
        ? { index: resolved.index }
        : {
            coordinate: resolved.coordinate,
            ...(resolved.coordinateSpace ? { coordinate_space: resolved.coordinateSpace } : {}),
          }),
      budget: policy.budget,
      allowPhysicalInjection: policy.allowPhysicalInjection,
      intent: { kind: "click", button, clickCount },
      preferPath,
    }),
    {
      requested_path: preferPath ?? "(auto)",
      budget: policy.budget,
      allow_physical_injection: policy.allowPhysicalInjection,
    },
  );

  return buildActionResult(receipt, SDK_METHODS.LEFT_CLICK);
}

/** 文本输入（SDK 的 `type`）。恒为物理注入。 */
export async function handleType(
  client: CuaHelperClient,
  params: Record<string, unknown>,
  policy: DispatchPolicy,
): Promise<CallToolResult> {
  const text = typeof params.text === "string" ? params.text : undefined;
  if (text === undefined) {
    return buildErrorResult(DISPATCH_ERROR_CODES.BAD_REQUEST, "type 需要 text", {
      tool: SDK_METHODS.TYPE,
      actionSent: false,
    });
  }

  const focus = await resolveOptionalTarget(client, params);
  if ("error" in focus) return focus.error;

  // 定向路径：有元素目标时先试 ValuePattern / EM_REPLACESEL。
  // 它不激活窗口，允许在 balanced 预算下使用；失败才考虑物理注入。
  if (focus.stateId !== undefined && focus.index !== undefined) {
    try {
      const receipt = await withRequestContext(
        client.typeIntoElement({ stateId: focus.stateId, index: focus.index, text }),
        { budget: policy.budget, method: SDK_METHODS.TYPE, path: "ax_text" },
      );
      return buildActionResult(receipt, SDK_METHODS.TYPE);
    } catch (error) {
      const classified = classifyError(error);
      // 只有「元素不支持定向输入」才降级；state_invalidated 等错误直接返回，
      // 否则会在错误的快照上继续输入。
      if (classified.code !== DISPATCH_ERROR_CODES.ELEMENT_UNAVAILABLE) {
        return buildErrorResult(classified.code, classified.message, {
          tool: SDK_METHODS.TYPE,
          actionSent: classified.actionSent,
          detail: classified.detail,
        });
      }
    }
  }

  // 物理注入兜底：预算不足时明确拒绝，不静默降级。
  const blocked = requirePhysicalInjection(policy, "键盘输入");
  if (blocked) {
    return buildErrorResult(blocked.code, blocked.message, {
      tool: SDK_METHODS.TYPE,
      actionSent: false,
      detail: { budget: policy.budget, allow_physical_injection: policy.allowPhysicalInjection },
    });
  }

  const result = await withRequestContext(
    client.sendKey({ stateId: focus.stateId, targetIndex: focus.index, text }),
    { budget: policy.budget, method: SDK_METHODS.TYPE },
  );

  return buildKeyResult(result, SDK_METHODS.TYPE);
}

/** 按键/组合键（SDK 的 `key`）。恒为物理注入。 */
export async function handleKey(
  client: CuaHelperClient,
  params: Record<string, unknown>,
  policy: DispatchPolicy,
): Promise<CallToolResult> {
  const chord = typeof params.text === "string" ? params.text : undefined;
  if (!chord) {
    return buildErrorResult(DISPATCH_ERROR_CODES.BAD_REQUEST, "key 需要 text（键名或组合键）", {
      tool: SDK_METHODS.KEY,
      actionSent: false,
    });
  }

  const blocked = requirePhysicalInjection(policy, "键盘输入");
  if (blocked) {
    return buildErrorResult(blocked.code, blocked.message, {
      tool: SDK_METHODS.KEY,
      actionSent: false,
      detail: { budget: policy.budget, allow_physical_injection: policy.allowPhysicalInjection },
    });
  }

  const focus = await resolveOptionalTarget(client, params);
  if ("error" in focus) return focus.error;

  const result = await withRequestContext(
    client.sendKey({
      stateId: focus.stateId,
      targetIndex: focus.index,
      chord,
      holdMs: typeof params.hold_seconds === "number" ? params.hold_seconds * 1000 : undefined,
    }),
    { budget: policy.budget, method: SDK_METHODS.KEY },
  );

  return buildKeyResult(result, SDK_METHODS.KEY);
}

/** 滚动（SDK 的 `scroll`）。 */
export async function handleScroll(
  client: CuaHelperClient,
  params: Record<string, unknown>,
  policy: DispatchPolicy,
): Promise<CallToolResult> {
  const resolved = await resolveActionTarget(client, params);
  if ("error" in resolved) return resolved.error;

  const directionRaw =
    typeof params.scroll_direction === "string" ? params.scroll_direction : "down";
  const amount = typeof params.scroll_amount === "number" ? params.scroll_amount : 1;
  const magnitude = Math.max(1, Math.min(Math.abs(Math.round(amount)), 10));

  // 水平滚动在 v1 不支持——明确的错误好过静默的竖直滚动。
  if (directionRaw === "left" || directionRaw === "right") {
    return buildErrorResult(
      DISPATCH_ERROR_CODES.UNSUPPORTED_PLATFORM,
      "水平滚动（left/right）在 v1 未实现，只支持 up/down。",
      { tool: SDK_METHODS.SCROLL, actionSent: false },
    );
  }
  const wheelCount = directionRaw === "up" ? magnitude : -magnitude;

  const result = await withRequestContext(
    client.sendScroll({
      stateId: resolved.stateId,
      ...("index" in resolved
        ? { index: resolved.index }
        : {
            coordinate: resolved.coordinate,
            ...(resolved.coordinateSpace ? { coordinate_space: resolved.coordinateSpace } : {}),
          }),
      wheelCount,
      budget: policy.budget,
      allowPhysicalInjection: policy.allowPhysicalInjection,
    }),
    { budget: policy.budget, method: SDK_METHODS.SCROLL },
  );

  return buildScrollResult(result, SDK_METHODS.SCROLL);
}

/** 拖拽（SDK 的 `left_click_drag`）。恒为物理注入。 */
export async function handleDrag(
  client: CuaHelperClient,
  params: Record<string, unknown>,
  policy: DispatchPolicy,
): Promise<CallToolResult> {
  const blocked = requirePhysicalInjection(policy, "拖拽");
  if (blocked) {
    return buildErrorResult(blocked.code, blocked.message, {
      tool: SDK_METHODS.LEFT_CLICK_DRAG,
      actionSent: false,
      detail: { budget: policy.budget, allow_physical_injection: policy.allowPhysicalInjection },
    });
  }

  const fromTarget = parseSdkTarget(params.from_target);
  const toTarget = parseSdkTarget(params.to_target);
  if (!fromTarget || !toTarget) {
    return buildErrorResult(
      DISPATCH_ERROR_CODES.BAD_REQUEST,
      "left_click_drag 需要 from_target 与 to_target",
      { tool: SDK_METHODS.LEFT_CLICK_DRAG, actionSent: false },
    );
  }

  const state = await ensureObservation(client, params);
  if ("error" in state) return state.error;

  const buttonRaw = params.mouse_button ?? params.button;
  const button = buttonRaw === "right" || buttonRaw === "middle" ? buttonRaw : "left";

  // 坐标拖拽：起点与终点都是 0-1000 归一化坐标。
  if (fromTarget.kind === "coordinate" && toTarget.kind === "coordinate") {
    if (
      fromTarget.x === undefined ||
      fromTarget.y === undefined ||
      toTarget.x === undefined ||
      toTarget.y === undefined
    ) {
      return buildErrorResult(DISPATCH_ERROR_CODES.BAD_REQUEST, "坐标拖拽缺少 x/y。", {
        tool: SDK_METHODS.LEFT_CLICK_DRAG,
        actionSent: false,
      });
    }
    const rawSpace = params.coordinate_space ?? params.coordinateSpace;
    const coordinateSpace =
      rawSpace && typeof rawSpace === "object" && !Array.isArray(rawSpace)
        ? (() => {
            const record = rawSpace as Record<string, unknown>;
            return typeof record.width === "number" &&
              typeof record.height === "number" &&
              record.width > 0 &&
              record.height > 0
              ? { width: record.width, height: record.height }
              : undefined;
          })()
        : undefined;
    const result = await withRequestContext(
      client.drag({
        stateId: state.stateId,
        fromCoordinate: { x: fromTarget.x, y: fromTarget.y },
        toCoordinate: { x: toTarget.x, y: toTarget.y },
        ...(coordinateSpace ? { coordinate_space: coordinateSpace } : {}),
        button,
      }),
      { budget: policy.budget, method: SDK_METHODS.LEFT_CLICK_DRAG },
    );
    return buildDragResult(result, SDK_METHODS.LEFT_CLICK_DRAG);
  }

  if (fromTarget.kind !== "element" || toTarget.kind !== "element") {
    return buildErrorResult(
      DISPATCH_ERROR_CODES.BAD_REQUEST,
      "拖拽的起点与终点必须同为元素索引或同为坐标。",
      { tool: SDK_METHODS.LEFT_CLICK_DRAG, actionSent: false },
    );
  }
  const fromIndex = fromTarget.index;
  const toIndex = toTarget.index;
  if (fromIndex === undefined || toIndex === undefined) {
    return buildErrorResult(DISPATCH_ERROR_CODES.BAD_REQUEST, "拖拽目标缺少元素索引。", {
      tool: SDK_METHODS.LEFT_CLICK_DRAG,
      actionSent: false,
    });
  }

  const result = await withRequestContext(
    client.drag({
      stateId: state.stateId,
      fromIndex,
      toIndex,
      button,
    }),
    { budget: policy.budget, method: SDK_METHODS.LEFT_CLICK_DRAG },
  );

  return buildDragResult(result, SDK_METHODS.LEFT_CLICK_DRAG);
}

/** 设置值（SDK 的 `set_value`）。首选 UIA 的 ValuePattern，失败时降级物理注入。 */
export async function handleSetValue(
  client: CuaHelperClient,
  params: Record<string, unknown>,
  policy: DispatchPolicy,
): Promise<CallToolResult> {
  const value = typeof params.value === "string" ? params.value : undefined;
  if (value === undefined) {
    return buildErrorResult(DISPATCH_ERROR_CODES.BAD_REQUEST, "set_value 需要 value", {
      tool: SDK_METHODS.SET_VALUE,
      actionSent: false,
    });
  }

  const resolved = await resolveActionTarget(client, params);
  if ("error" in resolved) return resolved.error;
  const target = requireElementTarget(resolved, SDK_METHODS.SET_VALUE);
  if ("error" in target) return target.error;

  // 不指定 preferPath：写值意图的路径排序由 `planDispatchPaths` 决定——
  // 它会把消息投递排除在外（那条路无法写值），首选 ValuePattern，
  // ValuePattern 不可用时降级到物理注入。
  //
  // 早先这里传过 `preferPath: "ax"`，那是把「首选」写死成「必需」，
  // 导致只读控件直接失败；后来又传过 `post_message`（quiet 档），
  // 那是更糟的错误——动作会「成功」而内容不变。
  const receipt = await withRequestContext(
    client.act({
      stateId: target.stateId,
      index: target.index,
      budget: policy.budget,
      allowPhysicalInjection: policy.allowPhysicalInjection,
      intent: { kind: "set_value", value },
    }),
    { budget: policy.budget, method: SDK_METHODS.SET_VALUE },
  );

  return buildActionResult(receipt, SDK_METHODS.SET_VALUE);
}

/** 粘贴（SDK 的 `paste`）。恒为物理注入。 */
export async function handlePaste(
  client: CuaHelperClient,
  params: Record<string, unknown>,
  policy: DispatchPolicy,
): Promise<CallToolResult> {
  const text = typeof params.text === "string" ? params.text : undefined;
  if (text === undefined) {
    return buildErrorResult(DISPATCH_ERROR_CODES.BAD_REQUEST, "paste 需要 text", {
      tool: SDK_METHODS.PASTE,
      actionSent: false,
    });
  }

  const format = typeof params.format === "string" ? params.format : "text";
  if (format !== "text") {
    return buildErrorResult(
      DISPATCH_ERROR_CODES.UNSUPPORTED_PLATFORM,
      `粘贴格式 "${format}" 在 v1 未实现，只支持 text。`,
      { tool: SDK_METHODS.PASTE, actionSent: false },
    );
  }

  const blocked = requirePhysicalInjection(policy, "粘贴");
  if (blocked) {
    return buildErrorResult(blocked.code, blocked.message, {
      tool: SDK_METHODS.PASTE,
      actionSent: false,
      detail: { budget: policy.budget, allow_physical_injection: policy.allowPhysicalInjection },
    });
  }

  const focus = await resolveOptionalTarget(client, params);
  if ("error" in focus) return focus.error;

  // 纯文本优先走定向输入：不写系统剪贴板，也不抢焦点。
  if (focus.stateId !== undefined && focus.index !== undefined) {
    try {
      const receipt = await withRequestContext(
        client.typeIntoElement({ stateId: focus.stateId, index: focus.index, text }),
        { budget: policy.budget, method: SDK_METHODS.PASTE, path: "ax_text" },
      );
      return buildActionResult(receipt, SDK_METHODS.PASTE);
    } catch (error) {
      const classified = classifyError(error);
      if (classified.code !== DISPATCH_ERROR_CODES.ELEMENT_UNAVAILABLE) {
        return buildErrorResult(classified.code, classified.message, {
          tool: SDK_METHODS.PASTE,
          actionSent: classified.actionSent,
          detail: classified.detail,
        });
      }
    }
  }

  // 粘贴不写系统剪贴板——那会覆盖用户自己的剪贴板内容，是不可接受的副作用。
  // 这里用 Unicode 逐字符输入达到同样效果。
  const result = await withRequestContext(client.sendKey({ text }), {
    budget: policy.budget,
    method: SDK_METHODS.PASTE,
  });

  return buildKeyResult(result, SDK_METHODS.PASTE);
}

/** 次要动作（SDK 的 `perform_action`）。走 UIA 语义动作。 */
export async function handlePerformAction(
  client: CuaHelperClient,
  params: Record<string, unknown>,
  policy: DispatchPolicy,
): Promise<CallToolResult> {
  const action = typeof params.action === "string" ? params.action : undefined;
  if (!action) {
    return buildErrorResult(
      DISPATCH_ERROR_CODES.BAD_REQUEST,
      "perform_action 需要 action（元素上声明的动作名）",
      { tool: SDK_METHODS.PERFORM_ACTION, actionSent: false },
    );
  }

  const resolved = await resolveActionTarget(client, params);
  if ("error" in resolved) return resolved.error;
  const target = requireElementTarget(resolved, SDK_METHODS.PERFORM_ACTION);
  if ("error" in target) return target.error;

  const receipt = await withRequestContext(
    client.act({
      stateId: target.stateId,
      index: target.index,
      budget: policy.budget,
      allowPhysicalInjection: policy.allowPhysicalInjection,
      intent: { kind: "click", semantic: action },
      preferPath: policy.budget === "quiet" ? "post_message" : undefined,
    }),
    { budget: policy.budget, method: SDK_METHODS.PERFORM_ACTION, semantic: action },
  );

  return buildActionResult(receipt, SDK_METHODS.PERFORM_ACTION);
}

/**
 * 文本选区（SDK 的 `select_text`）。
 *
 * SDK 在客户端就把「要选中的文本」换算成 `[start, length]`：它拿着上一次
 * 观察到的 `elements[index].value` 做子串定位，匹配不唯一/找不到会先在
 * 客户端报 `NOT_SELECTABLE`。因此这里只需处理区间形式。
 *
 * 越界一律报错不夹取：夹取会让用户以为选中了 A 实际选中了 B。
 */
export async function handleSelectText(
  client: CuaHelperClient,
  params: Record<string, unknown>,
  _policy: DispatchPolicy,
): Promise<CallToolResult> {
  const resolved = await resolveActionTarget(client, params);
  if ("error" in resolved) return resolved.error;
  const target = requireElementTarget(resolved, SDK_METHODS.SELECT_TEXT);
  if ("error" in target) return target.error;

  // SDK 传 `text_range: [start, length]`；内部诊断入口也可以传 start/length。
  const range = Array.isArray(params.text_range)
    ? params.text_range
    : Array.isArray(params.textRange)
      ? params.textRange
      : undefined;
  const start =
    typeof range?.[0] === "number"
      ? range[0]
      : typeof params.start === "number"
        ? params.start
        : undefined;
  const length = typeof range?.[1] === "number" ? range[1] : undefined;

  if (start === undefined || length === undefined) {
    return buildErrorResult(
      DISPATCH_ERROR_CODES.BAD_REQUEST,
      "select_text 需要 text_range: [start, length]（相对元素当前文本的字符区间）",
      { tool: SDK_METHODS.SELECT_TEXT, actionSent: false },
    );
  }

  const result = await withRequestContext(
    client.selectText({ stateId: target.stateId, index: target.index, start, length }),
    { budget: _policy.budget, method: SDK_METHODS.SELECT_TEXT },
  );

  return buildTextResult(
    `path=${result.path} dispatch_status=${result.dispatchStatus} ` +
      `selection=[${result.selection.start}, ${result.selection.start + result.selection.length}) ` +
      `selected=${JSON.stringify(result.selection.selectedText ?? "")}` +
      (result.selection.documentLength !== undefined
        ? ` document_length=${result.selection.documentLength}`
        : ""),
    {
      method: SDK_METHODS.SELECT_TEXT,
      path: result.path,
      dispatch_status: result.dispatchStatus,
      effect: result.effect,
      semantic_action: result.semanticAction,
      activates_window: result.activatesWindow,
      grabbed_input: result.grabInput,
      selection: {
        start: result.selection.start,
        length: result.selection.length,
        selected_text: result.selection.selectedText ?? null,
        document_length: result.selection.documentLength ?? null,
      },
      state_id: target.stateId,
      element_index: target.index,
      elapsed_ms: result.elapsedMs,
      action_receipt: {
        schema_version: "raspberrycode-cua-action-receipt-v1",
        method: SDK_METHODS.SELECT_TEXT,
        action_sent: result.dispatchStatus === "sent",
        dispatch_status: result.dispatchStatus,
        delivery: result.dispatchStatus === "not_sent" ? "not_sent" : "sent",
        effect: result.effect,
        retry_action: result.dispatchStatus === "not_sent",
        next_step: result.dispatchStatus === "not_sent" ? "correct_argument" : "verify",
      },
    },
  );
}

/**
 * 内部诊断入口：按预算选择路径执行动作。
 *
 * 与 `left_click` 的区别：这个允许显式指定 `budget` 与 `preferPath`，
 * 仅供脚本与测试直接驱动，不属于模型面。
 */
export async function handleActInternal(
  client: CuaHelperClient,
  params: Record<string, unknown>,
  policy: DispatchPolicy,
): Promise<CallToolResult> {
  const stateId = typeof params.stateId === "string" ? params.stateId : undefined;
  const index = typeof params.index === "number" ? params.index : undefined;
  if (!stateId || index === undefined) {
    return buildErrorResult(DISPATCH_ERROR_CODES.BAD_REQUEST, "act 需要 stateId 与 index", {
      tool: TOOL_NAMES.ACT,
      actionSent: false,
    });
  }

  const intent =
    params.intent && typeof params.intent === "object"
      ? (params.intent as Record<string, unknown>)
      : {};

  const preferPath =
    params.preferPath === "post_message" ||
    params.preferPath === "ax" ||
    params.preferPath === "foreground_send_input"
      ? params.preferPath
      : undefined;

  const receipt = await withRequestContext(
    client.act({
      stateId,
      index,
      budget: policy.budget,
      allowPhysicalInjection: policy.allowPhysicalInjection,
      intent: {
        kind: intent.kind === "set_value" ? "set_value" : "click",
        button: intent.button === "right" || intent.button === "middle" ? intent.button : "left",
        clickCount: typeof intent.clickCount === "number" ? intent.clickCount : 1,
        semantic: typeof intent.semantic === "string" ? intent.semantic : undefined,
        value: typeof intent.value === "string" ? intent.value : undefined,
      },
      preferPath,
    }),
    {
      requested_path: preferPath ?? "(auto)",
      budget: policy.budget,
      allow_physical_injection: policy.allowPhysicalInjection,
    },
  );

  return buildActionResult(receipt, TOOL_NAMES.ACT);
}
