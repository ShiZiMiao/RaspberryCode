export const RASPBERRYCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV = "RASPBERRYCODE_BUILTIN_PROVIDER_CONFIG_FILE";
export const RASPBERRYCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV =
  "RASPBERRYCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE";
export const RASPBERRYCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV = "RASPBERRYCODE_PERSONAL_PROVIDER_CONFIG_FILE";
export const PERSONAL_PROVIDER_CONFIG_FILE_NAME = "provider_config.json";

export interface NodeProviderRuntimePaths {
  readonly raspberrycodeBuiltinFilePath: string;
  readonly personalFilePath: string;
}

export function createNodeProviderRuntimePathEnv(
  paths: NodeProviderRuntimePaths,
): Record<string, string> {
  return {
    [RASPBERRYCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: paths.raspberrycodeBuiltinFilePath,
    [RASPBERRYCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: paths.personalFilePath,
  };
}

export function resolveNodeProviderRuntimePaths(
  env: Readonly<Record<string, string | undefined>>,
): NodeProviderRuntimePaths | null {
  const raspberrycodeBuiltinFilePath = env[RASPBERRYCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const personalFilePath = env[RASPBERRYCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]?.trim();
  if (!raspberrycodeBuiltinFilePath && !personalFilePath) return null;
  if (!raspberrycodeBuiltinFilePath || !personalFilePath) {
    throw new Error("RaspberryCode Built-in 与 Personal Provider Config 路径必须同时提供");
  }
  return Object.freeze({ raspberrycodeBuiltinFilePath, personalFilePath });
}
