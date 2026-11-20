/**
 * 派发策略：路径选择与降级。
 *
 * 核心难点（spec §3.3）：**如何判断一级（消息投递）是否生效**。
 *
 * PostMessage 的返回值只说明「消息进入队列」，不说明应用处理了。
 * 要确认生效必须读回状态，而读回需要等 UI 稳定、重新采集、逐属性比对——
 * 成本高且存在误判可能（比如动作导致了异步更新，读回太早会判为未生效）。
 *
 * 因此本模块的设计取舍是：
 *
 * 1. **单次动作默认不自动降级**。一级发出后即返回 `sent` + `effect=unverifiable`，
 *    由上层（模型或任务层）决定要不要重试、要不要换二级。
 *
 * 2. **只有在动作「确定未发送」时才允许降级**（`not_sent`）。
 *    这条与上游 spec §3.3 一致，也是安全底线——`possibly_sent` 时降级
 *    会造成重复执行。
 *
 * 3. **不静默切换路径**。每次动作的收据里记录实际用了哪条路径
 *    （`path` 字段），因为一级零干扰、二级会激活窗口，用户有权知道。
 */

import type { MouseButton } from "./dispatch.ts";
import {
  detectActions,
  focusElement,
  runSemanticAction,
  type SemanticAction,
} from "./patterns.ts";

/**
 * 路径标识。
 *
 * 收据里必须带这个字段——`post_message` 与 `ax` 对用户的干扰不同，
 * 混在一起会让「为什么窗口跳了」无法追溯。
 */
export const DISPATCH_PATH = Object.freeze({
  /** 一级：消息投递。零抢焦点，但覆盖面依赖宿主。 */
  POST_MESSAGE: "post_message",
  /** 二级：无障碍 pattern。语义精确，但会激活窗口。 */
  AX: "ax",
  /** 三级：物理注入。抢键鼠，需授权。v1 未实现。 */
  FOREGROUND_SEND_INPUT: "foreground_send_input",
});

export type DispatchPath = (typeof DISPATCH_PATH)[keyof typeof DISPATCH_PATH];

/**
 * 派发效果。
 *
 * `unverifiable` 不表示失败——它表示「消息已发出，但无法确认应用处理了」。
 * 混淆两者会导致模型错误地重试一个已生效的动作。
 */
export type DispatchEffect = "confirmed" | "unverifiable" | "suspected_noop" | "refused";

/** 发送状态。决定能否重试。 */
export type DispatchStatus = "not_sent" | "sent" | "possibly_sent";

/**
 * 干扰预算。
 *
 * 语义见 spec §3.2：预算属于任务，由用户设定，模型无权修改。
 * 派发层只读不写，超预算即拒绝。
 */
export type InterferenceBudget = "quiet" | "balanced" | "unrestricted";

/**
 * 预算 → 允许的路径集合。
 *
 * - `quiet`：只允许一级。用户在用电脑，不能有窗口跳转。
 * - `balanced`：允许一、二级。二级不抢键鼠（符合硬底线），只激活窗口。
 * - `unrestricted`：允许三级（v1 未实现，会返回 unsupported）。
 */
const ALLOWED_PATHS: Readonly<Record<InterferenceBudget, readonly DispatchPath[]>> = {
  quiet: [DISPATCH_PATH.POST_MESSAGE],
  balanced: [DISPATCH_PATH.POST_MESSAGE, DISPATCH_PATH.AX],
  unrestricted: [
    DISPATCH_PATH.POST_MESSAGE,
    DISPATCH_PATH.AX,
    DISPATCH_PATH.FOREGROUND_SEND_INPUT,
  ],
};

/** 给定预算下是否允许某条路径。 */
export function isPathAllowed(budget: InterferenceBudget, path: DispatchPath): boolean {
  return ALLOWED_PATHS[budget].includes(path);
}

/**
 * 动作意图。
 *
 * 与 `SemanticAction` 的区别：这是模型表达的意图（"我想点这个按钮"），
 * 而 `SemanticAction` 是具体的 pattern 调用。
 * 中间的映射由本模块负责，因为同一个意图在不同元素上可能要不同 pattern。
 */
