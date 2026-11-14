/**
 * 上下文来源占比的冷恢复兜底。
 *
 * ## 为什么需要它
 *
 * 上下文容量弹窗的来源明细（系统提示词 / 系统工具 / MCP 工具 / 技能 / 消息 …）是**本地估算**
 * 出来的，随主链路 ModelComplete 事件的 `contextUsageBreakdown` 下发。事件存储是进程内
 * 内存态（`createInMemorySessionEventStore`），进程退出即丢失。于是冷启动打开一个历史会话时：
 *
 * - 容量条与百分比正常（来自 projection 的 contextUsed/contextWindow）；
 * - 缓存命中率正常（来自持久化的 model_usage）；
 * - **来源明细整块消失**，弹窗只剩容量条 + 命中率两行。
 *
 * 用户看到的就是「详细信息怎么没有了」。修复方式：把最近一次主链路请求的 breakdown 落一份
 * session entry，冷恢复时事件拿不到就回落到它。
 *
 * ## 纪律
 *
 * - 只存 facts（source + chars），不存派生百分比；分母由读取方按同一口径重算。
 * - best-effort：读写失败只记 warn，绝不影响恢复与模型请求主流程（与 session-features 一致）。
 * - 只在 `main_turn` 落盘：sidecar 请求（标题、压缩、prompt enhance）不代表可见上下文。
 * - 落盘的是「最近一次」，不做历史累积；它描述的是当前上下文构成，不是使用历史。
 */
import type {
  ContextUsageBreakdownItem,
  SessionEntryInfo,
} from "@raspberrycode/contracts";
import {
  SESSION_ENTRY_CONTEXT_USAGE_BREAKDOWN,
  type SessionId,
} from "@raspberrycode/contracts";
import type { AgentRuntimeInternal } from "../internal.js";

/** session entry 里的 data 形状（version 便于日后演进）。 */
interface ContextUsageBreakdownEntryData {
  version: 1;
  breakdown: ContextUsageBreakdownItem[];
  /** 写入时该次请求的 context window 用量，用于读取侧判断这份快照是否还属于当前上下文。 */
  used?: number;
  /** 写入时该次请求的 context window 容量，同上。 */
  size?: number;
}

const VALID_SOURCES: ReadonlySet<string> = new Set([
  "system_prompt",
  "meta_user_context",
  "skills",
  "tool_prompt",
  "system_tool_schemas",
  "mcp_tool_schemas",
  "messages",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildContextUsageBreakdownEntry(
  sessionId: SessionId,
  breakdown: readonly ContextUsageBreakdownItem[],
  usage?: { used?: number; size?: number },
): SessionEntryInfo {
  const timestamp = Date.now();
  const data: ContextUsageBreakdownEntryData = {
    version: 1,
    breakdown: breakdown.map((item) => ({ source: item.source, chars: item.chars })),
    ...(usage?.used !== undefined ? { used: usage.used } : {}),
    ...(usage?.size !== undefined ? { size: usage.size } : {}),
  };
  return {
    // 固定 id：同一会话只保留最近一次，不累积历史。
    id: `${sessionId}:runtime-context-usage-breakdown`,
    sessionID: sessionId,
    type: SESSION_ENTRY_CONTEXT_USAGE_BREAKDOWN,
    // 这是上下文构成的快照，不是用户/工具活动，不能让任务时间变成“刚刚”。
    touchSession: false,
    time: { created: timestamp, updated: timestamp },
    data,
  };
}

/**
 * 解析 entry 数据；词表外来源与非法 chars 直接丢弃。
 *
 * 解析失败返回 undefined（不是空数组）：空数组会被上层误当成「确实没有明细」，
 * 而 undefined 表示「这份数据读不出来」，两者对恢复决策的含义不同。
 */
export function parseContextUsageBreakdownEntryData(
  data: unknown,
): { breakdown: ContextUsageBreakdownItem[]; used?: number; size?: number } | undefined {
  if (!isRecord(data)) return undefined;
  const raw = data.breakdown;
  if (!Array.isArray(raw)) return undefined;
  const breakdown: ContextUsageBreakdownItem[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const source = item.source;
    const chars = item.chars;
    if (typeof source !== "string" || !VALID_SOURCES.has(source)) continue;
    if (typeof chars !== "number" || !Number.isFinite(chars) || chars <= 0) continue;
    breakdown.push({
      source: source as ContextUsageBreakdownItem["source"],
      chars: Math.trunc(chars),
    });
  }
  if (breakdown.length === 0) return undefined;
  const used = typeof data.used === "number" && Number.isFinite(data.used) ? data.used : undefined;
  const size = typeof data.size === "number" && Number.isFinite(data.size) ? data.size : undefined;
  return {
    breakdown,
    ...(used !== undefined ? { used } : {}),
    ...(size !== undefined ? { size } : {}),
  };
}

/** 落盘最近一次主链路上下文来源占比；best-effort，失败只记 warn。 */
export async function persistContextUsageBreakdown(
  runtime: AgentRuntimeInternal,
  breakdown: readonly ContextUsageBreakdownItem[],
  usage?: { used?: number; size?: number },
): Promise<void> {
  if (breakdown.length === 0) return;
  const store = runtime.sessionStore;
  if (!store?.saveSessionEntry) return;
  try {
    await store.saveSessionEntry(
      buildContextUsageBreakdownEntry(runtime.sessionId as SessionId, breakdown, usage),
    );
  } catch (error) {
    runtime.logger?.warn("Context usage breakdown entry write failed", {
      error: error instanceof Error ? error.message : String(error),
      module: "core.runtime",
      sessionId: runtime.sessionId,
    });
  }
}

/**
 * 冷恢复读取：事件里没有 breakdown 时的兜底。
 *
 * 与写入对称，读取同样 best-effort——读失败不能让整个快照构建失败。
 */
export async function readPersistedContextUsageBreakdown(
  runtime: AgentRuntimeInternal,
): Promise<{ breakdown: ContextUsageBreakdownItem[]; used?: number; size?: number } | undefined> {
  const store = runtime.sessionStore;
  if (!store?.sessionEntries) return undefined;
  try {
    const entries = await store.sessionEntries({
      sessionID: runtime.sessionId as SessionId,
      type: SESSION_ENTRY_CONTEXT_USAGE_BREAKDOWN,
    });
    return parseContextUsageBreakdownEntryData(entries?.at(-1)?.data);
  } catch (error) {
    runtime.logger?.warn("Context usage breakdown entry read failed", {
      error: error instanceof Error ? error.message : String(error),
      module: "core.runtime",
      sessionId: runtime.sessionId,
    });
    return undefined;
  }
}
