/**
 * context-usage-breakdown 对外契约。
 *
 * 模块职责：把主链路模型请求的「上下文来源占比」事实落一份 session entry，
 * 并在冷恢复时作为兜底读回。调用方必须知道的三件事：
 *
 * 1. **只落事实，不落百分比**：入参与出参都是 `{ source, chars }` 列表，
 *    分母由读取方按统一口径重算。写百分比会让两处口径漂移。
 * 2. **写入是覆盖写**：同一会话固定 entry id，只保留最近一次快照，
 *    它描述「当前上下文构成」，不是使用历史。
 * 3. **全部 best-effort**：读写失败不抛错、不阻断主流程，只记 warn。
 *    读取侧用 `undefined` 区分「读不出来」与「确实没有明细」（空数组）。
 *
 * 前置条件：只有 `querySource === "main_turn"` 的请求才应调用写入；
 * sidecar 请求（标题、压缩、prompt enhance）的规模与可见上下文无关。
 */
import type { ContextUsageBreakdownItem } from "@raspberrycode/contracts";
import type { AgentRuntimeInternal } from "../internal.js";

export {
  buildContextUsageBreakdownEntry,
  parseContextUsageBreakdownEntryData,
  persistContextUsageBreakdown,
  readPersistedContextUsageBreakdown,
} from "./context-usage-breakdown.js";

/** 上下文窗口用量事实；与 breakdown 一起落盘，供读取侧判断快照是否仍属当前上下文。 */
export interface ContextUsageBreakdownUsage {
  /** 写入时该次请求的 context window 用量。 */
  used?: number;
  /** 写入时该次请求的 context window 容量。 */
  size?: number;
}

/** 读回结果：解析成功但无有效条目时返回 `undefined`，与空明细区分。 */
export interface ContextUsageBreakdownSnapshot {
  breakdown: ContextUsageBreakdownItem[];
  used?: number;
  size?: number;
}

/** 主链路一次请求的来源明细入参（示例与调用方共用）。 */
export interface RuntimeSnapshotUsageInput extends ContextUsageBreakdownUsage {
  breakdown: readonly ContextUsageBreakdownItem[];
}

/** 写入入口签名：best-effort，调用方不需要 catch。 */
export type PersistContextUsageBreakdown = (
  runtime: AgentRuntimeInternal,
  breakdown: readonly ContextUsageBreakdownItem[],
  usage?: ContextUsageBreakdownUsage,
) => Promise<void>;

/** 读取入口签名：冷恢复兜底，读失败返回 `undefined`。 */
export type ReadPersistedContextUsageBreakdown = (
  runtime: AgentRuntimeInternal,
) => Promise<ContextUsageBreakdownSnapshot | undefined>;
