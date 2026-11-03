import {
  DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN,
  RASPBERRYCODE_VERSION,
  buildHelpAppConfigUrl,
  createHelpAppConfigReader,
  resolveHelpAppConfig,
  type Locale,
} from "@raspberrycode/shared";
import localDefaultAppConfig from "../../../../../config/default.json" with { type: "json" };

interface ResolveWebCommunityUrlOptions {
  fetchImpl?: typeof fetch;
  localConfig?: unknown;
  endpointOrigin?: string;
}

const readHelpConfig = createHelpAppConfigReader({
  fetchImpl: (input, init) => fetch(input, init),
});

export async function resolveWebHelpConfig(options: ResolveWebCommunityUrlOptions = {}) {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const endpoint =
    options.endpointOrigin ??
    (env?.VITE_RASPBERRYCODE_BASE_URL?.trim() ||
      env?.VITE_RASPBERRYCODE_ENDPOINT_ORIGIN?.trim() ||
      DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN);
  // 服务端拒绝 platform=web；浏览器省略可选平台参数，避免伪装桌面系统。
  const url = buildHelpAppConfigUrl(endpoint, RASPBERRYCODE_VERSION);
  let remote: unknown;
  try {
    remote = await (
      options.fetchImpl
        ? createHelpAppConfigReader({ fetchImpl: options.fetchImpl })
        : readHelpConfig
    )(url);
  } catch {
    // 远端不可用时保留内置入口，不使用旧 CDN 作为第二个远端配置源。
  }
  return resolveHelpAppConfig(remote, options.localConfig ?? localDefaultAppConfig);
}

export async function resolveWebCommunityUrl(
  locale: Locale,
  options: ResolveWebCommunityUrlOptions = {},
): Promise<string | undefined> {
  return (await resolveWebHelpConfig(options)).community_urls?.[locale];
}
