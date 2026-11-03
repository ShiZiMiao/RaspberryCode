import type { UsageEntitlementSnapshot } from "@raspberrycode/shared";

export type UsageEntitlementOutcome = "active" | "inactive" | "unknown";

/** 只把权威 no_plan 解释为失效；网络、鉴权和不完整快照都保持未知。 */
export function resolveUsageEntitlementOutcome(
  snapshot: UsageEntitlementSnapshot | null,
  providerId?: string,
): UsageEntitlementOutcome {
  if (!snapshot) return "unknown";
  if (providerId && snapshot.provider?.id && snapshot.provider.id !== providerId) {
    return "unknown";
  }
  if (snapshot.unavailableReason === "no_plan") return "inactive";
  // 额度或剩余额度不代表订阅；个人/团队都由服务返回的订阅摘要证明权益。
  return snapshot.subscription?.details.length ? "active" : "unknown";
}

export function hasActiveUsageEntitlementSnapshot(
  snapshot: UsageEntitlementSnapshot | null,
  providerId?: string,
): boolean {
  return resolveUsageEntitlementOutcome(snapshot, providerId) === "active";
}

export function hasActiveCodingPlanSnapshot(
  snapshot: UsageEntitlementSnapshot | null,
  providerId: string,
): boolean {
  return (
    snapshot?.provider?.id === providerId &&
    snapshot.unavailableReason !== "no_plan" &&
    Boolean(snapshot.subscription?.details.length)
  );
}
