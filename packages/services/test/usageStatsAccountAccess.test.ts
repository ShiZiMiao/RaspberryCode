import { BUILTIN_MODEL_PROVIDER_IDS, type ApiClient } from "@raspberrycode/shared";
import { describe, expect, it, vi } from "vitest";
import { createUsageStatsService } from "../src/usage-stats/usageStatsService.js";

/**
 * 账号态已移除：不再有 Account Request Auth 动态凭据解析（resolveCurrent/assertCurrent/
 * resolveAccessCurrent）。Coding Plan 权益/用量在无注入鉴权来源时按未配置处理，
 * 且 accountAccess 只作为 shared 契约字段透传到 context，不做动态解析。
 */
describe("UsageStats account access", () => {
  it("无注入鉴权来源时 Coding Plan 权益快照按未配置处理，不发起远端请求", async () => {
    const request = vi.fn(async () => {
      throw new Error("账号态移除后不应发起任何权益请求");
    });
    const service = createUsageStatsService({
      apiClient: { request } as ApiClient,
      credentialService: { load: vi.fn(async () => null) },
      raspberrycodeAgentService: {
        getAppUsageStats: vi.fn(),
      },
    });

    await expect(
      service.getEntitlementSnapshot({
        preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        accountAccess: {
          type: "zhipu-account",
          family: "zai",
          planKind: "individual-coding-plan",
        },
        requirePreferredProvider: true,
        allowEnvApiKey: false,
      }),
    ).resolves.toMatchObject({
      authenticated: true,
      unavailableReason: "not_configured",
      provider: null,
      mcpQuota: null,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("请求里的 accountAccess 只透传到 context 显示，不做动态解析", async () => {
    const request = vi.fn(async () => {
      throw new Error("账号态移除后不应发起任何权益请求");
    });
    const service = createUsageStatsService({
      apiClient: { request } as ApiClient,
      credentialService: { load: vi.fn(async () => null) },
      raspberrycodeAgentService: {
        getAppUsageStats: vi.fn(),
      },
    });

    await expect(
      service.getEntitlementSnapshot({
        preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        accountAccess: {
          type: "zhipu-account",
          family: "bigmodel",
          planKind: "team-coding-plan",
          productId: "product-1",
          organizationId: "org-1",
          projectId: "project-1",
        },
        requirePreferredProvider: true,
        allowEnvApiKey: false,
      }),
    ).resolves.toMatchObject({
      context: { scope: "team", organizationId: "org-1", projectId: "project-1" },
      mcpQuota: null,
    });
    expect(request).not.toHaveBeenCalled();
  });
});