export interface ActionIntent {
  /** 点击（含语义点击优先）。 */
  kind: "click" | "set_value";
  /** 指定按键，仅 click 有效。 */
  button?: MouseButton;
  /** 连击次数，仅 click 有效。 */
  clickCount?: number;
  /** 期望的语义动作。未指定时按元素能力自动挑。 */
  semantic?: SemanticAction;
  /** set_value 的目标值。 */
  value?: string;
}

export interface DispatchPlanContext {
  /**
   * 元素是否有有效的屏幕包围盒。
   *
   * 一级（消息投递）与三级（物理注入）都依赖屏幕坐标：一级要算客户区相对位置，
   * 三级要移光标。没有 bounds 时这两条路**技术上不可行**，不能列为候选——
   * 否则会让调用方选中一条注定失败的路，而不是继续往下降级。
   */
  hasBounds: boolean;
}

/**
 * 为一个意图规划候选路径。
 *
 * 返回按优先级排序的路径列表：一级在前（零干扰优先）。
 *
 * 关键判断三个：
 * 1. **一级和三级需要屏幕坐标**。`hasBounds` 为 false 时两者都不可行。
 * 2. **只有当元素支持对应 pattern 时，二级才是可行候选**。
 *    否则列进去会让降级走进死路（调用必失败）。
 * 3. **三级只在预算为 `unrestricted` 时列入**，且不检查授权——
 *    授权由调用方过滤（见 `windows-helper.ts` 的 act）。
 *    这样本函数只表达「技术可能性」，授权是产品策略，两者可独立演进。
 *
 * 三级永远不会被排在前面：它是最后手段。只要一二级有一条可用，
 * 三级就不会被选中——`candidates[0]` 的语义是「最不打扰的可行路径」。
 */
export function planDispatchPaths(
  element: unknown,
  intent: ActionIntent,
  budget: InterferenceBudget,
  context: DispatchPlanContext,
): {
  candidates: DispatchPath[];
  /** 元素实际支持的语义动作，用于诊断「为什么二级不可用」。 */
  availableSemantic: SemanticAction[];
  /** 技术上都不可行的原因，便于错误文本说明「为什么一条路都没有」。 */
  blockedBy: "no_bounds" | "no_semantic" | "budget" | undefined;
} {
  const availableSemantic = detectActions(element);
  const candidates: DispatchPath[] = [];

  /**
   * 用于判定的意图。
   *
   * 显式语义动作若该元素不支持，`press`（来自树里的 `click`）可退到任一
   * 「可触发」动作：树对所有可交互元素都声明 click，但很多元素只有
   * Select/Toggle 而没有 InvokePattern。若不在此处放宽，后面无论怎么
   * 归一化都走不通——AX 根本不会被列入候选。
   *
   * 这里改的是**判定用的意图**，不影响 `availableSemantic` 的报告。
   */
  /**
   * 调用方显式要求了一个语义动作，但该元素不支持它（典型的 `click` → 该元素只有
   * Select/Toggle 而没有 InvokePattern）。
   *
   * 这种情况要**降级到该元素自己的触发型动作**，而不是静默改走消息投递：
   * 后者会让回执里的 `semantic` 变成空、动作名与实际执行的事对不上，
   * 而调用方本来表达的是「触发这个元素」，Select 就是它的触发方式。
   */
  const wantsSemanticFallback =
    intent.semantic !== undefined &&
    intent.semantic === "press" &&
    !availableSemantic.includes("press") &&
    (availableSemantic.includes("select") ||
      availableSemantic.includes("toggle") ||
      availableSemantic.includes("expand"));

  const intentForPlan: ActionIntent =
    wantsSemanticFallback ? { ...intent, semantic: undefined } : intent;

  // 写值意图的路径排序与其他意图不同。
  //
  // 为什么：消息投递只能表达「在某个坐标按下鼠标」，它**无法写值**。
  // 若把一级排在写值意图的候选首位，模型会得到「动作已发出」的回执，
  // 而文本框内容纹丝不动——这是静默失败，比直接报错糟得多。
  //
  // 因此写值意图的首选是二级（ValuePattern），一级不列入候选。
  const isWriteIntent = intent.kind === "set_value";

  // 显式指定的语义动作同样是**硬性要求**，不是偏好。
  //
  // `perform_action` 的契约是「执行元素声明的那个动作」。若仍把消息投递
  // 列入候选，它作为最低干扰路径会排到第一位，于是一次 perform_action
  // 实际做的是「在元素中心单击」——动作名被静默忽略，回执里 semantic 为空。
  // 调用方与用户都无法从结果看出「要做的事没做」。
  //
  // 三级也表达不了具名语义动作（物理注入只能点/打字），故一并排除。
  // 判定用 intentForPlan：显式语义被放宽成「任一可触发动作」时，
  // 它已不再是具名语义动作，按普通点击规划即可。
  const isExplicitSemantic = intentForPlan.semantic !== undefined;

  // 一级：需要坐标，且只对「点击类」意图有意义
  //
  // wantsSemanticFallback 时**不列一级**：调用方要的是「用元素自己的语义去触发」，
  // 消息投递只是「在某坐标按下鼠标」，对它而言既不准确也不可解释
  // （回执 semantic 为空，无法说明动作名去哪了）。
  if (
    !isWriteIntent &&
    !isExplicitSemantic &&
    !wantsSemanticFallback &&
    context.hasBounds &&
    isPathAllowed(budget, DISPATCH_PATH.POST_MESSAGE)
  ) {
    candidates.push(DISPATCH_PATH.POST_MESSAGE);
  }

  // 二级：需要元素支持至少一个可表达该意图的 pattern。不依赖坐标。
  const semanticSupported = hasMatchingSemantic(availableSemantic, intentForPlan);
  if (semanticSupported && isPathAllowed(budget, DISPATCH_PATH.AX)) {
    candidates.push(DISPATCH_PATH.AX);
  }

  // 三级：需要坐标，且仅 unrestricted 预算下作为最后手段列出。
  // 写值也允许——ValuePattern 不可用时（只读控件、provider 未实现）
  // 只能靠「聚焦 + 键盘输入」实现，那是三级的职责。
  // 但显式语义动作不行：物理注入表达不了「Toggle 这个复选框」这类具名语义。
  if (
    !isExplicitSemantic &&
    context.hasBounds &&
    isPathAllowed(budget, DISPATCH_PATH.FOREGROUND_SEND_INPUT)
  ) {
    candidates.push(DISPATCH_PATH.FOREGROUND_SEND_INPUT);
  }

  const blockedBy: "no_bounds" | "no_semantic" | "budget" | undefined =
    candidates.length > 0
      ? undefined
      : !context.hasBounds && !semanticSupported
        ? "no_bounds"
        : !semanticSupported
          ? "no_semantic"
          : // 显式语义动作不可用时的原因不是预算，而是元素没声明那个动作。
            // 报成 budget 会让调用方去调预算（无用的动作），而不是换动作名。
            isExplicitSemantic
            ? "no_semantic"
            : "budget";

  return { candidates, availableSemantic, blockedBy };
}

