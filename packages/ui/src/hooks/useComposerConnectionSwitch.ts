import { completeNewModelSelection } from "@raspberrycode/provider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useBaseWorkspaceServices,
  useWorkspaceServicesResolution,
} from "@/hooks/useWorkspaceServices.js";
import { useRaspberryCodeIntl } from "@/i18n/IntlProvider.js";
import { buildRegistryModelSelectGroups } from "@/lib/modelSelectionGroups.js";
import { decodeCustomModelValue } from "@/lib/raspberrycodeCustomModelValue.js";
import { logger } from "@/logger.js";
import type { RaspberryCodeProvider } from "@raspberrycode/shared";
import type { ModelSelectGroupItem } from "@/ModelConfigSelect.js";

/** 模型切换主干使用的连接单元：一组同供应商可选模型，无套餐/账号语义。 */
export interface ComposerConnection {
  key: string;
  label: string;
  providerId: string;
  items: readonly ModelSelectGroupItem[];
  disabled?: boolean;
}

export function chooseConnectionModel(items: readonly ModelSelectGroupItem[], model?: string) {
  return items.find((item) => item.name === model) ?? items[0];
}

export function useComposerConnectionSwitch({
  workspacePath,
  workspaceIdentity,
  agentProvider,
  normalizedValue,
  onSelectModel,
  waitForPresentation = false,
  presentationStatus = "ready",
  presentationRevision,
  presentationErrorRevision,
  refreshPresentation,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  agentProvider: RaspberryCodeProvider;
  normalizedValue: string;
  onSelectModel: (value: string, reasoningLevel?: string) => void;
  waitForPresentation?: boolean;
  presentationStatus?: "ready" | "loading" | "error" | "unavailable";
  presentationRevision?: number;
  presentationErrorRevision?: number;
  refreshPresentation?: () => Promise<unknown>;
}) {
  const base = useBaseWorkspaceServices();
  const { services: target, rpcReady } = useWorkspaceServicesResolution(
    workspacePath,
    undefined,
    workspaceIdentity,
  );
  const { intl } = useRaspberryCodeIntl();
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const token = useMemo(() => ({}), [target, base, workspaceKey]);
  const owner = useRef({ token, mounted: true });
  owner.current = { token, mounted: true };
  const inFlight = useRef(false);
  const [state, setState] = useState<{
    pending: boolean;
    error: string | null;
    previousKey?: string;
    expectedValue?: string;
    expectedRevision?: number;
  }>({
    pending: false,
    error: null,
  });
  useEffect(() => {
    setState({ pending: false, error: null });
    inFlight.current = false;
    return () => {
      owner.current.mounted = false;
    };
  }, [target, base, workspaceKey]);
  useEffect(() => {
    if (!state.expectedValue) return;
    if (
      presentationStatus === "error" ||
      presentationStatus === "unavailable" ||
      // 原因：旧 ready 可保留目录，但目标刷新失败必须是本次切换的终态。
      (presentationErrorRevision !== undefined &&
        state.expectedRevision !== undefined &&
        presentationErrorRevision >= state.expectedRevision)
    ) {
      inFlight.current = false;
      setState({
        pending: false,
        error: intl.formatMessage({ id: "chat.toolbar.connection.switchFailed" }),
      });
    } else if (presentationStatus === "ready") {
      // 原因：选择 owner 在重读时保留旧 ready；只有目标目录版本到达才是本次展示回执。
      if (
        presentationRevision !== undefined &&
        state.expectedRevision !== undefined &&
        presentationRevision < state.expectedRevision
      )
        return;
      // 原因：RPC 完成早于 Renderer 的选择重解析；提前结束 loading 会暴露新旧目录混合帧。
      inFlight.current = false;
      // 原因：有效选择可能被过滤或被另一草稿改写；ready 不匹配也必须结束等待，不能永久锁住工具条。
      const matched = normalizedValue === state.expectedValue;
      if (!matched)
        logger.lifecycle.warn("[composer-connection] 展示选择与目标不匹配", {
          expectedValue: state.expectedValue,
          normalizedValue,
        });
      setState({
        pending: false,
        error: matched ? null : intl.formatMessage({ id: "chat.toolbar.connection.switchFailed" }),
      });
    }
  }, [
    state.expectedValue,
    state.expectedRevision,
    presentationStatus,
    presentationRevision,
    presentationErrorRevision,
    normalizedValue,
    intl,
  ]);
  const select = useCallback(
    async (connection: ComposerConnection, previousKey?: string) => {
      if (inFlight.current || !rpcReady || connection.disabled) return;
      const currentOwner = owner.current;
      const stillCurrent = () =>
        owner.current.mounted && owner.current.token === currentOwner.token;
      inFlight.current = true;
      setState({ pending: true, error: null, previousKey });
      let awaitingPresentation = false;
      try {
        // 配置写入由根 Host 管理；执行候选始终从目标 Host 读取，不向远端伪造本地目录。
        const view = await target.modelSelectionService.getView();
        if (!stillCurrent()) return;
        const group = buildRegistryModelSelectGroups(agentProvider, view).find(
          (g) => g.key === `registry-provider:${connection.providerId}`,
        );
        const model = chooseConnectionModel(
          group?.items ?? [],
          decodeCustomModelValue(normalizedValue)?.modelName,
        );
        if (!model) throw new Error("Selected connection has no available models");
        logger.debug("[composer-connection] 连接同步完成", {
          providerId: connection.providerId,
          connectionKey: connection.key,
          workspaceKey,
        });
        // 直接使用目标 Host 目录，将模型与档位一次交给草稿 owner。
        const selection = completeNewModelSelection(view, {
          providerId: connection.providerId,
          modelId: model.name,
        });
        const reasoningLevel = selection?.options?.reasoningLevel;
        if (reasoningLevel) onSelectModel(model.value, reasoningLevel);
        else onSelectModel(model.value);
        if (waitForPresentation) {
          // 原因：重选同连接可能没有目录事件；每次显式读取当前展示 owner，不消费旧失败回执。
          await refreshPresentation?.();
          if (!stillCurrent()) return;
          awaitingPresentation = true;
          setState({
            pending: true,
            error: null,
            previousKey,
            expectedValue: model.value,
            expectedRevision: view.revision,
          });
        }
      } catch (error) {
        // 连接切换失败属于低频生命周期诊断，生产回放也需要保留明确失败原因。
        logger.lifecycle.warn("[composer-connection] 切换连接失败", {
          providerId: connection.providerId,
          workspaceKey,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          causes:
            error instanceof AggregateError
              ? error.errors.map((cause) => String(cause))
              : undefined,
        });
        if (stillCurrent())
          setState({
            pending: false,
            error: intl.formatMessage({ id: "chat.toolbar.connection.switchFailed" }),
          });
      } finally {
        if (stillCurrent() && !awaitingPresentation) {
          inFlight.current = false;
          setState((previous) => ({ ...previous, pending: false }));
        }
      }
    },
    [
      agentProvider,
      intl,
      normalizedValue,
      onSelectModel,
      rpcReady,
      target,
      workspaceKey,
      waitForPresentation,
      refreshPresentation,
    ],
  );
  return { ...state, select };
}
