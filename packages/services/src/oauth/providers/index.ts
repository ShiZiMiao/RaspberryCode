import type { ApiClient } from "@raspberrycode/shared";
import type { OAuthRuntimeConfig } from "../runtimeConfig.js";
import type { OAuthProviderAdapter } from "./providerAdapter.js";

/**
 * 智谱/Z.ai 登录适配器已随登录体系移除（产品中立化：剔除必须登录才能使用的功能）。
 * 保留注册入口与适配器接口供未来中立账号体系复用；当前无任何 provider 适配器。
 */
export function createOAuthProviderAdapters(
  _config: OAuthRuntimeConfig,
  _options: { apiClient?: ApiClient } = {},
): OAuthProviderAdapter[] {
  return [];
}

export type { OAuthProviderAdapter, OAuthProviderContext } from "./providerAdapter.js";
