/**
 * Helper 方法处理器的辅助函数。
 *
 * 从 `windows-helper.ts` 抽出，理由是那个文件的职责已经过多：它同时管
 * 进程生命周期（管道、父进程看护、空闲回收）和 14 个方法的业务实现。
 * 拆出无状态的纯函数后，主文件只留路由，两块各自可读。
 *
 * 本模块全部是**无状态纯函数**（除元素收集依赖传入的快照），
 * 因此不持有任何连接或 COM 状态，可以在任意处调用。
 */

import type { InterferenceBudget } from "./dispatch-plan.ts";

/**
 * 取请求参数中的整数字段。
 *
 * 参数来自模型生成的 JSON，类型不可信——直接用会得到 NaN 并让下游静默出错，
 * 因此统一在此收口。
 */
export function intParam(params: unknown, key: string): number | undefined {
  if (!params || typeof params !== "object") return undefined;
  const value = (params as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function stringParam(params: unknown, key: string): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const value = (params as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * 布尔参数。
 *
 * 只接受真正的 `true`——字符串 "true"、"1" 一律视为未提供。
 * 授权这类安全开关不能有「宽松解析」，否则某个调用方传字符串就能绕过。
 */
export function boolParam(params: unknown, key: string): boolean | undefined {
  if (!params || typeof params !== "object") return undefined;
  const value = (params as Record<string, unknown>)[key];
  return value === true ? true : value === false ? false : undefined;
}

/** 解析干扰预算。非法值退回 balanced（最保守的可用默认）。 */
export function budgetParam(params: unknown): InterferenceBudget {
  const raw = stringParam(params, "budget");
  return raw === "quiet" || raw === "unrestricted" ? raw : "balanced";
}

/** 结构化元素表的单项形状。与 SDK 的消费方式对齐。 */
export interface StructuredElement {
  index: number;
  kind: string;
  name: string;
  value: string;
  /** `value` 是否真的读到；false 表示未知，不是空值。 */
  value_known: boolean;
  /** 是否可作为元素输入目标；false 时不要拿该索引做 type/set_value。 */
  input_target: boolean;
  states: string[];
  bounds: { left: number; top: number; width: number; height: number } | undefined;
  actions: string[];
}

/**
 * 结构化元素表的上限。
 *
 * 与树文本的 800 节点预算独立：结构化表是给程序读的（SDK 用它做索引解析与
 * 文本定位），不宜比树更宽。
 *
 * **这个上限现在作用于「数组长度」而不是「有效元素个数」**——见下方
 * `collectElements` 的稀疏填充说明。为了不因为占位而挤掉真实元素，
 * 上限取与观察预算同量级（800）。
 */
const MAX_STRUCTURED_ELEMENTS = 800;

/**
 * 从快照里挑出要给模型的结构化元素表。
 *
 * ## 关键约束：`elements[i].index` 必须等于 `i`
 *
 * SDK 是这样消费这张表的（`computer-use-client.mjs` 的 `resolveTextRange`）：
 *
 * ```js
 * const element = binding.elements?.[elementIndex];
 * const value = element?.value;
 * ```
 *
 * 它按**数组下标**取元素，而 `elementIndex` 是树里的原始索引。
 * 因此只有当「下标 === index」时才能取对。
 *
 * 早先这里返回的是**紧凑数组**（只含有内容/可交互的节点，`index` 保留原始下标）。
 * 后果（2026-11-19 真实端到端实测）：树里 55 个有效元素，`document` 的 index 是 2，
 * 但数组第 2 项其实是 index 7 的 `tabitem` —— SDK 于是读到空 value，
 * `selectText(2, "HELLOWORLD")` 报「找不到文本」，而同样的调用在直连测试里是成功的
 * （直连不经过这层下标映射，所以一直没暴露）。
 *
 * 所以必须**按原始下标填充，缺失位置留占位**。占位项不可交互、无内容，
 * 模型侧本来也不会去点它（它的 `index` 指向的确实是个容器节点）。
 */
export function collectElements(snapshot: {
  nodes: {
    kind: string;
    name: string;
    value: string;
    valueKnown: boolean;
    inputTarget: boolean;
    states: string[];
    interactive: boolean;
    bounds: { left: number; top: number; width: number; height: number } | undefined;
  }[];
}): StructuredElement[] {
  /** 占位项：保持数组下标与 index 对齐，但不携带任何可操作信息。 */
  const placeholder = (index: number): StructuredElement => ({
    index,
    kind: "none",
    name: "",
    value: "",
    value_known: false,
    input_target: false,
    states: [],
    bounds: undefined,
    actions: [],
  });

  const out: StructuredElement[] = [];

  for (let index = 0; index < snapshot.nodes.length; index += 1) {
    if (index >= MAX_STRUCTURED_ELEMENTS) break;
    const node = snapshot.nodes[index];
    const informative = Boolean(node.name || node.value);
    if (!node.interactive && !informative) {
      out.push(placeholder(index));
      continue;
    }

    out.push({
      index,
      kind: node.kind,
      name: node.name,
      value: node.value,
      value_known: node.valueKnown,
      input_target: node.inputTarget,
      states: node.states,
      bounds: node.bounds,
      actions: inferActionsFor(node),
    });
  }

  return out;
}

/**
 * 推断元素支持的动作。
 *
 * 这里是**声明性**的（按控件类型推断），不是探测性的（真去问 UIA）。
 * 探测每个元素的 pattern 会让 800 节点的采集从百毫秒推到秒级。
 * 真正执行时由 `detectActions` 再核一遍——声明错了会在那一步失败，
 * 不会静默做错事。
 */
function inferActionsFor(node: {
  kind: string;
  states: string[];
  interactive: boolean;
  inputTarget: boolean;
}): string[] {
  // 可输入文档（如记事本编辑区）不是 interactive kind，但仍是有效动作目标。
  if (!node.interactive && !node.inputTarget) return [];
  const actions: string[] = ["click"];
  if (
    node.inputTarget &&
    (node.kind === "edit" || node.kind === "document" || node.kind === "combobox")
  ) {
    actions.push("set_value");
  }
  if (node.kind === "treeitem" || node.kind === "combobox" || node.kind === "menuitem") {
    actions.push("expand");
  }
  if (
    node.kind === "listitem" ||
    node.kind === "treeitem" ||
    node.kind === "tabitem" ||
    node.kind === "dataitem"
  ) {
    actions.push("select");
  }
  if (node.kind === "checkbox" || node.kind === "radiobutton" || node.kind === "switch") {
    actions.push("toggle");
  }
  return actions;
}

/**
 * 构造「一条路都不可用」的说明。
 *
 * 必须区分原因：模型看到「预算限制」会换等效操作或请用户放宽，
 * 看到「没有坐标/没有语义动作」则应该重新观察或换目标元素。
 * 合成一句话会让模型反复尝试错误的解法。
 */
export function describeNoPath(
  budget: InterferenceBudget,
  blockedBy: "no_bounds" | "no_semantic" | "budget" | undefined,
  availableSemantic: readonly string[],
): string {
  if (blockedBy === "no_bounds") {
    return "该元素没有可用的屏幕坐标，且不支持任何无障碍语义动作；无法操作。请重新观察或换一个目标元素。";
  }
  if (blockedBy === "no_semantic") {
    return `该元素在本预算下没有可用路径（预算=${budget}）；它只支持消息投递，而消息投递需要屏幕坐标。`;
  }
  return `当前预算（${budget}）下该元素没有可用路径。可用语义动作: ${availableSemantic.join(",") || "无"}。`;
}

/**
 * 构造「指定的路径不可用」的说明。
 *
 * 与 `describeNoPath` 分开的理由：这里调用方明确指定了路径，
 * 错误文本要说清「你指定那条为什么不行」，而不是罗列全部原因。
 */
export function describeForcedPathUnavailable(
  path: string,
  budget: InterferenceBudget,
  allowPhysicalInjection: boolean,
  plan: { candidates: readonly string[]; blockedBy?: string },
): string {
  if (path === "foreground_send_input") {
    if (!allowPhysicalInjection) {
      return "物理注入（抢鼠标键盘）需要用户在设置中显式授权，当前未授权。不要重试。";
    }
    if (budget !== "unrestricted") {
      return `物理注入需要预算为 unrestricted，当前预算为 ${budget}。这是用户的设定，不能由调用方修改。`;
    }
    return "物理注入不可用：该元素没有可用的屏幕坐标。请重新观察。";
  }
  if (path === "ax") {
    return `无障碍动作在该元素上不可用（不在可用路径: ${plan.candidates.join(",") || "无"}）。请重新观察或换用其他元素。`;
  }
  return `消息投递不可用（不在可用路径: ${plan.candidates.join(",") || "无"}）。可能该元素没有屏幕坐标。`;
}
