import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { RaspberryCodeProvider } from "./raspberrycode-task-types-core.js";

export const RASPBERRYCODE_AGENT_PROVIDER = "agent" satisfies RaspberryCodeProvider;
export const RASPBERRYCODE_AGENT_PROVIDER_LABEL = "RaspberryCode Agent";
export const RASPBERRYCODE_COMMAND_AGENT_SOURCE = "raspberrycodeAgent" satisfies CommandAgentSource;

/**
 * 解析持久化/relay 数据时的 provider 归一 schema：
 * 已移除的第三方 provider 历史值仅作为归一化输入保留，统一收敛为 agent（历史 glm 值随 transform 归一，读兼容保留）；
 * 其它非法值保持拒绝，与收窄前的校验边界一致。
 */
export const legacyRaspberryCodeProviderSchema = z
  .enum(["claude", "opencode", "gemini", "codex", "glm", "agent"])
  .transform((): typeof RASPBERRYCODE_AGENT_PROVIDER => RASPBERRYCODE_AGENT_PROVIDER);

export const RASPBERRYCODE_ENABLED_AGENT_PROVIDERS = [
  RASPBERRYCODE_AGENT_PROVIDER,
] as const satisfies readonly RaspberryCodeProvider[];

export const RASPBERRYCODE_COMMAND_AGENT_SOURCES = [
  RASPBERRYCODE_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToRaspberryCodeAgent(
  _provider?: RaspberryCodeProvider | null,
): RaspberryCodeProvider {
  return RASPBERRYCODE_AGENT_PROVIDER;
}

export function normalizeAgentProvidersToRaspberryCodeAgent(
  _providers?: ReadonlyArray<RaspberryCodeProvider> | null,
): RaspberryCodeProvider[] {
  return [...RASPBERRYCODE_ENABLED_AGENT_PROVIDERS];
}

export function normalizeCommandAgentSourceToRaspberryCodeAgent(
  _agentSource?: CommandAgentSource | null,
): CommandAgentSource {
  return RASPBERRYCODE_COMMAND_AGENT_SOURCE;
}

export function isRaspberryCodeAgentProvider(
  provider: RaspberryCodeProvider | null | undefined,
): provider is typeof RASPBERRYCODE_AGENT_PROVIDER {
  return provider === RASPBERRYCODE_AGENT_PROVIDER;
}
