/**
 * composer-status-bar 公共入口（architecture-governance managed 模块）。
 * 输入框下方的会话统计 / Token 用量 / 上下文容量状态条；模型契约见 contract.ts 与 CONTRACT.md。
 */
export { ComposerStatusBar, shouldShowComposerStatusBar } from "./ComposerStatusBar.js";
export type { ComposerStatusBarProps } from "./ComposerStatusBar.js";
export { ComposerStatusChip, ComposerStatusRow } from "./ComposerStatusChip.js";
export { useComposerSessionUsage } from "./useComposerSessionUsage.js";
export {
  buildRoundStepLabel,
  buildSessionStatLines,
  buildSessionStatSummary,
  buildTokenUsageLines,
  buildTokenUsageSummary,
  formatDurationSeconds,
  formatTokensPerSecond,
  formatUsagePercent,
  hasSessionStats,
  hasTokenUsage,
  type ComposerSessionStatLine,
  type ComposerSessionUsageFacts,
  type ComposerTokenUsageLine,
} from "./contract.js";
