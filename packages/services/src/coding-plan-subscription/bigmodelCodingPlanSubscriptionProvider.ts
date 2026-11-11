import {
  ApiError,
  CODING_PLAN_SYSTEM_BUSY,
  readValidatedRequestVerificationConfig,
  requestVerificationClaimHeaders,
  isRequestVerificationMessage,
  type RequestVerificationClientConfig,
} from "@raspberrycode/shared";
import type {
  ApiClient,
  ApiRequestInit,
  RequestVerificationConfig,
  ForceUpdateConfig,
  RaspberryCodeModelContextBudgetStrategy,
  DynamicWorkflowClientConfig,
} from "@raspberrycode/shared";
import {
  RASPBERRYCODE_VERSION,
  DEFAULT_RASPBERRYCODE_MODEL_CONTEXT_BUDGET_STRATEGY,
  createDynamicWorkflowClientConfig,
  normalizeDynamicWorkflowMode,
  resolveDynamicWorkflowClientConfig,
  DEFAULT_DYNAMIC_WORKFLOW_MODE,
  RASPBERRYCODE_DYNAMIC_WORKFLOW_MODE_ENV,
  buildRuntimeRaspberryCodeApiUrl,
} from "@raspberrycode/shared";
import type { ICredentialService } from "../credential/credential.js";
import { readApiJson } from "../providers/api/apiJson.js";
import { createServiceLogger } from "../logger/serviceLogger.js";

/**
 * 订阅/购买/支付/企业 API 已随 Coding Plan 体系移除（specs/no-login-startup.md 后续裁剪、
 * 产品中立化裁剪）。本 provider 只剩平台级灰度配置读取（client/configs 同源）与
 * 账号态探测共用的鉴权头工具函数。
 */
const RASPBERRYCODE_CLIENT_CONFIG_API_PREFIX = "/api/v1/client/configs";
const REQUEST_TIMEOUT_MS = 15_000;
const CLIENT_CONFIG_CACHE_TTL_MS = 60 * 60 * 1000;
const log = createServiceLogger("codingPlanSubscription");

interface RaspberryCodeClientConfigEnvelope {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: {
    configs?:
      | (RequestVerificationClientConfig & {
          forceUpdate?: ForceUpdateConfig | null;
          modelContextBudget?: {
            strategy?: unknown;
          } | null;
          // 动态工作流灰度：mode 的取值域由
          // shared 的 normalizeDynamicWorkflowMode 裁决，这里保持 unknown，不在类型层假设服务端合法。
          dynamicWorkflow?: {
            mode?: unknown;
          } | null;
        })
      | null;
  } | null;
}

interface BigModelCodingPlanSubscriptionProviderOptions {
  apiClient: ApiClient;
  credentialService: Pick<ICredentialService, "load">;
}

export class BigModelCodingPlanSubscriptionProvider {
  protected readonly apiClient: ApiClient;
  private clientConfigSnapshot: RaspberryCodeClientConfigEnvelope | null = null;
  private clientConfigSnapshotExpiresAt = 0;
  private clientConfigRequest: Promise<RaspberryCodeClientConfigEnvelope> | null = null;

  constructor(options: BigModelCodingPlanSubscriptionProviderOptions) {
    this.apiClient = options.apiClient;
  }

