import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_MODEL_PROVIDER_IDS, type ApiClient } from "@zcode/shared";
import { MeteredUsageQuotaProvider } from "../src/usage-stats/providers/meteredUsageQuotaProvider.js";

const TEST_BIGMODEL_PROVIDER_ID = "test-bigmodel-api-provider";

interface TestUsageProvider {
  id: string;
  apiKey: string;
  name?: string;
}

interface LegacyModelProviderReader {
  getAllCached(): Promise<TestUsageProvider[]>;
}

type LegacyQuotaProviderTestOptions = Omit<
  ConstructorParameters<typeof MeteredUsageQuotaProvider>[0],
  "resolveApiAuthorization"
> & {
  modelProviderService?: LegacyModelProviderReader;
};

/**
 * 账号态移除后不再有 Account Request Auth 动态凭据链；Coding Plan 鉴权只来自装配层注入
 * （resolveApiAuthorization）。测试继续用 provider 列表充当 key 来源，未同步/空 key 即未配置。
 */
function createProviderForTest(
  options: LegacyQuotaProviderTestOptions,
): MeteredUsageQuotaProvider {
  return new MeteredUsageQuotaProvider({
    ...options,
    resolveApiAuthorization: async ({ preferredProviderId }) => {
      const providers = await options.modelProviderService?.getAllCached();
      const provider = providers?.find((candidate) =>
        preferredProviderId ? candidate.id === preferredProviderId : true,
      );
      const apiKey = provider?.apiKey?.trim() ?? "";
      if (!provider || !apiKey) return null;
      return {
        authorization: apiKey,
        quotaUrl: "https://bigmodel.cn/api/monitor/usage/quota/limit",
        provider: { id: provider.id, name: provider.name ?? provider.id },
      };
    },
  });
}

function createMeteredCodingPlanProvider(): TestUsageProvider {
  return {
    id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    apiKey: "bigmodel-api-key",
    name: "Metered - Coding Plan",
  };
}

function createMeteredApiKeyProvider(): TestUsageProvider {
  return {
    ...createMeteredCodingPlanProvider(),
    id: TEST_BIGMODEL_PROVIDER_ID,
    apiKey: "ordinary-api-key",
    name: "Metered",
  };
}

function createZaiCodingPlanProvider(): TestUsageProvider {
  return {
    id: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
    apiKey: "zai-api-key",
    name: "Z.ai - Coding Plan",
  };
}

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", Date: "Tue, 02 Jun 2026 00:00:00 GMT" },
  });
}

describe("MeteredUsageQuotaProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("没有 Coding Plan apiKey 时不调用 quota 接口", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 200,
          data: {
            level: "pro",
            limits: [
              {
                type: "TIME_LIMIT",
                remaining: 5,
                nextResetTime: Date.UTC(2026, 4, 26),
              },
            ],
          },
        }),
      ),
    };
    const provider = createProviderForTest({
      apiClient,
      modelProviderService: {
        getAllCached: vi.fn(async () => [
          {
            ...createMeteredCodingPlanProvider(),
            apiKey: "",
          },
        ]),
      } as LegacyModelProviderReader,
    });

    const snapshot = await provider.getSnapshotForRequest({
      preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      requirePreferredProvider: true,
      allowEnvApiKey: false,
    });

    expect(apiClient.request).not.toHaveBeenCalled();
    expect(snapshot.unavailableReason).toBe("not_configured");
    expect(snapshot.provider).toBeNull();
  });

  it("严格指定 Coding Plan 时不会回退到普通 API Key provider", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(),
    };
    const provider = createProviderForTest({
      apiClient,
      modelProviderService: {
        getAllCached: vi.fn(async () => [
          {
            ...createMeteredCodingPlanProvider(),
            apiKey: "",
          },
          createMeteredApiKeyProvider(),
        ]),
      } as LegacyModelProviderReader,
    });

    const snapshot = await provider.getSnapshotForRequest({
      preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      requirePreferredProvider: true,
      allowEnvApiKey: false,
    });

    expect(apiClient.request).not.toHaveBeenCalled();
    expect(snapshot.unavailableReason).toBe("not_configured");
    expect(snapshot.provider).toBeNull();
  });

  it("Z.ai Coding Plan provider 未同步时按未配置权益处理", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(),
    };
    const provider = createProviderForTest({
      apiClient,
      modelProviderService: {
        getAllCached: vi.fn(async () => []),
      } as LegacyModelProviderReader,
      credentialService: {
        load: vi.fn(async () => "zai-oauth-token"),
      },
    });

    const snapshot = await provider.getSnapshotForRequest({
      preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      requirePreferredProvider: true,
      includeSubscription: false,
    });

    expect(apiClient.request).not.toHaveBeenCalled();
    expect(snapshot.unavailableReason).toBe("not_configured");
    expect(snapshot.provider).toBeNull();
  });

  it("Z.ai Coding Plan 空 apiKey 时按未配置权益处理且不回退 OAuth token", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(),
    };
    const provider = createProviderForTest({
      apiClient,
      modelProviderService: {
        getAllCached: vi.fn(async () => [
          {
            ...createZaiCodingPlanProvider(),
            apiKey: "",
          },
        ]),
      } as LegacyModelProviderReader,
      credentialService: {
        load: vi.fn(async () => "zai-oauth-token"),
      },
    });

    const snapshot = await provider.getSnapshotForRequest({
      preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      requirePreferredProvider: true,
      includeSubscription: false,
    });

    expect(apiClient.request).not.toHaveBeenCalled();
    expect(snapshot.unavailableReason).toBe("not_configured");
    expect(snapshot.provider).toBeNull();
  });

  it("账号态移除后权益快照恒为 personal 语义且不含 MCP 额度", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 200,
          data: {
            level: "pro",
            limits: [
              {
                type: "TIME_LIMIT",
                remaining: 5,
                nextResetTime: Date.UTC(2026, 4, 26),
              },
            ],
          },
        }),
      ),
    };
    const provider = createProviderForTest({
      apiClient,
      modelProviderService: {
        getAllCached: vi.fn(async () => [createMeteredCodingPlanProvider()]),
      } as LegacyModelProviderReader,
    });

    const snapshot = await provider.getSnapshotForRequest({
      preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      requirePreferredProvider: true,
      allowEnvApiKey: false,
    });

    expect(snapshot.unavailableReason).toBeUndefined();
    expect(snapshot.context).toMatchObject({ scope: "personal" });
    expect(snapshot.mcpQuota).toBeNull();
    expect(snapshot.quota?.limits[0]).toMatchObject({
      type: "TIME_LIMIT",
      remaining: 5,
    });
  });
});
