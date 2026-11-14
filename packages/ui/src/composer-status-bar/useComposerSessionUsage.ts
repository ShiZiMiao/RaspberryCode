import { useEffect, useState } from "react";
import type { RaspberryCodeTaskTokenUsageResult } from "@raspberrycode/shared";
import { useServices } from "@/hooks/useServices.js";
import type { ComposerSessionUsageFacts } from "./contract.js";

/** 会话进行中用量还会增长；活跃态按节拍轮询，空闲态不重复请求。 */
const ACTIVE_REFRESH_INTERVAL_MS = 2_000;

function toFacts(result: RaspberryCodeTaskTokenUsageResult): ComposerSessionUsageFacts {
  return {
    totalTokens: result.totalTokens,
    outputTokens: result.outputTokens,
    uncachedInputTokens: result.uncachedInputTokens,
    cacheReadTokens: result.cacheReadTokens,
    cacheHitRate: result.cacheHitRate,
    roundCount: result.roundCount,
    stepCount: result.stepCount,
    modelDurationMs: result.modelDurationMs,
    avgTimeToFirstTokenMs: result.avgTimeToFirstTokenMs,
    outputTokensPerSecond: result.outputTokensPerSecond,
  };
}

/**
 * 读取会话的 token/统计事实（`v4/conversation/usage`）。
 *
 * 所有者仍是 CLI 的 usage store：本 hook 不缓存、不合并、不推算，只把一次查询结果带到渲染层。
 * 重查时机由 `active` 决定——轮次运行时按节拍刷新，结束时由 `active` 变 false 触发最后一次读取，
 * 避免空闲会话持续打请求，也避免把「上一轮的数字」当成当前轮。
 */
export function useComposerSessionUsage({
  workspacePath,
  workspaceIdentity,
  sessionId,
  active,
  enabled = true,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string | null;
  /** 会话是否正在产生新用量（running）。 */
  active: boolean;
  enabled?: boolean;
}): ComposerSessionUsageFacts | null {
  const { raspberrycodeAgentService } = useServices();
  const scopeKey = JSON.stringify([workspaceIdentity?.trim() || workspacePath, sessionId]);
  const [result, setResult] = useState<{
    key: string;
    service: typeof raspberrycodeAgentService;
    facts: ComposerSessionUsageFacts | null;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const usage = await raspberrycodeAgentService.getTaskTokenUsage({
          workspacePath,
          workspaceIdentity,
          sessionId,
        });
        if (!disposed) {
          setResult({
            key: scopeKey,
            service: raspberrycodeAgentService,
            facts: toFacts(usage),
          });
        }
      } catch {
        // 用量是展示面；查询失败保留上一份事实，不把状态条打成错误态。
      } finally {
        if (!disposed && active) {
          timer = setTimeout(() => void refresh(), ACTIVE_REFRESH_INTERVAL_MS);
        }
      }
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [
    active,
    enabled,
    raspberrycodeAgentService,
    scopeKey,
    sessionId,
    workspaceIdentity,
    workspacePath,
  ]);

  // 切换会话后旧结果不得落到新会话上。
  if (result?.key !== scopeKey || result.service !== raspberrycodeAgentService) {
    return null;
  }
  return result.facts;
}
