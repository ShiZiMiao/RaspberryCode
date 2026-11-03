
// HTTP-Referer 仅在用户配置了服务端点时发送（单机版无默认云服务，不向模型厂商泄漏占位域）。
export const RASPBERRYCODE_SOURCE_HEADERS = {
  "User-Agent": "RaspberryCode/unknown",
  "X-Title": "RaspberryCode@electron",
} as const;

export interface BuildRaspberryCodeSourceHeadersFromContextOptions {
  appVersion?: string;
  arch?: string;
  clientLanguage?: string;
  clientTimezone?: string;
  deviceMid?: string;
  endpointOrigin?: string;
  osVersion?: string;
  platform?: string;
  releaseChannel?: string;
  sourceTitle?: string;
}

export function normalizeRaspberryCodeSourceHeaderValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^[\x20-\x7e]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function buildRaspberryCodeSourceHeadersFromContext(
  options: BuildRaspberryCodeSourceHeadersFromContextOptions = {},
): Record<string, string> {
  const appVersion = normalizeRaspberryCodeSourceHeaderValue(options.appVersion);
  const arch = normalizeRaspberryCodeSourceHeaderValue(options.arch);
  const clientLanguage = normalizeRaspberryCodeSourceHeaderValue(options.clientLanguage) ?? "unknown";
  const clientTimezone = normalizeRaspberryCodeSourceHeaderValue(options.clientTimezone) ?? "unknown";
  const deviceMid = normalizeRaspberryCodeSourceHeaderValue(options.deviceMid);
  const endpointOrigin = normalizeRaspberryCodeSourceHeaderValue(options.endpointOrigin);
  const osVersion = normalizeRaspberryCodeSourceHeaderValue(options.osVersion);
  const platform = normalizeRaspberryCodeSourceHeaderValue(options.platform);
  const releaseChannel = normalizeRaspberryCodeSourceHeaderValue(options.releaseChannel);
  const sourceTitle = normalizeRaspberryCodeSourceHeaderValue(options.sourceTitle) ?? "electron";

  return {
    ...RASPBERRYCODE_SOURCE_HEADERS,
    ...(endpointOrigin ? { "HTTP-Referer": endpointOrigin } : {}),
    "User-Agent": `RaspberryCode/${appVersion ?? "unknown"}`,
    ...(appVersion ? { "X-RaspberryCode-App-Version": appVersion } : {}),
    "X-Title": `RaspberryCode@${sourceTitle}`,
    ...(platform && arch ? { "X-Platform": `${platform}-${arch}` } : {}),
    ...(releaseChannel ? { "X-Release-Channel": releaseChannel } : {}),
    "X-Client-Language": clientLanguage,
    "X-Client-Timezone": clientTimezone,
    ...(platform ? { "X-Os-Category": normalizeOsCategory(platform) } : {}),
    ...(osVersion ? { "X-Os-Version": osVersion } : {}),
    ...(deviceMid ? { "X-Device-Mid": deviceMid } : {}),
  };
}

function normalizeOsCategory(platform: string): string {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}
