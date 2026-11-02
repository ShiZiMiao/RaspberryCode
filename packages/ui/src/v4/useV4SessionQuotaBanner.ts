import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { IUsageStatsService } from "@zcode/services";
import type { SessionErrorInfo, SessionPhase } from "@zcode/shared/zcode-protocol-v4";
import { useUsageEntitlementWithService } from "@/hooks/useUsageEntitlement.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import {
  resolveGlmQuotaBannerBusinessCode,
  resolveStartPlanConcurrentLimitBannerReason,
  resolveStartPlanConcurrentLimitBusinessCode,
  resolveStartPlanQuotaExhaustedBusinessCode,
} from "@/lib/providerBusinessError.js";
import {
  buildSessionQuotaBannerDismissKey,
  buildSessionQuotaBannerState,
} from "@/v4/sessionQuotaBannerState.js";
import type { McpUnavailableNotice } from "@/v4/mcpUnavailableBannerNotice.js";
import { logger } from "@/logger.js";
import { sessionQuotaBannerDismissalStore } from "@/v4/sessionQuotaBannerDismissalStore.js";

function isRunningPhase(phase: SessionPhase | null): boolean {
  return phase === "prewarming" || phase === "running";
}

/** 额度请求守护：只有活跃 provider 配置了计量 Key（metered-api-key）才有可查额度。 */
function hasMeteredApiKey(
  access: { type?: string; apiKey?: string } | null | undefined,
): boolean {
  return (
    (access?.type === "metered-api-key" ||
      // 旧值读兼容（构造归一前的原始 JSON）。
      access?.type === "zhipu-coding-plan-api-key") &&
    Boolean(access?.apiKey?.trim())
  );
}

/**
 * V4 quota 业务状态：conversation snapshot 只提供当前 provider/model/错误，额度仍由
 * usage stats 服务读取（meteredUsageQuotaProvider 的 API Key 用量）。
 * 两者在 renderer 合并；账号套餐权益已随订阅体系移除，横幅只做信息提示。
 */
