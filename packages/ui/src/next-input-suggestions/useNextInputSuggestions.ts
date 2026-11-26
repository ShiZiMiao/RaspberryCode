/**
 * 下一步输入预测的请求编排（spec：specs/next-input-suggestions.md）。
 *
 * 只读：调用 `conversationInputPredictionV4`，不写会话、不进历史。
 * 每轮最多一次：`requestedTurnKeyRef` 记录已请求的轮次；迟到响应按 `requestId` 丢弃。
 * 失败静默：任何异常都收敛成「无建议」，不向用户报错。
 */
import { useEffect, useRef, useState } from "react";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { logger } from "@/logger.js";
import {
  NEXT_INPUT_PREDICTION_DELAY_MS,
  resolveNextInputSuggestionCandidates,
  shouldRequestNextInputPrediction,
} from "./contract.js";

export interface UseNextInputSuggestionsParams {
  enabled: boolean;
  focused: boolean;
  sessionId: string | null;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  revision: number;
  turnKey: string | null;
  turnCompleted: boolean;
}

export interface UseNextInputSuggestionsResult {
  candidates: readonly string[];
}

export function useNextInputSuggestions(
  params: UseNextInputSuggestionsParams,
): UseNextInputSuggestionsResult {
  const resolution = useWorkspaceServicesResolution(
    params.workspacePath,
    params.remoteSessionId,
    params.workspaceIdentity,
  );
  const [candidates, setCandidates] = useState<readonly string[]>([]);
  // revision 只作为请求参数，不进入 effect 依赖：同一轮内 revision 变化不应重复打模型。
  const revisionRef = useRef(params.revision);
  revisionRef.current = params.revision;
  const requestedTurnKeyRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);

  useEffect(() => {
    const sessionId = params.sessionId;
    const turnKey = params.turnKey;
    const canRequest = shouldRequestNextInputPrediction({
      enabled: params.enabled,
      focused: params.focused,
      rpcReady: resolution.rpcReady,
      sessionId,
      turnKey,
      turnCompleted: params.turnCompleted,
    });
    if (!canRequest || !sessionId || !turnKey) {
      // 门禁失效：清空候选并作废在途请求，避免旧结果落到新一轮或新会话。
      requestedTurnKeyRef.current = null;
      activeRequestIdRef.current = null;
      setCandidates((current) => (current.length === 0 ? current : []));
      return;
    }
    if (requestedTurnKeyRef.current === turnKey) return;
    requestedTurnKeyRef.current = turnKey;
    const requestId = `next-input-${++sequenceRef.current}`;
    activeRequestIdRef.current = requestId;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await resolution.services.raspberrycodeAgentService
            .conversationInputPredictionV4({
              workspacePath: params.workspacePath,
              ...(params.workspaceIdentity
                ? { workspaceIdentity: params.workspaceIdentity }
                : {}),
              ...(params.remoteSessionId ? { remoteSessionId: params.remoteSessionId } : {}),
              sessionId,
              revision: revisionRef.current,
              requestId,
            });
          if (activeRequestIdRef.current !== requestId) return;
          setCandidates(resolveNextInputSuggestionCandidates(result));
        } catch (error) {
          if (activeRequestIdRef.current !== requestId) return;
          // 只记错误类型与消息，不记候选与会话内容。
          logger.warn("[next-input-suggestions] 预测失败", {
            error: error instanceof Error ? error.message : String(error),
            sessionId,
          });
          setCandidates([]);
        }
      })();
    }, NEXT_INPUT_PREDICTION_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    params.enabled,
    params.focused,
    params.sessionId,
    params.turnKey,
    params.turnCompleted,
    params.workspacePath,
    params.workspaceIdentity,
    params.remoteSessionId,
    resolution.rpcReady,
    resolution.services.raspberrycodeAgentService,
  ]);

  return { candidates };
}
