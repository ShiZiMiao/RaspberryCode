/**
 * 结构化元素表的「下标 === index」契约测试。
 *
 * ## 防的是什么
 *
 * SDK 按**数组下标**读取元素：
 *
 * ```js
 * const element = binding.elements?.[elementIndex];
 * const value = element?.value;
 * ```
 *
 * 而 `elementIndex` 是树里的原始索引。因此 `elements[i].index` 必须等于 `i`，
 * 否则 SDK 会读到**另一个元素**的 value/kind。
 *
 * 这个缺陷在 2026-11-19 的真实端到端里才暴露：树里 55 个有效元素、`document`
 * 的 index 是 2，但紧凑数组第 2 项其实是 index 7 的 `tabitem`，于是
 * `selectText(2, "HELLOWORLD")` 报「找不到文本」——而同样的调用在 runtime
 * 直连测试里一直成功（直连不经过这层下标映射）。
 *
 * 单元测试在这里能起作用：它只需检查「数组下标与 index 一致」这个纯结构性质，
 * 不需要真实窗口。
 */

import { describe, expect, it } from "vitest";
import { collectElements } from "../src/helper/handler-support.js";

/** 构造一棵含大量容器节点的树：模拟真实场景里「有效元素稀疏分布」。 */
function snapshotWithGaps() {
  const nodes = [];
  for (let i = 0; i < 20; i += 1) {
    // 每 3 个里只有 1 个带内容，其余是纯布局容器（kind=pane, 无 name/value）
    const informative = i % 3 === 0;
    nodes.push({
      kind: informative ? "document" : "pane",
      name: informative ? `元素${i}` : "",
      value: informative ? `value-${i}` : "",
      states: [],
      interactive: informative,
      bounds: informative ? { left: i, top: i, width: 10, height: 10 } : undefined,
    });
  }
  return { nodes };
}

describe("结构化元素表的下标契约", () => {
  it("elements[i].index 必须等于 i（SDK 按数组下标取元素）", () => {
    const elements = collectElements(snapshotWithGaps());

    for (let i = 0; i < elements.length; i += 1) {
      expect(elements[i].index, `下标 ${i} 处的 index 应为 ${i}，实际是 ${elements[i].index}`).toBe(i);
    }
  });

  it("按 index 定位能取到正确的元素内容（这正是 SDK 的读取方式）", () => {
    const elements = collectElements(snapshotWithGaps());

    // 模拟 SDK：binding.elements[elementIndex].value
    const documentIndex = 3; // nodes[3] 是 informative=true 的 document
    const byIndex = elements[documentIndex];
    expect(byIndex.kind).toBe("document");
    expect(byIndex.value).toBe("value-3");
  });

  it("占位项不可交互、无内容，不会诱导模型去点它", () => {
    const elements = collectElements(snapshotWithGaps());

    // nodes[1] 是纯布局容器 → 应为占位
    const placeholder = elements[1];
    expect(placeholder.index).toBe(1);
    expect(placeholder.actions).toEqual([]);
    expect(placeholder.name).toBe("");
    expect(placeholder.value).toBe("");
  });

  it("元素数量上限不破坏下标对齐", () => {
    // 造一棵超长树，确认截断后仍然对齐
    const nodes = [];
    for (let i = 0; i < 2000; i += 1) {
      nodes.push({
        kind: i % 5 === 0 ? "document" : "pane",
        name: i % 5 === 0 ? `n${i}` : "",
        value: "",
        states: [],
        interactive: i % 5 === 0,
        bounds: undefined,
      });
    }
    const elements = collectElements({ nodes });

    expect(elements.length).toBeLessThanOrEqual(800);
    for (let i = 0; i < elements.length; i += 1) {
      expect(elements[i].index).toBe(i);
    }
  });
});
