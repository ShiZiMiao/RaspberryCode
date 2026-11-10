import { TOOL_SEARCH_BETA, type Model, type ToolSearchCapability } from "@raspberrycode/contracts";

const ANTHROPIC_MESSAGES_API_TYPE = "anthropic-messages";

export function resolveToolSearchCapability(
  apiType: string,
  access: { type: string; mode?: string },
): ToolSearchCapability {
  const protocolSupported = apiType === ANTHROPIC_MESSAGES_API_TYPE;
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

/** 模型请求能力只由协议与接入方式决定；core 投影据此选择请求形态。 */
export function resolveModelRequestCapabilities(
  apiType: string,
  access: { type: string; mode?: string },
): NonNullable<Model["requestCapabilities"]> {
  return {
    toolSearch: resolveToolSearchCapability(apiType, access),
    // 只在 Anthropic Messages 协议把提醒并入 tool result；OpenAI 兼容协议保持独立的 user 消息。
    foldRemindersIntoToolResults: apiType === ANTHROPIC_MESSAGES_API_TYPE,
  };
}
