/* eslint-disable max-lines -- quota、entitlement 与 monitor 请求共用同一套 provider 鉴权逻辑，拆文件会让 Coding Plan strict key 边界更难追踪。 */
/**
 * 计量 API Key 的用量/额度查询适配（specs/provider-neutrality.md）。
 * wire 层的 envelope/payload 形状是计量用量 API（BigModel 协议）的响应格式事实，
 * 本目录按格式适配维护；服务层类名与消费链路保持中立，未来其他计量协议
 * 在此并列实现，不在消费方按品牌分支。
 */
import type {
  ApiClient,
  CodingPlanRegularTpsRequest,
  CodingPlanUsageRequest,
  CodingPlanUsageSnapshot,
  UsageEntitlementRequest,
  UsageEntitlementSnapshot,
  UsageStatsRequest,
  UsageStatsSnapshot,
} from "@zcode/shared";
import {
  ApiError,
  isZaiCodingPlanProviderId,
} from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import type { ICredentialService } from "../../credential/credential.js";
import { readApiJson } from "../../providers/api/apiJson.js";
import { readEnv } from "../../oauth/providers/configUtils.js";
import type {
  MeteredUsageModelUsagePayload,
  MeteredUsageModelUsageEnvelope,
  MeteredUsageToolUsagePayload,
  MeteredUsageToolUsageEnvelope,
  MeteredCreditUsageActivityPayload,
  MeteredCreditUsageActivityEnvelope,
  MeteredCreditUsageDetailPayload,
  MeteredCreditUsageDetailEnvelope,
  MeteredUsageModelPerformancePayload,
  MeteredUsageModelPerformanceEnvelope,
} from "./meteredUsageMonitorMapper.js";
import {
  buildCodingPlanUsageSnapshotFromMonitor,
  buildUsageStatsSnapshotFromMonitor,
} from "./meteredUsageMonitorMapper.js";
import {
  resolveCodingPlanUsageTimeRange,
  resolveUsageTimeRange,
} from "./meteredUsageMonitorRange.js";
import type { MeteredUsageQuotaEnvelope } from "./meteredUsageQuotaMapper.js";
import { normalizeLimits, pickPrimaryLimit } from "./meteredUsageQuotaMapper.js";

const BIGMODEL_QUOTA_PATH = "/api/monitor/usage/quota/limit";
const REQUEST_TIMEOUT_MS = 15_000;
const log = createServiceLogger("usage-stats");
const EMPTY_MODEL_USAGE_PAYLOAD = {} satisfies MeteredUsageModelUsagePayload;
const EMPTY_TOOL_USAGE_PAYLOAD = {} satisfies MeteredUsageToolUsagePayload;
const EMPTY_CREDIT_ACTIVITY_PAYLOAD = {} satisfies MeteredCreditUsageActivityPayload;
const EMPTY_CREDIT_DETAIL_PAYLOAD = {} satisfies MeteredCreditUsageDetailPayload;
const EMPTY_MODEL_PERFORMANCE_PAYLOAD = {} satisfies MeteredUsageModelPerformancePayload;

export interface UsageApiAuthorizationRequest {
  readonly preferredProviderId?: string;
  readonly requirePreferredProvider: boolean;
}

export interface UsageApiAuthorization {
  readonly authorization: string;
  readonly quotaUrl: string;
  readonly provider: ResolvedQuotaAuthorization["provider"];
}

interface MeteredUsageQuotaProviderOptions {
  apiClient: ApiClient;
  resolveApiAuthorization?: (
    request: UsageApiAuthorizationRequest,
  ) => Promise<UsageApiAuthorization | null>;
  credentialService?: Pick<ICredentialService, "load">;
  env?: NodeJS.ProcessEnv;
}

interface ResolvedQuotaAuthorization {
  authorization: string;
  quotaUrl: string;
  provider: {
    id: string;
    name: string;
  };
}