  /**
   * 动态工作流灰度快照：与闲时任务同走
   * client/configs，零新增请求。三条边界：
   *   1. 本地覆盖（RASPBERRYCODE_DYNAMIC_WORKFLOW_MODE）在任何网络动作之前裁决，命中即返回——
   *      preview 构建和开发者手测因此不受 1h 快照与首次 Host 竞态影响；
   *   2. forceRefresh 与 Off-Peak 同义，清掉快照后重拉（灰度翻转最长 1h 不可见）；
   *   3. 请求失败 fail-closed：返回 default（disabled）并 warn，绝不把异常抛给调用方——
   *      调用方在 session create/client 就绪路径上，灰度读失败不能阻断普通聊天。
   */
  async getDynamicWorkflowClientConfig(options?: {
    forceRefresh?: boolean;
  }): Promise<DynamicWorkflowClientConfig> {
    // 覆盖合法即短路：判据（normalize）与快照构造（resolve）都留在 shared，这里不复述取值域。
    if (normalizeDynamicWorkflowMode(process.env[RASPBERRYCODE_DYNAMIC_WORKFLOW_MODE_ENV])) {
      return resolveDynamicWorkflowClientConfig({ remote: undefined, env: process.env });
    }
    if (options?.forceRefresh) {
      this.clientConfigSnapshot = null;
      this.clientConfigSnapshotExpiresAt = 0;
    }
    try {
      const payload = await this.getClientConfigs();
      return resolveDynamicWorkflowClientConfig({
        remote: payload.data?.configs?.dynamicWorkflow,
        env: process.env,
      });
    } catch (error) {
      log.warn(undefined, "动态工作流灰度配置读取失败，按关闭处理", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return createDynamicWorkflowClientConfig(DEFAULT_DYNAMIC_WORKFLOW_MODE, "default");
    }
  }

  async getModelContextBudgetStrategy(): Promise<RaspberryCodeModelContextBudgetStrategy> {
    // 3.12.2：预算统一为 preflight-v1；保留兼容方法，但不能再为每次建会话等待远端配置。
    return DEFAULT_RASPBERRYCODE_MODEL_CONTEXT_BUDGET_STRATEGY;
  }

  async getRequestVerificationConfig(): Promise<RequestVerificationConfig | null> {
    const payload = await this.getClientConfigs();
    // HTTP 成功不等于配置有效；坏配置不能按网络故障自动重试，更不能打开跳过校验。
    if ((payload.code !== undefined && payload.code !== 0) || payload.success === false) {
      throw new Error("Request verification configuration is invalid");
    }
    return readValidatedRequestVerificationConfig(payload.data?.configs);
  }

  async getForceUpdateConfig(): Promise<ForceUpdateConfig | null> {
    const payload = await this.getClientConfigs();
    return unwrapClientConfigForceUpdate(payload);
  }

  private async getClientConfigs(): Promise<RaspberryCodeClientConfigEnvelope> {
    if (this.clientConfigSnapshot && this.clientConfigSnapshotExpiresAt > Date.now()) {
      return this.clientConfigSnapshot;
    }
    if (this.clientConfigRequest) {
      return await this.clientConfigRequest;
    }

    // client/configs 和其他 RaspberryCode 平台接口必须共享运行时 endpoint；
    // E2E/测试环境会通过 RASPBERRYCODE_BASE_URL 指向本地 mock，硬编码线上域名会让套餐状态不可控。
    const url = resolveCodingPlanClientConfigUrl(process.env);
    url.searchParams.set("app_version", RASPBERRYCODE_VERSION);
    url.searchParams.set("platform", resolveClientPlatformKey());
    this.clientConfigRequest = readCodingPlanApiJson<RaspberryCodeClientConfigEnvelope>(
      this.apiClient,
      url,
      {
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
    );
    try {
      const payload = await this.clientConfigRequest;
      this.clientConfigSnapshot = payload;
      this.clientConfigSnapshotExpiresAt = Date.now() + CLIENT_CONFIG_CACHE_TTL_MS;
      return payload;
    } finally {
      this.clientConfigRequest = null;
    }
  }
}

export function resolveCodingPlanClientConfigUrl(env: NodeJS.ProcessEnv): URL {
  return new URL(buildRuntimeRaspberryCodeApiUrl(env, RASPBERRYCODE_CLIENT_CONFIG_API_PREFIX));
}

function resolveClientPlatformKey(): string {
  return `${process.platform}-${process.arch}`;
}

async function readCodingPlanApiJson<T>(
  apiClient: ApiClient,
  input: string | URL,
  init?: ApiRequestInit,
): Promise<T> {
  try {
    return await readApiJson<T>(apiClient, input, init);
  } catch (error) {
    const message = readRemoteErrorMessage(error);
    if (isUnrenderableRemoteErrorMessage(message)) {
      // 配置接口偶发返回 WAF/HTML 页面或非 JSON 响应，原样透传会污染配置解析。
      // 服务边界先收敛为稳定错误码，UI 再做本地化提示。
      // HTML 只影响展示，不能丢掉 HTTP 状态和传输原因，否则配置读取无法区分 503 与 401。
      if (error instanceof ApiError) {
        throw new ApiError({
          message: CODING_PLAN_SYSTEM_BUSY,
          url: error.url,
          method: error.method,
          status: error.status,
          responseHeaders: error.responseHeaders,
          // 原 ApiError.message 可能是完整 HTML；只延续底层 cause，不把正文重新带入错误链。
          cause: error.cause,
        });
      }
      throw new Error(CODING_PLAN_SYSTEM_BUSY);
    }
    throw error;
  }
}

function readRemoteErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return String(error);
}

function isUnrenderableRemoteErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("<!doctype") ||
    /<\s*(html|head|body|script|style|title|meta)\b/.test(normalized) ||
    normalized.includes("errors.aliyun.com") ||
    normalized.includes("request has been blocked") ||
    normalized.includes("unexpected token '<'") ||
    normalized.includes("unexpected end of json input") ||
    normalized.includes("invalid json response")
  );
}

function unwrapClientConfigForceUpdate(
  payload: RaspberryCodeClientConfigEnvelope,
): ForceUpdateConfig | null {
  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(payload.msg?.trim() || "RaspberryCode client config request failed");
  }

  const forceUpdate = payload.data?.configs?.forceUpdate;
  if (!forceUpdate) {
    return null;
  }

  const minimalVersion = forceUpdate.minimalVersion;
  if (typeof minimalVersion !== "string" || minimalVersion.trim() === "") {
    return null;
  }

  return { minimalVersion: minimalVersion.trim() };
}

// 厂商侧账号态探测的鉴权头工具（createBigModelLoginAuthHeaders /
// createZaiLoginAuthHeaders）随闲时任务与加速卡一并移除：两个函数已无调用方，
// 也不经 index/node 导出，仅剩品牌字面量在源码里空转。
