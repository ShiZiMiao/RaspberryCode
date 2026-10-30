import type { UsageQuotaLimit, UsageQuotaUsageDetail } from "@zcode/shared";

export interface BigModelUsageQuotaEnvelope {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: BigModelUsageQuotaPayload | null;
}

export interface BigModelUsageQuotaPayload {
  level?: string;
  limits?: BigModelUsageQuotaLimitPayload[];
}

interface BigModelUsageQuotaLimitPayload {
  type?: string;
  unit?: number;
  number?: number;
  usage?: number;
  currentValue?: number;
  remaining?: number;
  percentage?: number;
  nextResetTime?: number;
  usageDetails?: Array<{
    modelCode?: string;
    displayName?: string;
    usage?: number;
  }>;
}

export function normalizeLimits(limits: BigModelUsageQuotaPayload["limits"]): UsageQuotaLimit[] {
  if (!Array.isArray(limits)) {
    return [];
  }

  return limits
    .filter((limit) => typeof limit.type === "string" && limit.type.length > 0)
    .map((limit) => ({
      type: limit.type ?? "",
      ...(typeof limit.unit === "number" ? { unit: limit.unit } : {}),
      ...(typeof limit.number === "number" ? { number: limit.number } : {}),
      ...(typeof limit.usage === "number" ? { usage: limit.usage } : {}),
      ...(typeof limit.currentValue === "number" ? { currentValue: limit.currentValue } : {}),
      ...(typeof limit.remaining === "number" ? { remaining: limit.remaining } : {}),
      ...(typeof limit.percentage === "number" ? { percentage: limit.percentage } : {}),
      ...(typeof limit.nextResetTime === "number" ? { nextResetTime: limit.nextResetTime } : {}),
      usageDetails: normalizeUsageDetails(limit.usageDetails),
    }));
}

export function pickPrimaryLimit(limits: UsageQuotaLimit[]): UsageQuotaLimit | null {
  return (
    limits.find((limit) => limit.type === "TIME_LIMIT") ??
    limits.find((limit) => typeof limit.remaining === "number") ??
    limits[0] ??
    null
  );
}

function normalizeUsageDetails(
  details: BigModelUsageQuotaLimitPayload["usageDetails"],
): UsageQuotaUsageDetail[] {
  if (!Array.isArray(details)) {
    return [];
  }

  return details
    .filter((detail) => typeof detail.modelCode === "string")
    .map((detail) => ({
      modelCode: detail.modelCode ?? "",
      ...(typeof detail.displayName === "string" && detail.displayName.trim().length > 0
        ? { displayName: detail.displayName.trim() }
        : {}),
      usage: typeof detail.usage === "number" ? detail.usage : 0,
    }));
}
