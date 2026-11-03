import { describe, expect, it, vi } from "vitest";
import { ZAI_PROVIDER_ID } from "@raspberrycode/shared";
import { createOAuthProviderLogoutHandler } from "../src/oauth/oauthProviderLogout.js";

describe("oauthProviderLogout", () => {
  it("账号态移除后登出只刷新 Account Source，不再清理账号凭据", async () => {
    const refreshAccountProviders = vi.fn(async () => {});
    const handleLogout = createOAuthProviderLogoutHandler({
      refreshAccountProviders,
    });

    await handleLogout(ZAI_PROVIDER_ID, "account-a");

    expect(refreshAccountProviders).toHaveBeenCalledWith("oauth-logout:zai");
    expect(refreshAccountProviders).toHaveBeenCalledTimes(1);
  });

  it("非账号 Provider 登出不触发刷新", async () => {
    const refreshAccountProviders = vi.fn(async () => {});
    const handleLogout = createOAuthProviderLogoutHandler({
      refreshAccountProviders,
    });

    await handleLogout("github", "account-a");

    expect(refreshAccountProviders).not.toHaveBeenCalled();
  });
});
