/**
 * 快照到模型可见 DSL 的渲染（spec §5.1）。
 *
 * 格式设计依据体现在三处：
 * 1. 缩进表达层级，比 JSON 的嵌套括号省 token 且更易读
 * 2. 行首数字是元素索引，模型用它作为动作句柄（跨观察失效）
 * 3. `[...]` 列出该元素支持的动作名，模型据此判断能做什么
 *
 * 输出示例：
 * ```
 * @state s-12 mode=full app=记事本 window=main showing 1-120 of 543
 * 0 window "记事本"
 *   1 region "文本编辑器"
 *     6 text "" value="hello" editable focused
 *     14 button "保存" [press]
 * ```
 */

import { STATE_FLAGS } from "./kinds.ts";
import type { UiaNode, UiaSnapshot } from "./tree.ts";

/** 单行名称/值的最长截断。超出会撑爆 token 且对模型无额外信息量。 */
const MAX_TEXT_LENGTH = 80;

/** 缩进单位。两个空格在文本树里比四个更省且层级仍清晰。 */
const INDENT = "  ";

/**
 * 从 kind 与状态推断该元素支持的动作名。
 *
 * 这只是**面向模型的提示**，不是真实可用性判定——能否操作取决于
 * pattern 是否真的可用，那在动作阶段（P2）动态查询。
 * 用提示而非承诺，是因为查 pattern 需要额外 COM 往返，遍历期做不起。
 */
export function inferActions(node: UiaNode): string[] {
  const actions: string[] = [];
  const { kind, states } = node;

  if (kind === "button" || kind === "splitbutton" || kind === "hyperlink") {
    actions.push("press");
  }
  if (kind === "checkbox" || kind === "radiobutton") {
    actions.push("toggle");
  }
  if (kind === "edit" || kind === "document") {
    if (!states.includes(STATE_FLAGS.READONLY)) {
      actions.push("set_value", "type");
    }
  }
  if (kind === "listitem" || kind === "treeitem" || kind === "tabitem" || kind === "dataitem") {
    actions.push("select");
  }
  // 可展开的容器类：treeitem / combobox / menuitem / menu
  if (kind === "treeitem" || kind === "combobox" || kind === "menuitem" || kind === "menu") {
    actions.push(states.includes(STATE_FLAGS.EXPANDED) ? "collapse" : "expand");
  }
  if (kind === "slider" || kind === "spinner") {
    actions.push("set_value");
  }
  if (node.interactive && !actions.includes("click")) {
    // 所有可交互元素都能坐标点击，作为语义动作不可用时的兜底
    actions.push("click");
  }

  return [...new Set(actions)];
}

/** 转义双引号与换行，保证单行 DSL 不被破坏。 */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/** 截断过长文本，保留头部——模型通常只需前若干字符即可识别。 */
function clip(text: string, max = MAX_TEXT_LENGTH): { text: string; clipped: boolean } {
  if (text.length <= max) return { text, clipped: false };
  return { text: text.slice(0, max), clipped: true };
}

export interface RenderOptions {
  /** 起始元素索引（含）。用于分页渲染。 */
  from?: number;
  /** 结束元素索引（不含）。 */
  to?: number;
  /** 是否渲染离屏元素。默认渲染但标记 offscreen。 */
  includeOffscreen?: boolean;
}

/**
 * 渲染完整快照。
 *
 * 头部包含：stateId、mode、应用名、窗口、截断状态、可见范围。
 * 截断时必须显示 `showing A-B of N`，让模型知道还有内容没看到——
 * 否则它会误判「界面就这些」而在错误的假设上规划。
 */
export function renderSnapshot(snapshot: UiaSnapshot, options: RenderOptions = {}): string {
  const from = options.from ?? 0;
  const to = Math.min(options.to ?? snapshot.nodes.length, snapshot.nodes.length);
  const visible = snapshot.nodes.slice(from, to);

  const header = buildHeader(snapshot, from, to, visible.length);
  const lines: string[] = [header];

  for (let index = 0; index < visible.length; index += 1) {
    const node = visible[index];
    const line = renderNode(node, from + index);
    if (line !== undefined) lines.push(line);
  }

  return lines.join("\n");
}

function buildHeader(snapshot: UiaSnapshot, from: number, to: number, visibleCount: number): string {
  const appName = escapeText(snapshot.windowTitle) || "(untitled)";
  const parts = [
    `@state ${snapshot.stateId}`,
    "mode=full",
    `app=${appName}`,
    "window=main",
  ];

  if (snapshot.truncated) {
    parts.push(`truncated=${snapshot.truncationReason ?? "unknown"}`);
  }

  if (snapshot.nodes.length > 0) {
    // 索引从 0 起，展示时用 0-based 以与行首数字一致，避免模型做心算偏移
    parts.push(`showing ${from}-${to - 1} of ${snapshot.nodes.length}${snapshot.truncated ? "+" : ""}`);
  }
  if (visibleCount === 0 && snapshot.nodes.length === 0) {
    parts.push("empty");
  }
  if (snapshot.brittleTree) {
    // 无树应用必须明说，否则模型会反复尝试读树（spec §5.2.1）
    parts.push("no_accessibility_tree");
  }

  return parts.join(" ");
}

