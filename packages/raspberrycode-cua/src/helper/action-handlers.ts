/**
 * Helper 的动作类方法：点击、通用派发、键盘、滚动、拖拽。
 *
 * 从 `windows-helper.ts` 抽出，理由是那个文件同时管进程生命周期和 14 个方法，
 * 已经超出可读范围。拆分后：
 * - `windows-helper.ts` 只留进程骨架 + 观察类方法
 * - 本模块专注「把动作发出去」
 *
 * 依赖通过 `ActionContext` 注入而不是直接 import，因为这两块都要用
 * UIA runtime 与快照存储，而它们的生命周期归 Helper 进程所有。
 * 用注入而非全局单例，是为了让测试能替换掉真实的 COM 环境。
 */

import {
  DISPATCH_PATH,
  chooseSemanticAction,
  planDispatchPaths,
  runSemanticAction,
  type ActionIntent,
  type DispatchPath,
  type InterferenceBudget,
} from "./dispatch-plan.ts";
import type { SemanticAction } from "./patterns.ts";
import { normalizeHwnd, postClick, type MouseButton } from "./dispatch.ts";
import {
  captureDesktopState,
  physicalClick,
  physicalDrag,
  restoreCursorTo,
  verifyRestoration,
} from "./foreground.ts";
import {
  boolParam,
  budgetParam,
  describeForcedPathUnavailable,
  describeNoPath,
  intParam,
  stringParam,
} from "./handler-support.ts";
import { postScroll, sendKeyChord, sendScrollAt, sendText } from "./input.ts";
import {
  focusElement,
  normalizeSemanticAction,
} from "./patterns.ts";
import {
  createTypeIntoElementHandler,
  readCoordinate,
  resolveCoordinate,
  setValueByTyping,
} from "./coordinate.ts";
import { createSelectTextHandler } from "./select-text.ts";
import type { SnapshotStore } from "./snapshot-store.ts";
import { readNativeWindowHandle, relocateByRuntimeId } from "./tree.ts";
import { hwndFromWindowKey, isWindowAlive } from "./window-visibility.ts";

/** Helper 进程向动作模块提供的运行时能力。 */
export interface ActionContext {
  /** 确保 UIA 已初始化，返回 runtime 句柄。 */
  ensureUia: () => { automation: unknown; dispose: () => void };
  /** 快照存储（会话内唯一）。 */
  snapshots: SnapshotStore;
}

/** 动作方法的统一签名。 */
export type ActionHandler = (params: unknown) => Promise<unknown> | unknown;

/**
 * 文本选区的 handler。
 *
 * 单独一个方法而不是塞进 `act`：`act` 的三条路径（消息投递 / UIA pattern /
 * 物理注入）都是「点一下或写一个值」，而选区是**另一种语义**——它改变的是
 * 控件内的选择状态，且必须按字符索引定位。硬塞进 act 的意图模型会让
 * `planDispatchPaths` 多出一堆选区分支，而选区根本不需要路径选择
 * （只有 TextPattern 一条路，不支持就明确报错）。
 */
export type SelectTextHandler = (params: unknown) => Promise<unknown> | unknown;

/**
 * 构造动作类方法表。
 *
 * 返回的键是 `HELPER_METHODS` 里的方法名，由 `windows-helper.ts` 合并进总表。
 */
