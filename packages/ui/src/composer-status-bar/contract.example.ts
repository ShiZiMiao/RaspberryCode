/**
 * composer-status-bar 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 */
import type { ComposerSessionUsageFacts } from "./contract.js";
import { buildSessionStatSummary, buildTokenUsageSummary } from "./contract.js";

/**
 * 契约用法示例：把一次 `v4/conversation/usage` 的结果折成两个 chip 摘要。
 * 仅作类型示范（contract.example.ts 参与类型检查，不进入运行时）。
 */
export function exampleBuildChipSummaries(
  facts: ComposerSessionUsageFacts,
  formatTokens: (value: number) => string,
): { sessionStats: string | null; tokenUsage: string | null } {
  return {
    sessionStats: buildSessionStatSummary(
      facts,
      { rounds: "轮", steps: "步" },
      { tokensPerSecond: "tok/s" },
    ),
    tokenUsage: buildTokenUsageSummary(
      facts,
      formatTokens,
      { tokens: "tok", cacheHit: "缓存命中" },
      "zh-CN",
    ),
  };
}