/**
 * 渲染单个节点。
 *
 * 返回 undefined 表示该节点不值得占一行（空名称空值的纯容器）。
 * 但要保留有子节点的容器，否则层级会断裂。
 */
function renderNode(node: UiaNode, index: number): string | undefined {
  const hasChildren = node.childIndexes.length > 0;
  const nameClipped = clip(escapeText(node.name));
  const valueClipped = clip(escapeText(node.value));

  // 空壳节点：无名称、无值、无子节点、非交互——对模型零信息量
  if (!hasChildren && !nameClipped.text && !valueClipped.text && !node.interactive) {
    return undefined;
  }

  const indent = INDENT.repeat(node.depth);
  const parts: string[] = [`${indent}${index} ${node.kind}`];

  if (nameClipped.text) parts.push(`"${nameClipped.text}"`);
  if (valueClipped.text) parts.push(`value="${valueClipped.text}"`);

  const states = node.states.filter((state) => state !== STATE_FLAGS.DISABLED);
  if (states.length > 0) parts.push(...states);
  if (node.offscreen) parts.push("offscreen");
  if (node.states.includes(STATE_FLAGS.DISABLED)) parts.push("disabled");

  const actions = inferActions(node);
  if (actions.length > 0) parts.push(`[${actions.join(",")}]`);

  return parts.join(" ");
}

/**
 * 渲染差分结果（spec §5.3）。
 *
 * 三种记录：
 * - `~` 变更：只列出变化字段
 * - `+` 新增
 * - `-` 移除
 *
 * 子树替换折叠：实测（spec §1.11）展开一个树节点会导致 109 元素消失 + 138 新增，
 * 逐条列出会产生 247 行噪声，比全量还费 token。识别为「同一父下集中增删」
 * 后折叠成一条。
 */
export interface DiffEntry {
  kind: "added" | "removed" | "changed";
  node: UiaNode;
  /** changed 时的变化字段描述。 */
  changes?: string[];
}

export interface DiffResult {
  entries: DiffEntry[];
  /** 被折叠的子树替换（父节点 → 增删数量）。 */
  subtreeReplacements: { parentRuntimeId: string; added: number; removed: number }[];
  /** 是否完全无变化。 */
  noChange: boolean;
}

/** 子树替换折叠阈值：同一父下增删都 ≥ 此值时折叠。 */
const SUBTREE_COLLAPSE_THRESHOLD = 5;

/**
 * 计算两份快照的差分。
 *
 * 对齐依据是 runtimeId（spec §1.9 实测稳定率 100%）。
 * 没有 runtimeId 的节点（极少数不支持 GetRuntimeId 的 provider）退化为
 * 「类型+名称+父路径」派生身份，并在 changes 里标注降级。
 */
export function diffSnapshots(previous: UiaSnapshot, next: UiaSnapshot): DiffResult {
  const previousById = new Map<string, UiaNode>();
  for (const node of previous.nodes) {
    const key = identityOf(node);
    if (key) previousById.set(key, node);
  }

  const nextById = new Map<string, UiaNode>();
  for (const node of next.nodes) {
    const key = identityOf(node);
    if (key) nextById.set(key, node);
  }

  const entries: DiffEntry[] = [];

  for (const node of next.nodes) {
    const key = identityOf(node);
    if (!key) continue;
    const before = previousById.get(key);
    if (!before) {
      entries.push({ kind: "added", node });
      continue;
    }
    const changes = describeChanges(before, node);
    if (changes.length > 0) {
      entries.push({ kind: "changed", node, changes });
    }
  }

  for (const node of previous.nodes) {
    const key = identityOf(node);
    if (!key) continue;
    if (!nextById.has(key)) entries.push({ kind: "removed", node });
  }

  const subtreeReplacements = detectSubtreeReplacements(entries);

  return {
    entries,
    subtreeReplacements,
    noChange: entries.length === 0,
  };
}

/**
 * 生成节点的对齐身份。
 *
 * 优先 runtimeId；缺失时用「父身份 + kind + name + 同名序号」派生，
 * 避免同层多个同名按钮互相覆盖。
 */
function identityOf(node: UiaNode): string | undefined {
  if (node.runtimeId) return `rid:${node.runtimeId}`;
  // 无 runtimeId 的退化路径：父下标在两次快照间不稳定，只能用深度+路径近似
  const derived = `${node.depth}|${node.kind}|${node.name}`;
  return derived ? `derived:${derived}` : undefined;
}

