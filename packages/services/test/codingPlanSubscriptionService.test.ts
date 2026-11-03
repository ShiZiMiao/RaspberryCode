import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_MODEL_PROVIDER_IDS, CODING_PLAN_SYSTEM_BUSY, type ApiClient } from "@raspberrycode/shared";
import {
  BigModelCodingPlanSubscriptionProvider,
  resolveCodingPlanClientConfigUrl,
} from "../src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.js";
import { createCodingPlanSubscriptionService } from "../src/coding-plan-subscription/codingPlanSubscriptionService.js";

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createZaiBatchPreviewResponse(): Response {
  return createJsonResponse({
    code: 200,
    data: {
      productList: [
        {
          productId: "zai-product-pro",
          productName: "Z.ai Coding Pro",
          payAmount: 72,
        },
      ],
      isSubscribed: false,
      isAuthenticated: true,
    },
  });
}

function createHtmlErrorResponse(): Response {
  const body = [
    '<!doctypehtml><html lang="zh-cn"><title>405</title>',
    "<body>Sorry, your request has been blocked.</body></html>",
  ].join("");
  return new Response(body, {
    status: 405,
    headers: { "Content-Type": "text/html" },
  });
}

function createBigModelCredentialService(token = "oauth-token") {
  return {
    load: vi.fn(async (key: string) => (key === "oauth:bigmodel:access_token" ? token : null)),
  };
}

describe("BigModelCodingPlanSubscriptionProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each(["legacy", "preflight-v1", "unknown", undefined])(
    "预算固定 preflight-v1，不消费远端 strategy=%s 的缓存",
    async (strategy) => {
      const request = vi.fn(async () =>
        createJsonResponse({
          code: 0,
          data: { configs: { modelContextBudget: { strategy } } },
        }),
      );
      const provider = new BigModelCodingPlanSubscriptionProvider({
        apiClient: { request },
        credentialService: { load: vi.fn() },
      });
      // 由其他消费者填充真实共享缓存；预算不能再读出旧算法或发起刷新。
      await provider.getForceUpdateConfig();
      request.mockClear();
      await expect(provider.getModelContextBudgetStrategy()).resolves.toBe("preflight-v1");
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("配置永不返回时预算立即完成，不发请求也不启动超时器", async () => {
    vi.useFakeTimers();
    const request = vi.fn(() => new Promise<Response>(() => {}));
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient: { request },
      credentialService: { load: vi.fn() },
    });
    let value: string | undefined;
    void provider.getModelContextBudgetStrategy().then((result) => {
      value = result;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(value).toBe("preflight-v1");
    expect(request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });















  it("client configs 根据 RASPBERRYCODE_ENV 选择测试或生产环境", () => {
    expect(
      resolveCodingPlanClientConfigUrl({
        RASPBERRYCODE_ENV: "test",
        // 显式传 scoped 端点：测环境选择逻辑，不锚定默认占位域。
        RASPBERRYCODE_TEST_BASE_URL: "https://raspberrycode.example.com",
      }).toString(),
    ).toBe("https://raspberrycode.example.com/api/v1/client/configs");
    expect(
      resolveCodingPlanClientConfigUrl({
        RASPBERRYCODE_ENV: "production",
        RASPBERRYCODE_PRODUCTION_BASE_URL: "https://runtime.example.com",
      }).toString(),
    ).toBe("https://runtime.example.com/api/v1/client/configs");
  });

  it("getForceUpdateConfig 从 RaspberryCode client config 读取强制升级配置", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 0,
          msg: "",
          data: {
            configs: {
              forceUpdate: {
                minimalVersion: " 4.0.0 ",
              },
            },
          },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(),
      },
    });

    await expect(provider.getForceUpdateConfig()).resolves.toEqual({
      minimalVersion: "4.0.0",
    });
    expect(apiClient.request).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("getForceUpdateConfig 在字段缺失时返回 null", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 0,
          msg: "",
          data: {
            configs: {},
          },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(),
      },
    });

    await expect(provider.getForceUpdateConfig()).resolves.toBeNull();
  });

  it("getForceUpdateConfig 在 minimalVersion 类型不合法时返回 null", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 0,
          msg: "",
          data: {
            configs: {
              forceUpdate: {
                minimalVersion: 4,
              },
            },
          },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(),
      },
    });

    await expect(provider.getForceUpdateConfig()).resolves.toBeNull();
  });





  it("client configs 缓存 1 小时后重新请求", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T00:00:00.000Z"));
    const apiClient: ApiClient = {
      request: vi
        .fn()
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 0,
            msg: "",
            data: {
              configs: {
                forceUpdate: { minimalVersion: "1.0.0" },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 0,
            msg: "",
            data: {
              configs: {
                forceUpdate: { minimalVersion: "2.0.0" },
              },
            },
          }),
        ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(),
      },
    });

    await expect(provider.getForceUpdateConfig()).resolves.toMatchObject({
      minimalVersion: "1.0.0",
    });
    vi.setSystemTime(new Date("2026-06-12T00:59:59.000Z"));
    await expect(provider.getForceUpdateConfig()).resolves.toMatchObject({
      minimalVersion: "1.0.0",
    });
    expect(apiClient.request).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-06-12T01:00:01.000Z"));
    await expect(provider.getForceUpdateConfig()).resolves.toMatchObject({
      minimalVersion: "2.0.0",
    });
    expect(apiClient.request).toHaveBeenCalledTimes(2);
  });




















});