export function useV4SessionQuotaBanner(params: {
  sessionId: string | null;
  error: SessionErrorInfo | null;
  errorKey: string | null;
  phase: SessionPhase | null;
  providerId: string | null;
  modelId: string | null;
  usageStatsService?: IUsageStatsService;
  /**
   * 官方 Server MCP 不可用的事实。由调用方从 conversation rows 解析——它是会话事件的投影，
   * 与额度服务无关，不放进这个 hook 里取。
   */
  mcpUnavailableNotice?: McpUnavailableNotice | null;
}) {
  const activeProviderId = params.providerId?.trim() || null;
  const modelId = params.modelId?.trim() || null;
  const quotaExhaustedCode = resolveStartPlanQuotaExhaustedBusinessCode(
    params.error?.code,
    params.error?.message,
  );
  const concurrentLimitCode = resolveStartPlanConcurrentLimitBusinessCode(
    params.error?.code,
    params.error?.message,
  );
  const providerLimitedCode = resolveGlmQuotaBannerBusinessCode(params.error?.code);
  // 展示规则（含 provider 范围）由 sessionQuotaBannerState 统一判定；这里只透传业务码。
  const serverQuotaExhausted = quotaExhaustedCode === "1005";
  const serverConcurrentLimited = Boolean(concurrentLimitCode);
  const serverProviderLimited = Boolean(providerLimitedCode);

  // 请求守护：只有活跃 provider 配置了计量 Key 才读取额度，避免对普通
  // api-key/无 Key provider 发无谓请求（其它情况由服务端业务码/MCP 分支覆盖）。
  const providerSettingsRead = useProviderSettingsView();
  const hasMeteredKey = useMemo(() => {
    if (providerSettingsRead.state.status !== "ready" || !activeProviderId) return false;
    const provider = providerSettingsRead.state.view.providers.find(
      (entry) => entry.providerId === activeProviderId,
    );
    return hasMeteredApiKey(
      (provider?.effectiveConfig as { access?: { type?: string; apiKey?: string } } | undefined)
        ?.access,
    );
  }, [providerSettingsRead.state, activeProviderId]);

  const entitlement = useUsageEntitlementWithService(params.usageStatsService, {
    enabled: hasMeteredKey,
    preferredProviderId: activeProviderId ?? undefined,
    allowDisabledPreferredProvider: true,
    requirePreferredProvider: true,
    allowEnvApiKey: true,
    refreshOnMount: false,
  });
  const state = useMemo(
    () =>
      buildSessionQuotaBannerState({
        activeProviderId,
        snapshot: entitlement.snapshot,
        modelId,
        serverQuotaExhausted,
        serverConcurrentLimited,
        ...(concurrentLimitCode ? { serverConcurrentLimitBusinessCode: concurrentLimitCode } : {}),
        ...(concurrentLimitCode
          ? {
              serverConcurrentLimitReason: resolveStartPlanConcurrentLimitBannerReason(
                params.error?.message,
              ),
            }
          : {}),
        ...(providerLimitedCode ? { serverProviderLimitedBusinessCode: providerLimitedCode } : {}),
        ...(serverProviderLimited
          ? { serverProviderLimitedMessage: params.error?.message ?? null }
          : {}),
        ...(params.mcpUnavailableNotice
          ? { mcpUnavailableNotice: params.mcpUnavailableNotice }
          : {}),
      }),
    [
      activeProviderId,
      concurrentLimitCode,
      entitlement.snapshot,
      modelId,
      params.error?.message,
      params.mcpUnavailableNotice,
      providerLimitedCode,
      serverConcurrentLimited,
      serverProviderLimited,
      serverQuotaExhausted,
    ],
  );

  // 只有命中服务端业务错误分支的展示才接管 composer 错误；bucket 提示不吞原始错误。
  const takesOverError = Boolean(
    (serverQuotaExhausted && state.kind === "daily-exhausted") ||
      (serverConcurrentLimited && state.kind === "concurrent-limit") ||
      (serverProviderLimited && state.kind === "provider-limited"),
  );

  const dismissKey = buildSessionQuotaBannerDismissKey(
    state,
    takesOverError ? params.errorKey : null,
  );
  useSyncExternalStore(
    sessionQuotaBannerDismissalStore.subscribe,
    sessionQuotaBannerDismissalStore.getSnapshot,
    sessionQuotaBannerDismissalStore.getSnapshot,
  );
  const dismissed = Boolean(
    params.sessionId &&
      dismissKey &&
      sessionQuotaBannerDismissalStore.isDismissed(params.sessionId, dismissKey),
  );
  const restoredDismissalRef = useRef<string | null>(null);
  useEffect(() => {
    if (!dismissed || !params.sessionId || !dismissKey) return;
    const fingerprint = `${params.sessionId} ${dismissKey}`;
    if (restoredDismissalRef.current === fingerprint) return;
    restoredDismissalRef.current = fingerprint;
    logger.debug("session quota banner dismissal restored", {
      dismissKey,
      sessionId: params.sessionId,
    });
  }, [dismissKey, dismissed, params.sessionId]);

  const previousPhaseRef = useRef<SessionPhase | null>(params.phase);
  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = params.phase;
    if (previousPhase === params.phase) return;
    if (isRunningPhase(previousPhase) !== isRunningPhase(params.phase)) {
      // 任务开始会预占额度，终止会扣减或释放；必须绕过普通 freshness 校正一次。
      void entitlement.refresh({ force: true, silent: true, reason: "manual" });
    }
  }, [entitlement.refresh, params.phase]);

  const modelRefreshInitializedRef = useRef(false);
  const previousModelKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const nextKey = activeProviderId && modelId ? `${activeProviderId}:${modelId}` : null;
    const previousKey = previousModelKeyRef.current;
    previousModelKeyRef.current = nextKey;
    if (!modelRefreshInitializedRef.current) {
      modelRefreshInitializedRef.current = true;
      return;
    }
    if (nextKey && nextKey !== previousKey) {
      void entitlement.refresh({ reason: "initial" });
    }
  }, [activeProviderId, entitlement.refresh, modelId]);

  const dismiss = useCallback(() => {
    if (!params.sessionId || !dismissKey) return;
    sessionQuotaBannerDismissalStore.dismiss(params.sessionId, dismissKey);
  }, [dismissKey, params.sessionId]);

  return {
    state,
    dismissKey,
    dismissed,
    dismiss,
    takesOverError,
  } as const;
}