/**
 * 元素能力是否足以表达该意图。
 *
 * 规则刻意保守：宁可判定「不支持」让上层走一级，
 * 也不要把不支持的情况列进候选——那会让调用方在降级时拿到确定的失败。
 */
function hasMatchingSemantic(
  available: SemanticAction[],
  intent: ActionIntent,
): boolean {
  if (intent.semantic) return available.includes(intent.semantic);
  if (intent.kind === "set_value") return available.includes("set_value");
  // 点击意图：只要有任意一个「可触发」类 pattern 就算可用
  return (
    available.includes("press") ||
    available.includes("toggle") ||
    available.includes("select") ||
    available.includes("expand")
  );
}

/**
 * 为点击意图挑选最合适的语义动作。
 *
 * 顺序依据语义贴合度：press 最贴切（明确的"按下"语义），
 * 其次是 toggle（复选框）、select（列表项）、expand（树节点）。
 *
 * 这个顺序**不是**「哪个先成功用哪个」，而是「哪个语义最接近用户的点击意图」——
 * 对一个按钮调 select 可能语法上可行但语义错误。
 */
export function chooseSemanticAction(
  available: SemanticAction[],
  intent: ActionIntent,
): SemanticAction | undefined {
  if (intent.semantic) {
    return available.includes(intent.semantic) ? intent.semantic : undefined;
  }
  if (intent.kind === "set_value") {
    return available.includes("set_value") ? "set_value" : undefined;
  }
  for (const candidate of ["press", "toggle", "select", "expand"] as const) {
    if (available.includes(candidate)) return candidate;
  }
  return undefined;
}

export { focusElement, runSemanticAction };
