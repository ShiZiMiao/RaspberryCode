/**
 * context-usage-breakdown 标准调用示例：写入 + 冷恢复读回的完整一轮。
 *
 * 这是 agent 模仿的范本，覆盖三条纪律：
 * 1. 只在主链路（`main_turn`）写，sidecar 请求不写；
 * 2. 写入不需要 try/catch —— 内部已 best-effort，失败只记 warn；
 * 3. 读取返回 `undefined` 表示「读不出来」，调用方应回落而非当成空明细。
 */
import type { RuntimeSnapshotUsageInput } from "./contract.js";
import {
  persistContextUsageBreakdown,
  readPersistedContextUsageBreakdown,
  type ContextUsageBreakdownSnapshot,
} from "./contract.js";
import type { AgentRuntimeInternal } from "../internal.js";

/** 主链路请求完成后落盘当前上下文构成。 */
export async function persistAfterMainTurn(
  runtime: AgentRuntimeInternal,
  usage: RuntimeSnapshotUsageInput,
): Promise<void> {
  // main_turn 之外（标题/压缩/prompt enhance）不调用本函数。
  await persistContextUsageBreakdown(runtime, usage.breakdown, {
    used: usage.used,
    size: usage.size,
  });
}

/**
 * 冷恢复：事件里没有 breakdown 时读取落盘快照。
 * 返回 `undefined` 时调用方不应展示来源明细（数据不可用），而不是展示空列表。
 */
export async function restoreBreakdownOnColdStart(
  runtime: AgentRuntimeInternal,
): Promise<ContextUsageBreakdownSnapshot | undefined> {
  return readPersistedContextUsageBreakdown(runtime);
}
