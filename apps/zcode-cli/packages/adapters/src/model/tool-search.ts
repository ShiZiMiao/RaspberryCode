import { TOOL_SEARCH_BETA, type ToolSearchCapability } from "@zcode/contracts";

export function resolveToolSearchCapability(
  apiType: string,
  access: { type: string; mode?: string },
): ToolSearchCapability {
  const protocolSupported = apiType === "anthropic-messages";
  // 只认 api-key/metered-api-key；旧值 zhipu-coding-plan-api-key 保留兼容判定（历史配置）。
  const codingPlan =
    access.type === "api-key" ||
    access.type === "metered-api-key" ||
    access.type === "zhipu-coding-plan-api-key";
  return Object.freeze({ protocolSupported, defaultEnabled: protocolSupported && codingPlan });
}

export function toolSearchHeaders(headers: Record<string, string> | undefined, enabled?: boolean) {
  if (!enabled) return headers;
  const result = { ...headers };
  const key =
    Object.keys(result).find((name) => name.toLowerCase() === "anthropic-beta") ?? "anthropic-beta";
  result[key] = [
    ...new Set([
      ...(result[key]
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean) ?? []),
      TOOL_SEARCH_BETA,
    ]),
  ].join(",");
  return result;
}