export class MeteredUsageQuotaProvider {
  private readonly apiClient: ApiClient;
  private readonly resolveApiAuthorization?: MeteredUsageQuotaProviderOptions["resolveApiAuthorization"];
  private readonly credentialService?: Pick<ICredentialService, "load">;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: MeteredUsageQuotaProviderOptions) {
    this.apiClient = options.apiClient;
    this.resolveApiAuthorization = options.resolveApiAuthorization;
    this.credentialService = options.credentialService;
    this.env = options.env ?? process.env;
  }

  async getSnapshot(): Promise<UsageEntitlementSnapshot> {
    return this.getSnapshotForRequest({});
  }

  async getSnapshotForRequest(
    request: UsageEntitlementRequest = {},
  ): Promise<UsageEntitlementSnapshot> {
    // 账号态已移除：请求里的 accountAccess 仅作为 shared 契约字段透传给 context 显示，
    // 不再做动态解析（resolveRequestAccountAccess/assertCurrent 链已删）。
    // 订阅/套餐判定已随订阅体系移除：不再查询订阅列表/团队权益/Start Plan 余额，
    // 快照只报告 API Key 用量额度；套餐状态未知即不判定（未知≠无套餐）。
    const generatedAt = Date.now();
    const providerId = request.preferredProviderId?.trim() ?? "";
    let resolved: ResolvedQuotaAuthorization | null = null;
    try {
      resolved = await this.resolveAuthorization({
        preferredProviderId: request.preferredProviderId,
        requirePreferredProvider: request.requirePreferredProvider === true,
        allowEnvApiKey: request.allowEnvApiKey,
      });
    } catch (error) {
      log.warn(undefined, "读取用量凭据失败，保留独立订阅判定", {
        error: error instanceof Error ? error.message : String(error),
        preferredProviderId: providerId,
      });
    }
    const subscription = null;
    const payload = resolved ? await this.fetchQuota(resolved).catch(() => null) : null;
    // quota 失败或 level 存在都不改变权益；额度耗尽也只影响用量显示。
    const quotaData = payload && isSuccessfulMeteredEnvelope(payload) ? payload.data : null;
    const limits = normalizeLimits(quotaData?.limits);
    const primaryLimit = pickPrimaryLimit(limits);
    return {
      generatedAt,
      authenticated: true,
      ...(!resolved ? { unavailableReason: "not_configured" as const } : {}),
      context: resolved
        ? buildUsageEntitlementContext(subscription)
        : buildUsageEntitlementContextFromRequest(request),
      provider: resolved?.provider ?? null,
      remaining: primaryLimit
        ? {
            count: primaryLimit.remaining ?? 0,
            isShow: true,
            percentage: primaryLimit.percentage,
            nextResetTime: primaryLimit.nextResetTime ?? null,
          }
        : null,
      subscription,
      quota: quotaData ? { level: quotaData.level?.trim() || null, limits } : null,
      // 官方 Server MCP 额度随账号态/官方 MCP 身份链一并移除，恒为 null。
      mcpQuota: null,
    };
  }

  async getUsageStatsSnapshot(request: UsageStatsRequest): Promise<UsageStatsSnapshot> {
    const resolved = await this.resolveAuthorization({
      preferredProviderId: request.preferredProviderId,
      requirePreferredProvider: request.requirePreferredProvider === true,
      allowEnvApiKey: request.allowEnvApiKey,
    });
    if (!resolved) {
      // 设置页使用统计可被显式收口到 Coding Plan provider。
      // 严格指定 provider 时不允许回退到普通 API Key、环境变量或本地 session 聚合。
      throw new Error("no_metered_api_key");
    }

    const { startTime, endTime } = resolveUsageTimeRange(request);
    const [modelPayload, toolPayload] = await Promise.all([
      this.fetchModelUsage(resolved, startTime, endTime),
      this.fetchToolUsage(resolved, startTime, endTime),
    ]);

    const modelData = readSuccessfulMeteredMonitorData(
      modelPayload,
      "Metered model usage failed",
      EMPTY_MODEL_USAGE_PAYLOAD,
    );
    const toolData = readSuccessfulMeteredMonitorData(
      toolPayload,
      "Metered tool usage failed",
      EMPTY_TOOL_USAGE_PAYLOAD,
      { allowMissingData: true },
    );

    return {
      ...buildUsageStatsSnapshotFromMonitor(request, modelData, toolData),
      sourceProvider: resolved.provider,
    };
  }

  async getCodingPlanUsageSnapshot(
    request: CodingPlanUsageRequest,
  ): Promise<CodingPlanUsageSnapshot> {
    const resolved = await this.resolveAuthorization({
      preferredProviderId: request.preferredProviderId,
      requirePreferredProvider: true,
      allowEnvApiKey: false,
    });
    if (!resolved) {
      // Coding Plan 用量现在直接使用对应 Coding Plan provider 的 API Key。
      // 缺少 key 时不能回退普通 API Key、环境变量、OAuth 或本地 App Usage。
      throw new Error(resolveCodingPlanApiKeyError(request.preferredProviderId));
    }

    const usageRange = resolveCodingPlanUsageTimeRange(request);
    // monitor 请求不能全有全无。quota 保持原有必须成功语义
    // （传输失败时整体失败，业务失败降级为 quota: null）；activity / detail / health
    // 是可选数据面，传输失败只清空对应区域并记 warn，任一路故障不能拖垮整张面板。
    const [quotaPayload, activityData, modelDetailData, toolDetailData, health7dData] =
      await Promise.all([
        this.fetchQuota(resolved),
        readBestEffortMeteredMonitorData(
          this.fetchCreditUsageActivity(resolved, request.timeZone),
          "Metered activity usage failed",
          EMPTY_CREDIT_ACTIVITY_PAYLOAD,
        ),
        readBestEffortMeteredMonitorData(
          this.fetchCreditUsageDetail(resolved, usageRange.startTime, usageRange.endTime, "MODEL"),
          "Metered model usage detail failed",
          EMPTY_CREDIT_DETAIL_PAYLOAD,
        ),
        readBestEffortMeteredMonitorData(
          this.fetchCreditUsageDetail(resolved, usageRange.startTime, usageRange.endTime, "MCP"),
          "Metered tool usage detail failed",
          EMPTY_CREDIT_DETAIL_PAYLOAD,
        ),
        readBestEffortMeteredMonitorData(
          this.fetchModelPerformanceDay(resolved, request.timeZone, "7d"),
          "Metered model performance failed",
          EMPTY_MODEL_PERFORMANCE_PAYLOAD,
        ),
      ]);

    const quota =
      isSuccessfulMeteredEnvelope(quotaPayload) && quotaPayload.data
        ? {
            level: quotaPayload.data.level?.trim() || null,
            limits: normalizeLimits(quotaPayload.data.limits),
          }
        : null;

    return buildCodingPlanUsageSnapshotFromMonitor({
      request,
      provider: resolved.provider,
      quota,
      granularity: usageRange.granularity,
      xTime: usageRange.xTime,
      startDateKey: usageRange.startDateKey,
      endDateKey: usageRange.endDateKey,
      activityData,
      modelDetailData,
      toolDetailData,
      healthData: health7dData,
    });
  }

  async getCodingPlanRegularTps(
    request: CodingPlanRegularTpsRequest,
  ): Promise<number | undefined> {
    const startedAt = Date.now();
    let requestUrl: string | undefined;
    let responseHeaders: Record<string, string> = {};
    let responseStatus: number | undefined;
    let responseStatusText: string | undefined;
    let responseCode: number | undefined;
    try {
      const resolved = await this.resolveAuthorization({
        preferredProviderId: request.preferredProviderId,
        requirePreferredProvider: true,
        allowEnvApiKey: false,
      });
      if (!resolved) throw new Error(resolveCodingPlanApiKeyError(request.preferredProviderId));

      const timeRange = resolveModelPerformanceTimeRange(request.timeZone, "7d");
      requestUrl = buildModelPerformanceMonitorUrl(
        resolved,
        timeRange.startTime,
        timeRange.endTime,
      );
      const response = await this.apiClient.request(requestUrl, {
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: createMeteredUsageHeaders(resolved),
      });
      responseStatus = response.status;
      responseStatusText = response.statusText;
      responseHeaders = readApiDiagnosticHeaders(response.headers) ?? {};
      let payload: MeteredUsageModelPerformanceEnvelope | undefined;
      let parseError: unknown;
      try {
        payload = JSON.parse(await response.text()) as MeteredUsageModelPerformanceEnvelope;
        responseCode = typeof payload.code === "number" ? payload.code : undefined;
      } catch (error) {
        parseError = error;
      }
      if (!response.ok) {
        throw new ApiError({
          message: readApiErrorMessage(payload, `HTTP ${response.status}`),
          url: requestUrl,
          method: "GET",
          status: response.status,
          responseHeaders,
          cause: parseError,
        });
      }
      if (parseError !== undefined || payload === undefined) {
        throw new ApiError({
          message: parseError instanceof Error ? parseError.message : "Invalid JSON response",
          url: requestUrl,
          method: "GET",
          status: response.status,
          responseHeaders,
          cause: parseError,
        });
      }
      const data = readSuccessfulMeteredMonitorData<MeteredUsageModelPerformancePayload>(
        payload,
        "Metered model performance failed",
        EMPTY_MODEL_PERFORMANCE_PAYLOAD,
        { allowMissingData: true },
      );
      return data.proMaxDecodeSpeed?.findLast(
        (value) => Number.isFinite(value) && value > 0,
      );
    } catch (error) {
      // Bug 原因：Highspeed 仅在 Renderer 记录了 TPS 读取失败文案，Host 层丢失了
      // monitor 的 HTTP status 和 request id，无法与后端日志对账。只输出 ApiError 中的安全诊断头。
      log.warn(undefined, "Highspeed 普通 TPS 健康检查失败", {
        error: error instanceof Error ? error.message : String(error),
        providerId: request.preferredProviderId,
        durationMs: Date.now() - startedAt,
        status: error instanceof ApiError ? error.status : (responseStatus ?? null),
        statusText: responseStatusText ?? null,
        responseCode: responseCode ?? null,
        responseHeaders:
          error instanceof ApiError ? (error.responseHeaders ?? responseHeaders) : responseHeaders,
        url: sanitizeMonitorDiagnosticUrl(error instanceof ApiError ? error.url : requestUrl),
      });
      throw error;
    }
  }

  private async resolveAuthorization(
    request: {
      preferredProviderId?: string;
      requirePreferredProvider?: boolean;
      allowEnvApiKey?: boolean;
    } = {},
  ): Promise<ResolvedQuotaAuthorization | null> {
    if (request.allowEnvApiKey !== false && request.requirePreferredProvider !== true) {
      const envApiKey =
        readEnv(this.env, "ZCODE_BIGMODEL_USAGE_API_KEY") ??
        readEnv(this.env, "BIGMODEL_USAGE_API_KEY");
      if (envApiKey) {
        return {
          authorization: envApiKey,
          quotaUrl: resolveQuotaUrlFromEnv(this.env) ?? buildMeteredQuotaUrl(this.env),
          provider: {
            id: "env:bigmodel-usage",
            name: "Metered",
          },
        };
      }
    }

    const providerId = request.preferredProviderId?.trim() ?? "";
    // 账号态已移除：Coding Plan 动态凭据解析链（accountRequestAuthService）不再存在。
    // Coding Plan 与普通 provider 共用同一条装配层注入的鉴权来源（resolveApiAuthorization），
    // 未注入即未配置（no_metered_api_key），不回退环境变量/OAuth/本地聚合。
    const apiAuthorization = await this.resolveApiAuthorization?.({
      preferredProviderId: providerId || undefined,
      requirePreferredProvider: request.requirePreferredProvider === true,
    });
    return apiAuthorization ?? null;
  }

  private async fetchQuota(
    resolved: ResolvedQuotaAuthorization,
  ): Promise<MeteredUsageQuotaEnvelope> {
    return readApiJson<MeteredUsageQuotaEnvelope>(this.apiClient, buildQuotaLimitUrl(resolved), {
      method: "GET",
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: createMeteredUsageHeaders(resolved),
    });
  }

  private async fetchModelUsage(
    resolved: ResolvedQuotaAuthorization,
    startTime: string,
    endTime: string,
  ): Promise<MeteredUsageModelUsageEnvelope> {
    return readApiJson<MeteredUsageModelUsageEnvelope>(
      this.apiClient,
      buildUsageMonitorUrl(resolved, "model-usage", startTime, endTime),
      {
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: createMeteredUsageHeaders(resolved),
      },
    );
  }

  private async fetchToolUsage(
    resolved: ResolvedQuotaAuthorization,
    startTime: string,
    endTime: string,
  ): Promise<MeteredUsageToolUsageEnvelope> {
    return readApiJson<MeteredUsageToolUsageEnvelope>(
      this.apiClient,
      buildUsageMonitorUrl(resolved, "tool-usage", startTime, endTime),
      {
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: createMeteredUsageHeaders(resolved),
      },
    );
  }

  private async fetchCreditUsageActivity(
    resolved: ResolvedQuotaAuthorization,
    timeZone: string | undefined,
  ): Promise<MeteredCreditUsageActivityEnvelope> {
    const range = resolveCreditUsageActivityTimeRange(timeZone);
    return readApiJson<MeteredCreditUsageActivityEnvelope>(
      this.apiClient,
      buildCreditUsageMonitorUrl(resolved, "activity", range.startTime, range.endTime),
      {
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: createMeteredUsageHeaders(resolved),
      },
    );
  }

  private async fetchCreditUsageDetail(
    resolved: ResolvedQuotaAuthorization,
    startTime: string,
    endTime: string,
    usageType: "MODEL" | "MCP",
  ): Promise<MeteredCreditUsageDetailEnvelope> {
    return readApiJson<MeteredCreditUsageDetailEnvelope>(
      this.apiClient,
      buildCreditUsageMonitorUrl(resolved, "usage-detail", startTime, endTime, usageType),
      {
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: createMeteredUsageHeaders(resolved),
      },
    );
  }

  private async fetchModelPerformanceDay(
    resolved: ResolvedQuotaAuthorization,
    timeZone: string | undefined,
    range: "7d" | "30d",
  ): Promise<MeteredUsageModelPerformanceEnvelope> {
    const timeRange = resolveModelPerformanceTimeRange(timeZone, range);
    return readApiJson<MeteredUsageModelPerformanceEnvelope>(
      this.apiClient,
      buildModelPerformanceMonitorUrl(resolved, timeRange.startTime, timeRange.endTime),
      {
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: createMeteredUsageHeaders(resolved),
      },
    );
  }
}

function readApiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }
  const record = payload as Record<string, unknown>;
  for (const key of ["error", "message", "msg", "detail"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

function readApiDiagnosticHeaders(headers: Headers): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const name of ["x-request-id", "x-trace-id", "x-span-id"] as const) {
    const value = headers.get(name)?.trim();
    if (value) {
      result[name] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// 联调对账后缀：envelope 业务错误（如 2007 依赖失败）需要把后端 x-request-id
// 带进错误 message，RPC 日志和 UI warn 才能与后端日志按请求 id 精确对上。
// 仅用于日志定位，客户端不做分支；缺失时返回空串保持原 message 契约。
function buildUsageEntitlementContextFromRequest(
  request: Pick<UsageEntitlementRequest, "accountAccess">,
): UsageEntitlementSnapshot["context"] {
  if (
    !request.accountAccess ||
    !("planKind" in request.accountAccess) ||
    request.accountAccess.planKind !== "team-coding-plan"
  ) {
    return { scope: "personal" };
  }
  return {
    scope: "team",
    organizationId: request.accountAccess.organizationId,
    projectId: request.accountAccess.projectId,
  };
}

function buildUsageEntitlementContext(
  subscription: UsageEntitlementSnapshot["subscription"],
): UsageEntitlementSnapshot["context"] {
  // 账号态移除后不再有 Team Plan 身份上下文，一律按 personal 报告。
  return {
    scope: "personal",
    productId: subscription?.details[0]?.productId || null,
    displayName: subscription?.details[0]?.productName || null,
  };
}

function createMeteredUsageHeaders(resolved: ResolvedQuotaAuthorization): Record<string, string> {
  // monitor 接口要求 authorization 直接传完整凭据。
  // 普通用量和 Coding Plan 用量都走 API Key，不能额外加 Bearer 前缀。
  return {
    authorization: resolved.authorization,
  };
}

function buildQuotaLimitUrl(resolved: ResolvedQuotaAuthorization): string {
  return resolved.quotaUrl;
}

function readSuccessfulMeteredMonitorData<TData extends object>(
  payload: {
    code?: number;
    message?: string;
    msg?: string;
    success?: boolean;
    data?: TData | null;
  },
  fallbackMessage: string,
  emptyData: TData,
  options: { allowMissingData?: boolean } = {},
): TData {
  if (!isSuccessfulMeteredEnvelope(payload)) {
    throw new Error(readMeteredEnvelopeMessage(payload) || fallbackMessage);
  }
  if (payload.data) {
    return payload.data;
  }
  if (options.allowMissingData === true && hasExplicitMeteredSuccessSignal(payload)) {
    // Metered monitor 的 tool-usage 在团队项目无工具调用时会返回
    // code=200、msg=“操作成功”但省略 data。空用量应显示为空统计，不能中断整个统计页。
    return emptyData;
  }
  throw new Error(readMeteredEnvelopeMessage(payload) || fallbackMessage);
}

// credit-usage/activity、usage-detail、model-performance-day 是可选数据面。
// 传输层失败（HTTP 非 2xx、超时、断网）时只清空对应区域并记 warn，不能让
// Promise.all 提前 reject 拖垮整张 Coding Plan Usage 面板。HTTP 200 但业务信封失败
// （如 token expired）仍由 readSuccessfulMeteredMonitorData 抛错：鉴权/后端错误必须
// 显式暴露给用户，不能伪装成空用量（既有测试已锁定该语义）。
async function readBestEffortMeteredMonitorData<TData extends object>(
  request: Promise<{
    code?: number;
    message?: string;
    msg?: string;
    success?: boolean;
    data?: TData | null;
  }>,
  fallbackMessage: string,
  emptyData: TData,
): Promise<TData> {
  let payload: Awaited<typeof request> | null = null;
  try {
    payload = await request;
  } catch (error) {
    log.warn(undefined, `${fallbackMessage}，该区域降级为空统计`, {
      error: error instanceof Error ? error.message : String(error),
      status: error instanceof ApiError ? error.status : null,
    });
    return emptyData;
  }
  return readSuccessfulMeteredMonitorData(payload, fallbackMessage, emptyData, {
    allowMissingData: true,
  });
}

function readMeteredEnvelopeMessage(payload: { message?: string; msg?: string }): string {
  return payload.msg?.trim() || payload.message?.trim() || "";
}

function sanitizeMonitorDiagnosticUrl(url: string | undefined): string {
  if (!url) return "<unknown-monitor-url>";
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "<invalid-monitor-url>";
  }
}

function hasExplicitMeteredSuccessSignal(payload: { code?: number; success?: boolean }): boolean {
  return payload.success === true || payload.code === 0 || payload.code === 200;
}

function isSuccessfulMeteredEnvelope(payload: { code?: number; success?: boolean }): boolean {
  const code = payload.code;
  // Metered monitor/quota 后端存在 code=0 且 msg=“操作成功”的成功响应。
  // 只按 code=200 判断会把团队用量统计的成功包误抛成错误，导致设置页显示无法读取统计。
  return (
    payload.success !== false && (code === undefined || code === null || code === 0 || code === 200)
  );
}

function buildUsageMonitorUrl(
  resolved: ResolvedQuotaAuthorization,
  endpoint: "model-usage" | "tool-usage",
  startTime: string,
  endTime: string,
): string {
  const url = new URL(resolved.quotaUrl);
  url.pathname = url.pathname.replace(/\/quota\/limit$/, `/${endpoint}`);
  url.searchParams.set("startTime", startTime);
  url.searchParams.set("endTime", endTime);
  return url.toString();
}

function buildCreditUsageMonitorUrl(
  resolved: ResolvedQuotaAuthorization,
  endpoint: "activity" | "usage-detail",
  startTime: string,
  endTime: string,
  usageType?: "MODEL" | "MCP",
): string {
  const url = new URL(resolved.quotaUrl);
  url.pathname = url.pathname.replace(/\/usage\/quota\/limit$/, `/credit-usage/${endpoint}`);
  url.searchParams.set("type", "1");
  url.searchParams.set("startTime", startTime);
  url.searchParams.set("endTime", endTime);
  if (usageType) {
    url.searchParams.set("usageType", usageType);
  }
  return url.toString();
}

function buildModelPerformanceMonitorUrl(
  resolved: ResolvedQuotaAuthorization,
  startTime: string,
  endTime: string,
): string {
  const url = new URL(resolved.quotaUrl);
  url.pathname = url.pathname.replace(/\/quota\/limit$/, "/model-performance-day");
  url.searchParams.set("startTime", startTime);
  url.searchParams.set("endTime", endTime);
  return url.toString();
}

function resolveCreditUsageActivityTimeRange(timeZone: string | undefined): {
  startTime: string;
  endTime: string;
} {
  const endDateKey = formatDateInTimeZone(new Date(), timeZone);
  const startDateKey = addDaysToDateKey(endDateKey, -365);
  return {
    startTime: `${startDateKey} 00:00:00`,
    endTime: `${endDateKey} 23:59:59`,
  };
}

function resolveModelPerformanceTimeRange(
  timeZone: string | undefined,
  range: "7d" | "30d",
): {
  startTime: string;
  endTime: string;
} {
  const endDateKey = formatDateInTimeZone(new Date(), timeZone);
  const startDateKey = addDaysToDateKey(endDateKey, range === "7d" ? -6 : -29);
  return {
    startTime: `${startDateKey} 00:00:00`,
    endTime: `${endDateKey} 23:59:59`,
  };
}

function formatDateInTimeZone(date: Date, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year = "1970", month = "01", day = "01"] = dateKey.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function resolveQuotaUrlFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  return readEnv(env, "ZCODE_BIGMODEL_USAGE_QUOTA_URL") ?? readEnv(env, "BIGMODEL_USAGE_QUOTA_URL");
}

function resolveCodingPlanApiKeyError(providerId: string | undefined): string {
  if (providerId && isZaiCodingPlanProviderId(providerId)) {
    return "zai_coding_plan_api_key_required";
  }
  return "bigmodel_coding_plan_api_key_required";
}

// 厂商事实地址（API Key 用量配额查询）；不再经产品端点拼装。
function buildMeteredQuotaUrl(_env: NodeJS.ProcessEnv = process.env): string {
  return `https://bigmodel.cn${BIGMODEL_QUOTA_PATH}`;
}
