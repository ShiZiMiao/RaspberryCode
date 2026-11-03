import { materializeRaspberryCodeBuiltinProviderConfig } from "@raspberrycode/services/node";

declare const __RASPBERRYCODE_BUILTIN_PROVIDER_CONFIG_JSON__: string | undefined;

export interface MaterializeBundledRaspberryCodeBuiltinProviderConfigOptions {
  readonly environmentConfigRoot: string;
  readonly content: string;
}

/** 返回构建时嵌入远端 Server 的 RaspberryCode Built-in Provider Config。 */
export function readBundledRaspberryCodeBuiltinProviderConfig(): string {
  if (typeof __RASPBERRYCODE_BUILTIN_PROVIDER_CONFIG_JSON__ !== "string") {
    throw new Error("当前构建未嵌入 RaspberryCode Built-in Provider Config");
  }
  return __RASPBERRYCODE_BUILTIN_PROVIDER_CONFIG_JSON__;
}

/**
 * 将 RaspberryCode Built-in Config 原子物化到所属环境的固定资源副本。
 * 升级前退出旧进程；不保留按内容 hash 增长的历史文件。
 */
export async function materializeBundledRaspberryCodeBuiltinProviderConfig(
  options: MaterializeBundledRaspberryCodeBuiltinProviderConfigOptions,
): Promise<string> {
  return materializeRaspberryCodeBuiltinProviderConfig(options);
}