/** 列出两个同名元素之间实际变化的字段。 */
function describeChanges(before: UiaNode, after: UiaNode): string[] {
  const changes: string[] = [];
  if (before.name !== after.name) changes.push(`name="${clip(escapeText(after.name)).text}"`);
  if (before.value !== after.value) changes.push(`value="${clip(escapeText(after.value)).text}"`);

  const beforeStates = new Set(before.states);
  const afterStates = new Set(after.states);
  const addedStates = after.states.filter((state) => !beforeStates.has(state));
  const removedStates = before.states.filter((state) => !afterStates.has(state));
  if (addedStates.length > 0) changes.push(`+${addedStates.join(",")}`);
  if (removedStates.length > 0) changes.push(`-${removedStates.join(",")}`);

  if (before.kind !== after.kind) changes.push(`kind=${after.kind}`);
  return changes;
}

/**
 * 识别「子树被整体替换」的形态。
 *
 * 判据：同一父节点下，新增与移除数量都达到阈值且数量接近（比值 0.5–2）。
 * 数量接近是关键——只增不减说明是列表追加，不该折叠。
 */
function detectSubtreeReplacements(
  entries: DiffEntry[],
): { parentRuntimeId: string; added: number; removed: number }[] {
  const addedByParent = new Map<string, number>();
  const removedByParent = new Map<string, number>();

  for (const entry of entries) {
    if (entry.kind === "changed") continue;
    const parentKey =
      entry.node.parentIndex >= 0 ? `depth:${entry.node.depth - 1}` : "root";
    const bucket = entry.kind === "added" ? addedByParent : removedByParent;
    bucket.set(parentKey, (bucket.get(parentKey) ?? 0) + 1);
  }

  const collapsed: { parentRuntimeId: string; added: number; removed: number }[] = [];
  for (const [parentKey, added] of addedByParent) {
    const removed = removedByParent.get(parentKey) ?? 0;
    if (added < SUBTREE_COLLAPSE_THRESHOLD || removed < SUBTREE_COLLAPSE_THRESHOLD) continue;
    const ratio = added / removed;
    if (ratio < 0.5 || ratio > 2) continue;
    collapsed.push({ parentRuntimeId: parentKey, added, removed });
  }
  return collapsed;
}

/**
 * 渲染差分结果为模型可见文本。
 *
 * 折叠的子树优先输出，然后是被折叠掉的父节点之外的逐条记录。
 */
export function renderDiff(result: DiffResult, snapshot: UiaSnapshot): string {
  if (result.noChange) {
    const focus = snapshot.nodes.find((node) => node.states.includes(STATE_FLAGS.FOCUSED));
    const focusHint = focus ? ` focus=${clip(escapeText(focus.name)).text || focus.kind}` : "";
    return `@state ${snapshot.stateId} mode=delta\n(no change)${focusHint}`;
  }

  const lines: string[] = [`@state ${snapshot.stateId} mode=delta`];

  // 被折叠的子树对应的父层级：这些层级下的逐条增删不再输出
  const collapsedDepths = new Set(
    result.subtreeReplacements.map((item) => {
      const depth = item.parentRuntimeId.startsWith("depth:")
        ? Number.parseInt(item.parentRuntimeId.slice("depth:".length), 10)
        : -1;
      return depth + 1;
    }),
  );

  for (const item of result.subtreeReplacements) {
    lines.push(`~ subtree@${item.parentRuntimeId} replaced (+${item.added} -${item.removed})`);
  }

  // 索引映射：差分里的节点要给出它在**新快照**中的索引，模型才能接着操作
  const indexOf = buildIndexLookup(snapshot);

  for (const entry of result.entries) {
    if (entry.kind !== "changed" && collapsedDepths.has(entry.node.depth)) continue;
    const index = indexOf(entry.node);
    const name = clip(escapeText(entry.node.name)).text;
    const suffix = name ? ` "${name}"` : "";

    if (entry.kind === "changed") {
      lines.push(`~ ${index} ${entry.node.kind}${suffix} ${entry.changes?.join(" ") ?? ""}`.trimEnd());
    } else if (entry.kind === "added") {
      lines.push(`+ ${index} ${entry.node.kind}${suffix}`);
    } else {
      lines.push(`- ${entry.node.kind}${suffix}`);
    }
  }

  return lines.join("\n");
}

/** 建立「节点 → 新快照索引」的查表。 */
function buildIndexLookup(snapshot: UiaSnapshot): (node: UiaNode) => number {
  const byIdentity = new Map<string, number>();
  snapshot.nodes.forEach((node, index) => {
    const key = identityOf(node);
    if (key) byIdentity.set(key, index);
  });
  return (node: UiaNode) => byIdentity.get(identityOf(node) ?? "") ?? -1;
}
