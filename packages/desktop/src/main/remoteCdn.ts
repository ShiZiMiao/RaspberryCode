import { RASPBERRYCODE_VERSION, type RaspberryCodeEnv } from "@raspberrycode/shared";

declare const __RASPBERRYCODE_REMOTE_CDN_RELEASE_ROOTS__: readonly string[] | undefined;

const TEST_REMOTE_CDN_RELEASE_ROOT = "http://intranet.example.invalid:12345/ssh-remote-assets";

export interface ResolveRemoteCdnOptions {
  env?: RaspberryCodeEnv;
  overrideBaseUrl?: string;
  version?: string;
}

/**
 * 中立性（specs/provider-neutrality.md 规则 6）：远程资产下载根不内置任何品牌 CDN 默认值。
 * 来源只有三处显式配置：
 * - 构建期 CI 注入的 `__RASPBERRYCODE_REMOTE_CDN_RELEASE_ROOTS__`（由 CDN_DOMAIN/OSS_PATH_PREFIX 生成）；
 * - 运行期显式配置（`RASPBERRYCODE_REMOTE_ASSET_CDN_BASE_URL` 覆盖）；
 * - 运行期自托管本地发布目录（`RASPBERRYCODE_REMOTE_ASSET_LOCAL_RELEASE_DIR`），
 *   由 sourceServerReleaseResolver 走本地上传通道，不经本函数。
 * 本函数只产出 HTTP 发布根；三源皆缺时由 remote-assets 装配层显式报「未配置发布根」，
 * 而不是静默回退到任何默认域名。历史品牌默认域名已移除。
 */
export function resolveRemoteCdnBaseUrls(options: ResolveRemoteCdnOptions = {}): string[] {
  const overrideBaseUrl = options.overrideBaseUrl?.trim();
  if (overrideBaseUrl) {
    return [normalizeBaseUrl(overrideBaseUrl)];
  }

  const version = options.version ?? RASPBERRYCODE_VERSION;
  if (options.env === "test") {
    return [`${TEST_REMOTE_CDN_RELEASE_ROOT}/${version}`];
  }

  const configuredReleaseRoots =
    typeof __RASPBERRYCODE_REMOTE_CDN_RELEASE_ROOTS__ === "undefined"
      ? []
      : __RASPBERRYCODE_REMOTE_CDN_RELEASE_ROOTS__;
  // 构建期按 CI 的 CDN_DOMAIN/OSS_PATH_PREFIX 注入有序列表，切换时只改 CI 变量。
  return configuredReleaseRoots.map((releaseRoot) => `${normalizeBaseUrl(releaseRoot)}/${version}`);
}

export function resolvePrimaryRemoteCdnBaseUrl(
  options: ResolveRemoteCdnOptions = {},
): string | undefined {
  return resolveRemoteCdnBaseUrls(options)[0];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}
