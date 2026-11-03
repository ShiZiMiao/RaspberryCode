import {
  BIGMODEL_PROVIDER_ID,
  ZAI_PROVIDER_ID,
  type OAuthProviderId,
} from "@raspberrycode/shared";

interface OAuthProviderLogoutDependencies {
  readonly refreshAccountProviders?: (reason: string) => Promise<unknown>;
}

/**
 * 账号态已移除：登出不再清理账号 API Key（accountProviderCredentialKey 链已删），
 * 只保留「zai/bigmodel 登出触发 Account Source 刷新」的钩子形状供装配层收口。
 */
export function createOAuthProviderLogoutHandler(
  dependencies: OAuthProviderLogoutDependencies,
): (provider: OAuthProviderId, accountIdentity?: string | null) => Promise<void> {
  return async (provider) => {
    if (!isAccountProvider(provider)) return;
    await dependencies.refreshAccountProviders?.(`oauth-logout:${provider}`);
  };
}

function isAccountProvider(provider: OAuthProviderId): boolean {
  return provider === ZAI_PROVIDER_ID || provider === BIGMODEL_PROVIDER_ID;
}
