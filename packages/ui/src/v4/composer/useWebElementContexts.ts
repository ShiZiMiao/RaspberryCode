import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WEB_ELEMENT_CONTEXT_ADD_TO_CHAT_EVENT,
  WEB_ELEMENT_CONTEXT_REMOVE_FROM_CHAT_EVENT,
  createWebElementContextId,
  getWebElementContextWorkspaceKey,
  isWebElementContextAddToChatEvent,
  isWebElementContextPayload,
  isWebElementContextRemoveFromChatEvent,
  type WebElementContextComposerAttachment,
} from "@/lib/webElementContext.js";
import { isComposerEditScopeId } from "@/composer-edit-mode/contract.js";

// 按 composer 草稿 scope 缓存未发送的网页元素上下文；切任务或进入/退出编辑态后切回原样恢复。
const scopedWebElementContexts = new Map<
  string,
  readonly WebElementContextComposerAttachment[]
>();

function webElementScopeKey(workspaceKey: string, scopeId: string | null) {
  return `${workspaceKey}\0${scopeId ?? ""}`;
}

/** 进入编辑态前为 edit scope 预置待编辑消息的网页元素上下文。 */
export function seedWebElementContextsForScope(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  scopeId: string,
  contexts: readonly WebElementContextComposerAttachment[],
) {
  const key = webElementScopeKey(
    getWebElementContextWorkspaceKey(workspacePath, workspaceIdentity),
    scopeId,
  );
  if (contexts.length > 0) scopedWebElementContexts.set(key, [...contexts]);
  else scopedWebElementContexts.delete(key);
}

interface WebElementContextRemovePayload {
  id: string;
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface UseWebElementContextsOptions {
  workspacePath: string;
  workspaceIdentity?: string;
  listenAddToChatEvents?: boolean;
  scopeId?: string | null;
}

export interface UseWebElementContextsResult {
  contexts: readonly WebElementContextComposerAttachment[];
  hasContexts: boolean;
  removeContext: (id: string) => void;
  clearContexts: () => void;
}

function isRemovePayload(payload: unknown): payload is WebElementContextRemovePayload {
  const candidate = payload as WebElementContextRemovePayload;
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.workspacePath === "string" &&
    candidate.workspacePath.length > 0 &&
    (candidate.workspaceIdentity === undefined || typeof candidate.workspaceIdentity === "string")
  );
}

function toComposerAttachment(
  payload: Parameters<typeof isWebElementContextPayload>[0],
): Omit<WebElementContextComposerAttachment, "ordinal"> | null {
  if (!isWebElementContextPayload(payload)) {
    return null;
  }
  return {
    ...payload,
    id: payload.id ?? createWebElementContextId(),
  };
}

export function useWebElementContexts({
  workspacePath,
  workspaceIdentity,
  listenAddToChatEvents = true,
  scopeId = null,
}: UseWebElementContextsOptions): UseWebElementContextsResult {
  const [contexts, setContexts] = useState<readonly WebElementContextComposerAttachment[]>([]);
  const workspaceKey = getWebElementContextWorkspaceKey(workspacePath, workspaceIdentity);
  const scopeKey = webElementScopeKey(workspaceKey, scopeId);
  const contextsRef = useRef(contexts);
  contextsRef.current = contexts;
  const scopeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const previousKey = scopeKeyRef.current;
    if (previousKey === scopeKey) return;
    if (previousKey !== null) {
      // composer 编辑态的 edit scope 用完即弃，不缓存。
      if (contextsRef.current.length > 0 && !isComposerEditScopeId(previousKey))
        scopedWebElementContexts.set(previousKey, contextsRef.current);
      else scopedWebElementContexts.delete(previousKey);
    }
    scopeKeyRef.current = scopeKey;
    const restored = scopedWebElementContexts.get(scopeKey) ?? [];
    scopedWebElementContexts.delete(scopeKey);
    setContexts(restored);
  }, [scopeKey]);

  useEffect(
    () => () => {
      // composer 卸载（关闭分屏等）时保留当前 scope 的未发送上下文。
      const key = scopeKeyRef.current;
      if (key !== null && contextsRef.current.length > 0 && !isComposerEditScopeId(key))
        scopedWebElementContexts.set(key, contextsRef.current);
    },
    [],
  );

  const removeContext = useCallback((id: string) => {
    setContexts((items) => items.filter((item) => item.id !== id));
  }, []);

  const clearContexts = useCallback(() => {
    setContexts([]);
  }, []);

  useEffect(() => {
    if (!listenAddToChatEvents || typeof window === "undefined") {
      return;
    }

    const handleAdd = (event: Event) => {
      if (!isWebElementContextAddToChatEvent(event)) {
        return;
      }
      const attachment = toComposerAttachment(event.detail);
      if (!attachment) {
        return;
      }
      const eventWorkspaceKey = getWebElementContextWorkspaceKey(
        attachment.workspacePath,
        attachment.workspaceIdentity,
      );
      if (eventWorkspaceKey !== workspaceKey) {
        return;
      }
      event.preventDefault();
      setContexts((items) => {
        const existing = items.find((item) => item.id === attachment.id);
        if (existing) {
          return items.map((item) =>
            item.id === attachment.id ? { ...attachment, ordinal: existing.ordinal } : item,
          );
        }
        const ordinal = items.reduce((max, item) => Math.max(max, item.ordinal), 0) + 1;
        return [...items, { ...attachment, ordinal }];
      });
    };

    const handleRemove = (event: Event) => {
      if (!isWebElementContextRemoveFromChatEvent(event)) {
        return;
      }
      if (!isRemovePayload(event.detail)) {
        return;
      }
      const eventWorkspaceKey = getWebElementContextWorkspaceKey(
        event.detail.workspacePath,
        event.detail.workspaceIdentity,
      );
      if (eventWorkspaceKey !== workspaceKey) {
        return;
      }
      event.preventDefault();
      removeContext(event.detail.id);
    };

    window.addEventListener(WEB_ELEMENT_CONTEXT_ADD_TO_CHAT_EVENT, handleAdd);
    window.addEventListener(WEB_ELEMENT_CONTEXT_REMOVE_FROM_CHAT_EVENT, handleRemove);
    return () => {
      window.removeEventListener(WEB_ELEMENT_CONTEXT_ADD_TO_CHAT_EVENT, handleAdd);
      window.removeEventListener(WEB_ELEMENT_CONTEXT_REMOVE_FROM_CHAT_EVENT, handleRemove);
    };
  }, [listenAddToChatEvents, removeContext, workspaceKey]);

  return useMemo(
    () => ({
      contexts,
      hasContexts: contexts.length > 0,
      removeContext,
      clearContexts,
    }),
    [clearContexts, contexts, removeContext],
  );
}
