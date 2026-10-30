import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";

/** Coding Plan 用量页已随订阅体系移除，用量统计只保留 App 用量。 */
export type UsageStatsSectionTab = "app";

export function UsageStatsSection() {
  return <AppUsagePanel />;
}