export function buildActionHandlers(
  context: ActionContext,
  methods: {
    CLICK: string;
    ACT: string;
    KEY: string;
    TYPE_INTO_ELEMENT: string;
    SCROLL: string;
    DRAG: string;
    SELECT_TEXT: string;
  },
): Record<string, ActionHandler> {
  const { ensureUia, snapshots } = context;

  /**
   * 校验 stateId 与索引，并重新定位元素。
   *
   * 抽成公共步骤的理由：五个动作方法都要做同一件事，而且**顺序不能错**——
   * 先校验索引存在，再按 RuntimeId 重新定位，最后才用。
   *
   * 为什么必须重新定位：快照里缓存的 COM 元素指针在 UI 变化后会失效，
   * 部分 provider 上直接导致进程崩溃（实测 segfault）。重新定位失败
   * 意味着元素真的没了，让模型重新观察。
   */
  const resolveElement = (
    stateId: string | undefined,
    index: number | undefined,
  ): {
    snapshot: ReturnType<SnapshotStore["findByStateId"]> & object;
    node: { runtimeId: string; element: unknown; bounds?: { left: number; top: number; width: number; height: number }; kind: string; name: string; inputTarget: boolean };
    element: unknown;
  } => {
    if (!stateId) {
      throw Object.assign(new Error("missing stateId"), { code: "bad_request" });
    }
    if (index === undefined || index < 0) {
      throw Object.assign(new Error("missing or invalid index"), { code: "bad_request" });
    }

    const snapshot = snapshots.findByStateId(stateId);
    if (!snapshot) {
      throw Object.assign(
        new Error(`stale stateId: ${stateId}（快照已失效，请重新观察）`),
        { code: "state_invalidated" },
      );
    }

    // 窗口关闭后快照里的 HWND 变成悬空句柄，继续投递只会得到笼统失败。
    // 提前判定并返回 window_closed，让 runtime 映射成 cleanup_pending，
    // 模型据此重新观察而不是盲目重试。
    // 用 windowKey 而不是 rootElement：窗口关闭后 COM 指针可能已失效，
    // 再去读属性有崩溃风险；windowKey 是采集时记下的纯字符串。
    const rootHwnd = hwndFromWindowKey(snapshot.windowKey);
    if (rootHwnd && !isWindowAlive(rootHwnd)) {
      throw Object.assign(
        new Error(`目标窗口已关闭（stateId=${stateId}），请重新观察或重新选择窗口`),
        { code: "window_closed" },
      );
    }

    const node = snapshot.nodes[index];
    if (!node) {
      throw Object.assign(
        new Error(`element index ${index} out of range (0-${snapshot.nodes.length - 1})`),
        { code: "element_unavailable" },
      );
    }

    const runtime = ensureUia();
    const live = relocateByRuntimeId(runtime, snapshot.rootElement, node.runtimeId);
    if (!live && node.runtimeId) {
      throw Object.assign(
        new Error(`element ${index} 已不存在（可能界面已变化），请重新观察`),
        { code: "element_unavailable" },
      );
    }

    return { snapshot, node, element: live ?? node.element };
  };

  return {
    /**
     * 一级派发：消息投递点击。
     *
     * 参数：
     *   stateId: string     模型手上的快照 ID（必需，用于校验索引有效性）
     *   index: number       元素索引（在该快照内）
     *   button?: 'left'|'right'|'middle'
     *   clickCount?: number
     *
     * 为什么强制要求 stateId：元素索引只在「产生它的那次观察」内有效。
     * 不校验就会在 UI 已变化的情况下点到错误位置——静默的错误比报错更危险。
     */
    [methods.CLICK]: (params) => {
      const startedAt = Date.now();
      const buttonRaw = stringParam(params, "button");
      const button: MouseButton =
        buttonRaw === "right" || buttonRaw === "middle" ? buttonRaw : "left";
      const clickCount = intParam(params, "clickCount") ?? 1;

      // 坐标目标：不需要元素索引，但仍需要 stateId 来定位窗口。
      if (readCoordinate(params)) {
        const target = resolveCoordinate(params, "coordinate", snapshots);
        const result = postClick({
          rootHwnd: target.hwnd,
          screenX: target.screenX,
          screenY: target.screenY,
          button,
          clickCount,
        });
        return {
          path: DISPATCH_PATH.POST_MESSAGE,
          dispatchStatus: result.dispatched ? "sent" : "not_sent",
          effect: result.dispatched ? "unverifiable" : "refused",
          escalated: false,
          stateId: stringParam(params, "stateId"),
          coordinate: target.coordinate,
          screenPoint: { x: target.screenX, y: target.screenY },
          clientPoint: { x: result.clientX, y: result.clientY },
          targetDepth: result.targetDepth,
          hwndSource: "windowRoot",
          messages: result.messages,
          elapsedMs: Date.now() - startedAt,
        };
      }

      const stateId = stringParam(params, "stateId");
      const index = intParam(params, "index");
      const { snapshot, node, element } = resolveElement(stateId, index);

      if (!node.bounds) {
        throw Object.assign(
          new Error(`element ${index} has no bounding rectangle（可能已离屏）`),
          { code: "element_unavailable" },
        );
      }

      // Chromium 的网页元素没有独立的 NativeWindowHandle（全是 0），
      // 必须回退到窗口根 HWND，再由 postClick 里的坐标下钻找到真正的目标子窗口。
      const ownHwnd = normalizeHwnd(readNativeWindowHandle(element));
      const rootHwnd = normalizeHwnd(readNativeWindowHandle(snapshot.rootElement));
      const hwnd = ownHwnd ?? rootHwnd;
      if (!hwnd) {
        throw Object.assign(
          new Error(`no usable window handle for element ${index}`),
          { code: "element_unavailable" },
        );
      }

      const centerX = Math.round(node.bounds.left + node.bounds.width / 2);
      const centerY = Math.round(node.bounds.top + node.bounds.height / 2);

      const result = postClick({
        rootHwnd: hwnd,
        screenX: centerX,
        screenY: centerY,
        button,
        clickCount,
      });

      return {
        path: DISPATCH_PATH.POST_MESSAGE,
        dispatchStatus: result.dispatched ? "sent" : "not_sent",
        effect: result.dispatched ? "unverifiable" : "refused",
        escalated: false,
        stateId,
        index,
        elementKind: node.kind,
        elementName: node.name,
        screenPoint: { x: centerX, y: centerY },
        clientPoint: { x: result.clientX, y: result.clientY },
        targetDepth: result.targetDepth,
        hwndSource: ownHwnd ? "element" : "windowRoot",
        messages: result.messages,
        elapsedMs: Date.now() - startedAt,
      };
    },

    /**
     * 按干扰预算选择路径执行动作。
     *
     * 参数：
     *   stateId: string            必需，校验索引有效性
     *   index: number              必需，元素索引
     *   budget?: 'quiet'|'balanced'|'unrestricted'  默认 balanced
     *   allowPhysicalInjection?: boolean  三级授权
     *   intent?: { kind: 'click'|'set_value', button?, clickCount?, semantic?, value? }
     *   preferPath?: 强制指定路径（诊断/测试用）
     *
     * 返回完整收据，含实际使用的 path。这对用户很重要：
     * `post_message` 完全无感，`ax` 会激活窗口，`foreground_send_input` 抢键鼠。
     */
    [methods.ACT]: (params) => {
      const startedAt = Date.now();
      const budget = budgetParam(params);
      const allowPhysicalInjection = boolParam(params, "allowPhysicalInjection") === true;

      const intentRecord =
        params && typeof params === "object"
          ? ((params as Record<string, unknown>).intent as Record<string, unknown> | undefined)
          : undefined;
      const kindRaw = intentRecord?.kind;
      const semanticRaw =
        typeof intentRecord?.semantic === "string" ? intentRecord.semantic : undefined;
      const intent: ActionIntent = {
        kind: kindRaw === "set_value" ? "set_value" : "click",
        button:
          intentRecord?.button === "right" || intentRecord?.button === "middle"
            ? intentRecord.button
            : "left",
        clickCount:
          typeof intentRecord?.clickCount === "number" ? intentRecord.clickCount : 1,
        value: typeof intentRecord?.value === "string" ? intentRecord.value : undefined,
        // 归一化：树摘要里给模型看的是通俗名（`click`），执行层认的是 UIA 名（`press`）。
        // 不归一化会让「照树写的动作」必然被拒。
        semantic: semanticRaw ? normalizeSemanticAction(semanticRaw) : undefined,
      };

      // 坐标目标：没有元素可查语义动作，按预算在消息投递/物理注入之间选。
      // 默认仍走消息投递（零干扰）；只有显式要求或最小化降级时才用物理注入。
      if (readCoordinate(params)) {
        const target = resolveCoordinate(params, "coordinate", snapshots);
        const forcedPath = stringParam(params, "preferPath");
        const wantsPhysical = forcedPath === DISPATCH_PATH.FOREGROUND_SEND_INPUT;

        if (!wantsPhysical) {
          const result = postClick({
            rootHwnd: target.hwnd,
            screenX: target.screenX,
            screenY: target.screenY,
            button: intent.button,
            clickCount: intent.clickCount,
          });
          if (result.dispatched || !allowPhysicalInjection || budget !== "unrestricted") {
            return {
              path: DISPATCH_PATH.POST_MESSAGE,
              dispatchStatus: result.dispatched ? "sent" : "not_sent",
              effect: result.dispatched ? "unverifiable" : "refused",
              escalated: false,
              budget,
              stateId: stringParam(params, "stateId"),
              coordinate: target.coordinate,
              screenPoint: { x: target.screenX, y: target.screenY },
              clientPoint: { x: result.clientX, y: result.clientY },
              targetDepth: result.targetDepth,
              hwndSource: "windowRoot",
              messages: result.messages,
              elapsedMs: Date.now() - startedAt,
            };
          }
        }

        if (!allowPhysicalInjection) {
          throw Object.assign(
            new Error(
              "坐标动作需要物理注入（抢鼠标键盘），但用户尚未授权。请在设置中开启后再试。",
            ),
            { code: "authorization_required" },
          );
        }
        if (budget !== "unrestricted") {
          throw Object.assign(
            new Error(
              `坐标动作需要物理注入，但当前预算为 ${budget}。这是用户的设定，不能由调用方修改。`,
            ),
            { code: "foreground_required" },
          );
        }

        const outcome = physicalClick({
          hwnd: target.hwnd,
          screenX: target.screenX,
          screenY: target.screenY,
          button: intent.button,
          clickCount: intent.clickCount,
        });
        return {
          path: DISPATCH_PATH.FOREGROUND_SEND_INPUT,
          dispatchStatus: outcome.injected > 0 ? "sent" : "not_sent",
          effect: outcome.ok ? "unverifiable" : "refused",
          escalated: true,
          budget,
          stateId: stringParam(params, "stateId"),
          coordinate: target.coordinate,
          screenPoint: { x: target.screenX, y: target.screenY },
          activatesWindow: true,
          grabInput: true,
          cursorRestored: outcome.cursorRestored,
          foregroundRestored: outcome.foregroundRestored,
          injectedEvents: outcome.injected,
          failureReason: outcome.reason,
          messages: [],
          elapsedMs: Date.now() - startedAt,
        };
      }

      const stateId = stringParam(params, "stateId");
      const index = intParam(params, "index");
      const { snapshot, node, element } = resolveElement(stateId, index);

      const plan = planDispatchPaths(element, intent, budget, {
        hasBounds: node.bounds !== undefined,
      });

      // 显式指定的语义动作必须在动之前就校验。
      //
      // 否则会出现这种静默错误：`perform_action(action:"click")` 里的 "click"
      // 不是 UIA 动作名（合法名是 press/toggle/select/expand/collapse/set_value），
      // 元素当然不声明它 → 候选里没有二级 → 落到消息投递 → 回执显示
      // `path=post_message semantic=<空>`。动作看似成功，实际做的是「在元素中心单击」。
      //
      // 例外：`click`（归一化后为 `press`）在语义上等价于「让这个元素被触发」。
      // 树摘要对所有可交互元素都声明 click（遍历期不探测 pattern，见
      // handler-support.ts 的 inferActionsFor），而实际很多元素只有 Select/Toggle
      // 而没有 InvokePattern。若这里一律拒绝，模型照着树写 click 就会失败。
      // 因此 `press` 缺失时退到该元素**实际拥有的**触发型动作。
      let effectiveSemantic = intent.semantic;
      let semanticFallbackFrom: string | undefined;
      if (intent.semantic && !plan.availableSemantic.includes(intent.semantic)) {
        const fallback =
          intent.semantic === "press"
            ? (chooseSemanticAction(plan.availableSemantic, {
                ...intent,
                // 清掉 semantic 以允许按「点击意图」挑一个可触发动作
                semantic: undefined,
              }) as SemanticAction | undefined)
            : undefined;
        if (fallback) {
          effectiveSemantic = fallback;
          semanticFallbackFrom = intent.semantic;
        } else {
          // 报错时列出模型**看得懂**的名字：树摘要写 `click`，但执行层只有 `press`，
          // 只报 `press` 会让模型对不上自己刚看到的树。
          const readable = plan.availableSemantic.map((a) => (a === "press" ? "click" : a));
          throw Object.assign(
            new Error(
              `元素 ${index}（${node.kind}${node.name ? ` "${node.name}"` : ""}）没有声明动作 ` +
                `"${intent.semantic}"；它声明的动作是: ${readable.join(",") || "无"}。` +
                "请改成其中之一，或改用 left_click 按坐标/元素点击。",
            ),
            {
              code: "element_unavailable",
              detail: {
                requestedAction: intent.semantic,
                availableSemantic: readable,
              },
            },
          );
        }
      }

      // 过滤候选：三级还额外要求用户授权。
      //
      // 为什么授权判断放在这里而不是 planDispatchPaths 里：
      // 规划函数只表达「预算允许什么」，是任务属性；授权是「用户接受什么」，
      // 是产品属性。两者分开，才能各自单测，也便于将来把授权做成独立开关。
      const candidates = plan.candidates.filter(
        (candidate) =>
          candidate !== DISPATCH_PATH.FOREGROUND_SEND_INPUT || allowPhysicalInjection,
      );

      // 强制路径是**硬性要求**，不是偏好。
      //
      // 禁止静默切换路径：一级零干扰、二级激活窗口、三级抢键鼠，
      // 三者的用户感知完全不同。若调用方明确要求走三级而未授权，静默改成一级
      // 会让「为什么没生效」变得无法解释，也会掩盖权限配置错误。
      const forcedPath = stringParam(params, "preferPath");
      const isKnownForcedPath =
        forcedPath === DISPATCH_PATH.POST_MESSAGE ||
        forcedPath === DISPATCH_PATH.AX ||
        forcedPath === DISPATCH_PATH.FOREGROUND_SEND_INPUT;

      const chosen: DispatchPath | undefined = isKnownForcedPath
        ? candidates.includes(forcedPath as DispatchPath)
          ? (forcedPath as DispatchPath)
          : undefined
        : candidates[0];

      if (isKnownForcedPath && !chosen) {
        throw Object.assign(
          new Error(
            describeForcedPathUnavailable(forcedPath, budget, allowPhysicalInjection, plan),
          ),
          {
            code:
              forcedPath === DISPATCH_PATH.FOREGROUND_SEND_INPUT && !allowPhysicalInjection
                ? "authorization_required"
                : "foreground_required",
          },
        );
      }

      if (!chosen) {
        const onlyPhysicalBlocked =
          plan.candidates.length === 1 &&
          plan.candidates[0] === DISPATCH_PATH.FOREGROUND_SEND_INPUT;
        if (onlyPhysicalBlocked) {
          throw Object.assign(
            new Error(
              "该元素只能通过物理注入（抢鼠标键盘）操作，但用户尚未授权。请在设置中开启后再试。",
            ),
            { code: "authorization_required" },
          );
        }
        throw Object.assign(
          new Error(describeNoPath(budget, plan.blockedBy, plan.availableSemantic)),
          { code: "foreground_required" },
        );
      }

      // ---- 一级：消息投递 ----
      if (chosen === DISPATCH_PATH.POST_MESSAGE) {
        if (!node.bounds) {
          throw Object.assign(
            new Error(`element ${index} has no bounding rectangle（可能已离屏）`),
            { code: "element_unavailable" },
          );
        }
        const ownHwnd = normalizeHwnd(readNativeWindowHandle(element));
        const rootHwnd = normalizeHwnd(readNativeWindowHandle(snapshot.rootElement));
        const hwnd = ownHwnd ?? rootHwnd;
        if (!hwnd) {
          throw Object.assign(
            new Error(`no usable window handle for element ${index}`),
            { code: "element_unavailable" },
          );
        }

        const centerX = Math.round(node.bounds.left + node.bounds.width / 2);
        const centerY = Math.round(node.bounds.top + node.bounds.height / 2);

        const result = postClick({
          rootHwnd: hwnd,
          screenX: centerX,
          screenY: centerY,
          button: intent.button,
          clickCount: intent.clickCount,
        });

        // 目标窗口最小化时消息不会被处理（客户区已销毁，ClientRect=0x0）。
        // 这种情况必须**改走语义动作**，不能返回「已发送」——
        // 那会让模型以为点击成功，实际什么都没发生。
        //
        // 若该元素没有可用的语义动作，则明确报错，让调用方知道
        // 「要么还原窗口，要么换一个能走 UIA 的目标」。
        if (!result.dispatched && result.reason === "target_minimized") {
          const fallback = chooseSemanticAction(plan.availableSemantic, intent);
          if (fallback) {
            // 改走语义动作：那才是「真的把事做成」。
            // 直接内联执行而非递归调用本函数，避免 plan 重算带来的不一致。
            const outcome = runSemanticAction(element, fallback, intent.value);
            if (outcome?.ok) {
              return {
                path: DISPATCH_PATH.AX,
                dispatchStatus: "sent",
                effect: "unverifiable",
                escalated: false,
                budget,
                stateId,
                index,
                elementKind: node.kind,
                elementName: node.name,
                semanticAction: fallback,
                pattern: outcome.pattern,
                hresult: outcome.hresult,
                availableSemantic: plan.availableSemantic,
                activatesWindow: true,
                messages: [],
                elapsedMs: Date.now() - startedAt,
                // 标记降级：这次不是零干扰路径，用户需要知道。
                degradedFrom: DISPATCH_PATH.POST_MESSAGE,
                degradedReason: "target_minimized",
              };
            }
          }

          throw Object.assign(
            new Error(
              `窗口已最小化，消息投递不会生效；而元素 ${index}（${node.kind}` +
                `${node.name ? ` "${node.name}"` : ""}）没有可用于此意图的语义动作` +
                `（可用: ${plan.availableSemantic.join(",") || "无"}）。` +
                "请还原窗口后重试，或改用支持 UIA pattern 的目标。",
            ),
            { code: "foreground_required", detail: { reason: "target_minimized" } },
          );
        }

        return {
          path: DISPATCH_PATH.POST_MESSAGE,
          dispatchStatus: result.dispatched ? "sent" : "not_sent",
          effect: result.dispatched ? "unverifiable" : "refused",
          escalated: false,
          budget,
          stateId,
          index,
          elementKind: node.kind,
          elementName: node.name,
          screenPoint: { x: centerX, y: centerY },
          clientPoint: { x: result.clientX, y: result.clientY },
          targetDepth: result.targetDepth,
          hwndSource: ownHwnd ? "element" : "windowRoot",
          availableSemantic: plan.availableSemantic,
          messages: result.messages,
          elapsedMs: Date.now() - startedAt,
        };
      }

      // ---- 二级：无障碍 pattern ----
      if (chosen === DISPATCH_PATH.AX) {
        // 用归一化/降级后的动作执行：调用方要的是「触发这个元素」，
        // 该元素没有 Invoke 但有 Select 时，Select 就是它的「点击」。
        const semantic =
          effectiveSemantic ?? chooseSemanticAction(plan.availableSemantic, intent);
        if (!semantic) {
          throw Object.assign(
            new Error(
              `element ${index} 没有可表达该意图的语义动作（可用: ${plan.availableSemantic.join(",") || "无"}）`,
            ),
            { code: "element_unavailable" },
          );
        }

        const outcome = runSemanticAction(element, semantic, intent.value);

        // set_value 的兜底：ValuePattern 在少数控件上不可用（只读、或 provider
        // 没实现该 pattern）。此时降级到物理注入（聚焦 → 全选 → 输入），
        // 而不是把失败抛给上层——用户要的是「值被写进去」，用哪条路是实现细节。
        //
        // 注意：这不是「ValuePattern 必然崩溃」的兜底。曾经的结论是误诊，
        // 根因是 pattern ID 表抄错（10014 是 TextPattern 而非 ValuePattern），
        // 见 patterns.ts 的 UIA_PATTERN 注释。修正后 ValuePattern 正常工作。
        if (intent.kind === "set_value" && (!outcome || !outcome.ok)) {
          if (!allowPhysicalInjection || budget !== "unrestricted") {
            throw Object.assign(
              new Error(
                "该元素的 ValuePattern 不可用（可能只读或 provider 未实现），" +
                  "改用物理注入需要预算 unrestricted 与用户授权，当前不允许。" +
                  "可改用 key 组合键手动输入，或请在设置中开启物理注入。",
              ),
              {
                code: allowPhysicalInjection ? "foreground_required" : "authorization_required",
              },
            );
          }
          return setValueByTyping({
            element,
            node,
            value: intent.value ?? "",
            startedAt,
            budget,
            stateId: stateId ?? "",
            index: index ?? -1,
          });
        }

        if (!outcome) {
          throw Object.assign(
            new Error(`element ${index} 的 ${semantic} pattern 不可用`),
            { code: "element_unavailable" },
          );
        }

        // HRESULT 成功即认为动作被接受。但注意：UIA 的成功不代表 UI 真的变了，
        // 也不代表没激活窗口——后者是必然发生的。
        return {
          path: DISPATCH_PATH.AX,
          dispatchStatus: outcome.ok ? "sent" : "not_sent",
          effect: outcome.ok ? "unverifiable" : "refused",
          escalated: false,
          budget,
          stateId,
          index,
          elementKind: node.kind,
          elementName: node.name,
          semanticAction: semantic,
          pattern: outcome.pattern,
          hresult: outcome.hresult,
          availableSemantic: plan.availableSemantic,
          // 请求的动作平滑降级到了另一个语义动作（如 click→select）时如实标注，
          // 免得回执里的动作名与调用方写的名字对不上却无从解释。
          ...(semanticFallbackFrom ? { semanticFallbackFrom } : {}),
          // 明确标注这条路径会激活窗口，收据里带上便于用户追溯
          activatesWindow: true,
          messages: [],
          elapsedMs: Date.now() - startedAt,
        };
      }

      // ---- 三级：物理注入（抢键鼠，已由调用方确认授权）----
      if (chosen === DISPATCH_PATH.FOREGROUND_SEND_INPUT) {
        if (!node.bounds) {
          throw Object.assign(
            new Error(`element ${index} has no bounding rectangle（物理注入需要屏幕坐标）`),
            { code: "element_unavailable" },
          );
        }

        const hwnd =
          normalizeHwnd(readNativeWindowHandle(element)) ??
          normalizeHwnd(readNativeWindowHandle(snapshot.rootElement));
        if (!hwnd) {
          throw Object.assign(
            new Error(`no usable window handle for element ${index}`),
            { code: "element_unavailable" },
          );
        }

        const centerX = Math.round(node.bounds.left + node.bounds.width / 2);
        const centerY = Math.round(node.bounds.top + node.bounds.height / 2);

        const outcome = physicalClick({
          hwnd,
          screenX: centerX,
          screenY: centerY,
          button: intent.button,
          clickCount: intent.clickCount,
        });

        return {
          path: DISPATCH_PATH.FOREGROUND_SEND_INPUT,
          // 关键区分：注入数 > 0 意味着事件确实进了系统输入队列，
          // 此时绝不能报 not_sent —— 上层会据此重试，造成重复点击。
          dispatchStatus: outcome.injected > 0 ? "sent" : "not_sent",
          effect: outcome.ok ? "unverifiable" : "refused",
          escalated: true,
          budget,
          stateId,
          index,
          elementKind: node.kind,
          elementName: node.name,
          screenPoint: { x: centerX, y: centerY },
          availableSemantic: plan.availableSemantic,
          activatesWindow: true,
          grabInput: true,
          cursorRestored: outcome.cursorRestored,
          foregroundRestored: outcome.foregroundRestored,
          injectedEvents: outcome.injected,
          messages: [],
          failureReason: outcome.reason,
          elapsedMs: Date.now() - startedAt,
        };
      }

      throw Object.assign(new Error(`未知派发路径: ${String(chosen)}`), { code: "internal" });
    },

    [methods.TYPE_INTO_ELEMENT]: createTypeIntoElementHandler(resolveElement),

    /**
     * 键盘输入。
     *
     * 支持三种形态，按参数自动判定：
     *   - `text` 有值且 `chord` 为空 → 逐字符输入（Unicode 事件，支持中文与 emoji）
     *   - `chord` 有值 → 按键或组合键（虚拟键码）
     *   - 两者都有 → 先按键，再输入文本
     *
     * **恒走物理注入**：键盘依赖焦点，消息投递给后台窗口无效（实测 Chromium/WPF/WinUI）。
     * 因此调用方必须先确认授权——本方法不做授权判断，只执行。
     */
    [methods.KEY]: (params) => {
      const startedAt = Date.now();
      const chord = stringParam(params, "chord");
      const text = stringParam(params, "text");
      const holdMs = intParam(params, "holdMs") ?? 0;
      const restoreCursor = boolParam(params, "restoreCursor") !== false;

      if (!chord && !text) {
        throw Object.assign(new Error("key 需要 chord 或 text"), { code: "bad_request" });
      }

      const before = captureDesktopState();
      const results: { step: string; ok: boolean; injected: number; unknownKey?: string }[] = [];

      // 可选：先给目标元素焦点。没有焦点时键盘输入会打到别处。
      const targetIndex = intParam(params, "targetIndex");
      const stateId = stringParam(params, "stateId");
      if (targetIndex !== undefined && stateId) {
        const { element } = resolveElement(stateId, targetIndex);
        // 焦点是靠 UIA SetFocus 拿的，它会激活窗口——这点与二级同性质
        focusElement(element);
      }

      try {
        if (chord) {
          const result = sendKeyChord(chord, holdMs);
          results.push({ step: `chord:${chord}`, ...result });
          if (!result.ok) {
            throw Object.assign(
              new Error(
                result.unknownKey
                  ? `无法发送组合键 "${chord}"：键 "${result.unknownKey}" 不能与修饰键组合。` +
                    "请改用 text 参数直接输入该字符，或用 set_value 设置文本。"
                  : `发送组合键 "${chord}" 失败`,
              ),
              { code: "element_unavailable" },
            );
          }
        }

        if (text) {
          const result = sendText(text);
          results.push({ step: `text:${text.length}chars`, ...result });
          if (!result.ok) {
            throw Object.assign(new Error(`输入文本失败（${text.length} 字符）`), {
              code: "element_unavailable",
            });
          }
        }
      } finally {
        if (restoreCursor) restoreCursorTo(before);
      }

      const restored = verifyRestoration(before);
      const totalInjected = results.reduce((sum, r) => sum + r.injected, 0);

      return {
        path: DISPATCH_PATH.FOREGROUND_SEND_INPUT,
        dispatchStatus: totalInjected > 0 ? "sent" : "not_sent",
        effect: totalInjected > 0 ? "unverifiable" : "refused",
        grabInput: true,
        activatesWindow: true,
        cursorRestored: restoreCursor ? restored.cursorRestored : true,
        injectedEvents: totalInjected,
        steps: results,
        elapsedMs: Date.now() - startedAt,
      };
    },

    /**
     * 滚动。
     *
     * 两条路径：
     *   1. 消息投递（`WM_MOUSEWHEEL`）—— 零干扰，但对 Chromium 无效
     *      （它只认真实输入队列里的滚轮）
     *   2. 物理注入 —— 必生效，抢键鼠
     *
     * 按预算选路。预算为 quiet 时只允许消息投递，若目标不接受就会失败——
     * 这是正确行为，不静默升级到抢键鼠。
     */
    [methods.SCROLL]: (params) => {
      const startedAt = Date.now();
      const wheelCount = intParam(params, "wheelCount");
      if (wheelCount === undefined || wheelCount === 0) {
        throw Object.assign(new Error("wheelCount 缺失或为 0"), { code: "bad_request" });
      }

      // 坐标滚动：不需要元素索引，但仍需要 stateId 定位窗口。
      if (readCoordinate(params)) {
        const target = resolveCoordinate(params, "coordinate", snapshots);
        const budget = budgetParam(params);
        const allowPhysicalInjection = boolParam(params, "allowPhysicalInjection") === true;
        const forcedPath = stringParam(params, "preferPath");

        if (budget !== "unrestricted" && forcedPath !== DISPATCH_PATH.FOREGROUND_SEND_INPUT) {
          const result = postScroll({
            hwnd: target.hwnd,
            screenX: target.screenX,
            screenY: target.screenY,
            wheelCount,
          });
          return {
            path: result.path,
            dispatchStatus: result.ok ? "sent" : "not_sent",
            effect: "unverifiable",
            grabInput: false,
            activatesWindow: false,
            wheelCount,
            budget,
            coordinate: target.coordinate,
            screenPoint: { x: target.screenX, y: target.screenY },
            elapsedMs: Date.now() - startedAt,
          };
        }

        if (!allowPhysicalInjection) {
          throw Object.assign(
            new Error(
              "坐标滚动需要物理注入（抢鼠标），但用户尚未授权。请在设置中开启，或改用 balanced/quiet 预算下的消息投递。",
            ),
            { code: "authorization_required" },
          );
        }

        const result = sendScrollAt({
          screenX: target.screenX,
          screenY: target.screenY,
          wheelCount,
        });
        return {
          path: result.path,
          dispatchStatus: result.ok ? "sent" : "not_sent",
          effect: "unverifiable",
          grabInput: true,
          activatesWindow: false,
          wheelCount,
          budget,
          coordinate: target.coordinate,
          screenPoint: { x: target.screenX, y: target.screenY },
          elapsedMs: Date.now() - startedAt,
        };
      }

      const stateId = stringParam(params, "stateId");
      const index = intParam(params, "index");

      const { snapshot, node, element } = resolveElement(stateId, index);
      if (!node.bounds) {
        throw Object.assign(new Error(`element ${index} 没有可用坐标`), {
          code: "element_unavailable",
        });
      }

      const budget = budgetParam(params);
      const allowPhysicalInjection = boolParam(params, "allowPhysicalInjection") === true;
      const forcedPath = stringParam(params, "preferPath");

      const centerX = Math.round(node.bounds.left + node.bounds.width / 2);
      const centerY = Math.round(node.bounds.top + node.bounds.height / 2);

      const hwnd =
        normalizeHwnd(readNativeWindowHandle(element)) ??
        normalizeHwnd(readNativeWindowHandle(snapshot.rootElement));

      // quiet / balanced：只允许消息投递
      if (budget !== "unrestricted" && forcedPath !== DISPATCH_PATH.FOREGROUND_SEND_INPUT) {
        if (!hwnd) {
          throw Object.assign(new Error("无法获取窗口句柄"), { code: "element_unavailable" });
        }
        const result = postScroll({ hwnd, screenX: centerX, screenY: centerY, wheelCount });
        return {
          path: result.path,
          dispatchStatus: result.ok ? "sent" : "not_sent",
          effect: "unverifiable",
          grabInput: false,
          activatesWindow: false,
          wheelCount,
          budget,
          elapsedMs: Date.now() - startedAt,
        };
      }

      // unrestricted：需要授权才能物理注入
      if (!allowPhysicalInjection) {
        throw Object.assign(
          new Error(
            "滚动需要物理注入（抢鼠标），但用户尚未授权。请在设置中开启，或改用 balanced/quiet 预算下的消息投递。",
          ),
          { code: "authorization_required" },
        );
      }

      const result = sendScrollAt({ screenX: centerX, screenY: centerY, wheelCount });
      return {
        path: result.path,
        dispatchStatus: result.ok ? "sent" : "not_sent",
        effect: "unverifiable",
        grabInput: true,
        activatesWindow: false,
        wheelCount,
        budget,
        elapsedMs: Date.now() - startedAt,
      };
    },

    /**
     * 拖拽。
     *
     * **恒走物理注入**：拖拽需要连续的鼠标轨迹，消息投递无法表达
     * （应用靠 DOWN 之后的 WM_MOUSEMOVE 序列判定拖拽，一步跳到终点会被当成点击）。
     */
    [methods.DRAG]: (params) => {
      const startedAt = Date.now();
      const buttonRaw = stringParam(params, "button");
      const button: MouseButton =
        buttonRaw === "right" || buttonRaw === "middle" ? buttonRaw : "left";

      // 坐标拖拽：起点与终点都是 0-1000 归一化坐标。
      if (readCoordinate(params, "fromCoordinate") && readCoordinate(params, "toCoordinate")) {
        const from = resolveCoordinate(params, "fromCoordinate", snapshots);
        const to = resolveCoordinate(params, "toCoordinate", snapshots);
        const outcome = physicalDrag({
          hwnd: from.hwnd,
          fromX: from.screenX,
          fromY: from.screenY,
          toX: to.screenX,
          toY: to.screenY,
          button,
          steps: intParam(params, "steps"),
        });
        return {
          path: DISPATCH_PATH.FOREGROUND_SEND_INPUT,
          dispatchStatus: outcome.injected > 0 ? "sent" : "not_sent",
          effect: outcome.ok ? "unverifiable" : "refused",
          grabInput: true,
          activatesWindow: true,
          cursorRestored: outcome.cursorRestored,
          injectedEvents: outcome.injected,
          failureReason: outcome.reason,
          fromCoordinate: from.coordinate,
          toCoordinate: to.coordinate,
          elapsedMs: Date.now() - startedAt,
        };
      }

      const stateId = stringParam(params, "stateId");
      const fromIndex = intParam(params, "fromIndex");
      const toIndex = intParam(params, "toIndex");
      if (fromIndex === undefined || toIndex === undefined) {
        throw Object.assign(new Error("drag 需要 fromIndex 与 toIndex，或 fromCoordinate 与 toCoordinate"), {
          code: "bad_request",
        });
      }

      const from = resolveElement(stateId, fromIndex);
      const to = resolveElement(stateId, toIndex);
      if (!from.node.bounds || !to.node.bounds) {
        throw Object.assign(new Error("拖拽的起点或终点没有可用坐标"), {
          code: "element_unavailable",
        });
      }

      const hwnd = normalizeHwnd(readNativeWindowHandle(from.snapshot.rootElement));
      if (!hwnd) {
        throw Object.assign(new Error("无法获取窗口句柄"), { code: "element_unavailable" });
      }

      const outcome = physicalDrag({
        hwnd,
        fromX: Math.round(from.node.bounds.left + from.node.bounds.width / 2),
        fromY: Math.round(from.node.bounds.top + from.node.bounds.height / 2),
        toX: Math.round(to.node.bounds.left + to.node.bounds.width / 2),
        toY: Math.round(to.node.bounds.top + to.node.bounds.height / 2),
        button,
        steps: intParam(params, "steps"),
      });

      return {
        path: DISPATCH_PATH.FOREGROUND_SEND_INPUT,
        dispatchStatus: outcome.injected > 0 ? "sent" : "not_sent",
        effect: outcome.ok ? "unverifiable" : "refused",
        grabInput: true,
        activatesWindow: true,
        cursorRestored: outcome.cursorRestored,
        injectedEvents: outcome.injected,
        failureReason: outcome.reason,
        elapsedMs: Date.now() - startedAt,
      };
    },

    [methods.SELECT_TEXT]: createSelectTextHandler(resolveElement),
  };
}
