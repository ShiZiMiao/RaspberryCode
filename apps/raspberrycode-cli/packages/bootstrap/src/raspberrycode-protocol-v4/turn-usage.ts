// turnHeader 上的本轮用量累计（协议字段见 rows.ts 的 turnHeaderRowSchema.usage）。
//
// 归因纪律：只有主链路 ModelComplete 才进这里（调用方已判定 isMainTurn）。subagent /
// workflow child / 标题生成 / compact 验证器的请求属于别的执行线，混进来会让用户看到的
// 「本轮用量」与「这一轮对话」对不上。
//
// 未知不冒充 0：provider 未回报某个字段时保留 undefined 语义由调用方判定；这里只在
// 已有值上累加，缺失侧按 0 贡献增量——与 outputTokens（历史字段）完全同源同口径。
import type { ModelUsage, ModelUsageSummary } from "@raspberrycode/contracts";
import type { TurnHeaderRow } from "@raspberrycode/shared/raspberrycode-protocol-v4";

type TurnUsage = NonNullable<TurnHeaderRow["usage"]>;

function nonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * 把一次主链路 ModelComplete 的 usage 累加到 turnHeader 的用量明细。
 *
 * provider/model 取「本轮首个有模型的请求」：模型可能在一轮内被切换，
 * 但一条回复的归属应该稳定，后续 ModelComplete 不得改写已落定的身份。
 *
 * 返回 undefined 表示「这一轮没有可展示的用量事实」：冷恢复会合成零 usage 的
 * ModelComplete（只为恢复 output-token Continue 资格），让它生成一个全 0 明细
 * 会在 UI 上冒充「用了 0 token」，与「不知道」是两回事。
 */
export function accumulateTurnUsage(
  previous: TurnUsage | undefined,
  usage: ModelUsage | undefined,
  config: { provider: string; model: string },
): TurnUsage | undefined {
  const inputTokens = (previous?.inputTokens ?? 0) + nonNegative(usage?.inputTokens);
  const outputTokens = (previous?.outputTokens ?? 0) + nonNegative(usage?.outputTokens);
  const cacheReadTokens = (previous?.cacheReadTokens ?? 0) + nonNegative(usage?.cacheReadTokens);
  const cacheWriteTokens = (previous?.cacheWriteTokens ?? 0) + nonNegative(usage?.cacheWriteTokens);
  if (
    previous === undefined &&
    inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0
  ) {
    return undefined;
  }
  const provider = previous?.provider ?? (config.provider ? config.provider : undefined);
  const model = previous?.model ?? (config.model ? config.model : undefined);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  };
}

/**
 * 轮终态的权威用量收口：TurnComplete 携带的轮级汇总覆盖流式期累加值。
 *
 * live 路径 payload.usage 来自 createModelUsageSummaryFromEvents（该轮所有
 * ModelComplete）；cold 路径由 hydration 从 assistant message 的 info.tokens 还原。
 *
 * provider/model 的取值优先级：流式期已落定的身份 > fallback（调用方给的会话配置）。
 * 必须带 fallback：冷恢复路径的合成 ModelComplete 全是零用量，会被 accumulateTurnUsage
 * 判成「无事实」而返回 undefined，于是 previous 里从来没有身份——只用 previous 会让
 * 历史会话的面板永远缺「提供方/模型」这一行（这正是它的实测症状）。
 * 反过来，live 一轮内切过模型时 previous 记的是首个模型，不能被 fallback 覆盖。
 */
export function settleTurnUsage(
  previous: TurnUsage | undefined,
  summary: ModelUsageSummary | undefined,
  fallback?: { provider: string; model: string },
): TurnUsage | undefined {
  if (summary === undefined) return previous;
  const total =
    summary.inputTokens + summary.outputTokens + summary.cacheReadTokens + summary.cacheWriteTokens;
  // 全 0 且此前也没有事实：保持未知，不落 0 明细。
  if (total === 0 && previous === undefined) return undefined;
  const provider = previous?.provider ?? (fallback?.provider ? fallback.provider : undefined);
  const model = previous?.model ?? (fallback?.model ? fallback.model : undefined);
  return {
    inputTokens: Math.max(0, Math.floor(summary.inputTokens)),
    outputTokens: Math.max(0, Math.floor(summary.outputTokens)),
    cacheReadTokens: Math.max(0, Math.floor(summary.cacheReadTokens)),
    cacheWriteTokens: Math.max(0, Math.floor(summary.cacheWriteTokens)),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  };
}
