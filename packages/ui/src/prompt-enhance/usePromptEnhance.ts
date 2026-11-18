/**
 * 草稿优化的请求编排（spec：docs/prompt-enhance.md）。
 *
 * 职责边界：
 * - 本 hook 只负责「发起一次改写请求 → 得到清洗后的文本」以及进行中/取消的状态。
 * - 草稿的读与写都不在这里：原文由调用方在点击那一刻读出来传入，
 *   结果由调用方决定是否写回。这样 composer 依然是草稿的唯一所有者，
 *   本 hook 不会偷偷 `setText` 造成第二条写入路径。
 *
 * 并发规则：一次只允许一个请求。`requestId` 单调递增，回写前用它识别
 * 「结果是不是这次请求的」，防止慢请求返回后覆盖用户已经继续编辑的内容。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";
import {
  PROMPT_ENHANCE_QUERY_SOURCE,
  buildPromptEnhanceMessages,
  classifyEnhancedPrompt,
  isResultInScope,
  normalizeEnhancedPrompt,
  type EnhancedPromptVerdict,
} from "./contract.js";

/** 一次改写请求的失败原因；UI 据此选不同文案。 */
export type PromptEnhanceFailureReason =
  /** 当前没有可用模型（provider/model 缺失）。 */
  | "model-unavailable"
  /** 模型请求本身失败（网络、鉴权、供应商报错）。 */
  | "request-failed"
  /** 模型返回了空内容。 */
  | "empty-result"
  /** 模型返回内容与原文相同。 */
  | "unchanged"
  /** 请求进行中用户继续编辑了草稿，结果不再写回。 */
  | "draft-changed"
  /** 调用方主动取消。 */
  | "cancelled";

export type PromptEnhanceOutcome =
  | { status: "applied"; text: string; verdict: "apply" | "minor" }
  | { status: "failed"; reason: Exclude<PromptEnhanceFailureReason, "cancelled">; detail?: string }
  | { status: "cancelled" };

export interface UsePromptEnhanceOptions {
  workspacePath: string;
  workspaceIdentity?: string;
  /**
   * 草稿作用域标识（composer 的 `draftScopeId`：会话 id，或草稿作用域 key）。
   *
   * 必须传：composer 跨会话**复用**同一个组件实例（`key="conversation-composer"` 固定），
   * 会话切换只改 props 不重挂载。没有这个守卫的话，用户在会话 A 发起优化、
   * 立刻切到会话 B，回来的结果会被写进 B 的草稿——那是别人的草稿。
   * 作用域一变就放弃在途请求，与「取消」同一条路径。
   */
  draftScopeId: string;
  /**
   * 当前 composer 选中的模型。缺 provider/model 即视为不可用。
   * `reasoningLevel` 必须能给出：CLI 的 `modelFactory` 在创建 Model 时就校验 selection，
   * 缺档位会被判为 `reasoning-level-missing` 直接拒绝（辅助档位绑定在 Model 创建之后，
   * 救不了这一步）。调用方应优先取 `modelSelection.options.reasoningLevel`，
   * 缺失时回退 composer 的 `thought`。
   */
  selection: { providerId: string; modelId: string; reasoningLevel?: string } | null;
  /** 读取当前草稿正文。点击那一刻才调用，避免 hook 自己持有草稿副本。 */
  readDraft: () => string;
}

export interface UsePromptEnhanceResult {
  /** 是否有一次请求正在进行。 */
  pending: boolean;
  /** 是否具备发起条件（有草稿 + 有模型）。空草稿的判定由调用方按文案需求处理。 */
  canEnhance: boolean;
  /**
   * 发起一次优化。返回结果由调用方决定如何落地（写回草稿 / 提示）。
   * 进行中再次调用等价于**取消**当前请求，不会并发第二个。
   */
  enhance: () => Promise<PromptEnhanceOutcome>;
  /** 取消进行中的请求；无进行中请求时为空操作。 */
  cancel: () => void;
}

const OUTCOME_CANCELLED: PromptEnhanceOutcome = { status: "cancelled" };

export function usePromptEnhance(options: UsePromptEnhanceOptions): UsePromptEnhanceResult {
  const { workspacePath, workspaceIdentity, draftScopeId, selection, readDraft } = options;
  const { raspberrycodeAgentService } = useServices();
  const [pending, setPending] = useState(false);
  const requestIdRef = useRef(0);
  /** 最新一次请求的 id；只有它有权改状态。null = 当前没有进行中的请求。 */
  const activeRequestIdRef = useRef<number | null>(null);
  // 卸载后不再 setState，避免 React 警告。
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 组件卸载后结果无处可去，清掉 active id 让迟到的响应被丢弃。
      activeRequestIdRef.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    if (activeRequestIdRef.current === null) return;
    // 请求本身无法中断（见 enhance 内注释），这里只放弃它的结果。
    activeRequestIdRef.current = null;
    scopeAtRequestRef.current = null;
    if (mountedRef.current) setPending(false);
  }, []);

  // 会话/草稿作用域切换：在途请求的结果属于上一个草稿，必须放弃。
  // composer 跨会话复用实例（key 固定），不做这一步会把 A 的结果写进 B 的草稿。
  // 做法是在请求里记下发起时的作用域，回来时比对——比在 effect 里清 ref 更直接，
  // 也不会被 StrictMode 的双调用影响。
  const scopeAtRequestRef = useRef<string | null>(null);

  const enhance = useCallback(async (): Promise<PromptEnhanceOutcome> => {
    // 进行中再次点击 = 取消，不是并发第二个请求（spec 产品规则 5）。
    if (activeRequestIdRef.current !== null) {
      cancel();
      return OUTCOME_CANCELLED;
    }

    const draft = readDraft();
    if (!draft.trim()) {
      return { status: "failed", reason: "empty-result" };
    }
    if (!selection?.providerId || !selection.modelId) {
      return { status: "failed", reason: "model-unavailable" };
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    activeRequestIdRef.current = requestId;
    scopeAtRequestRef.current = draftScopeId;
    setPending(true);

    logger.info("[prompt-enhance] 发起优化请求", {
      workspacePath,
      providerId: selection.providerId,
      modelId: selection.modelId,
      draftLength: draft.length,
      requestId,
      draftScopeId,
    });

    try {
      // 关键约束：这里**不能**传 `signal`。
      // `generateWorkspaceText` 会跨窗口 Host 传输，序列化层对 AbortSignal 只能退化
      // （structuredClone 直接抛 DataCloneError，JSON 往返后变成 `{}`），
      // 服务端 `params.signal?.addEventListener` 会在非原生对象上抛 TypeError，
      // 请求根本发不出去。因此取消语义在本层实现：保留请求、丢弃结果，
      // 详见 cancel() 与下方 activeRequestIdRef 校验。
      const result = await raspberrycodeAgentService.generateWorkspaceText({
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        selection: {
          providerId: selection.providerId,
          modelId: selection.modelId,
          ...(selection.reasoningLevel
            ? { options: { reasoningLevel: selection.reasoningLevel } }
            : {}),
        },
        // 指令走 system、草稿走 user：角色边界是协议语义，不依赖模型遵守文本约定。
        messages: buildPromptEnhanceMessages(draft),
        querySource: PROMPT_ENHANCE_QUERY_SOURCE,
      });

      // 迟到的响应：已被取消（activeRequestIdRef 被清空）或被更新请求取代 → 一律丢弃。
      if (activeRequestIdRef.current !== requestId) {
        return OUTCOME_CANCELLED;
      }
      // 草稿作用域已切换：这份结果属于上一个会话的草稿，写回就是污染别人的输入框。
      // composer 实例跨会话复用，所以这个判断不能省。
      if (
        !isResultInScope({
          requestedScope: scopeAtRequestRef.current,
          currentScope: draftScopeId,
        })
      ) {
        logger.info("[prompt-enhance] 草稿作用域已切换，丢弃结果", {
          requestId,
          requestedIn: scopeAtRequestRef.current,
          currentScope: draftScopeId,
        });
        return OUTCOME_CANCELLED;
      }

      // 必须把原文传进去：清洗无法区分「模型加的包装」和「用户正文本身长这样」，
      // 没有原文做对照会把用户自己写的引号/围栏/前缀剥掉（已实测会静默改坏草稿）。
      const normalized = normalizeEnhancedPrompt(result.text, draft);
      const verdict: EnhancedPromptVerdict = classifyEnhancedPrompt(draft, normalized);
      if (verdict === "empty") {
        logger.warn("[prompt-enhance] 模型返回空内容", { requestId });
        return { status: "failed", reason: "empty-result" };
      }
      if (verdict === "unchanged") {
        logger.info("[prompt-enhance] 模型返回与原文相同", { requestId });
        return { status: "failed", reason: "unchanged" };
      }

      logger.info("[prompt-enhance] 优化成功", {
        requestId,
        originalLength: draft.length,
        enhancedLength: normalized.length,
        // minor = 只动了标点/空白，仍然写回但 UI 用不同文案，避免夸大效果。
        verdict,
      });
      return { status: "applied", text: normalized, verdict };
    } catch (error) {
      // 取消是「丢弃结果」，请求本身仍会跑完；此处错误只按真实失败上报。
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn("[prompt-enhance] 优化请求失败", { requestId, error: detail });
      return { status: "failed", reason: "request-failed", detail };
    } finally {
      // 只有仍是这条请求时才清状态：被取消或更晚的请求接管后不能把它标成结束。
      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current = null;
        scopeAtRequestRef.current = null;
        if (mountedRef.current) setPending(false);
      }
    }
  }, [
    cancel,
    draftScopeId,
    raspberrycodeAgentService,
    readDraft,
    selection?.modelId,
    selection?.providerId,
    selection?.reasoningLevel,
    workspaceIdentity,
    workspacePath,
  ]);

  const canEnhance = Boolean(selection?.providerId && selection.modelId);
  return { pending, canEnhance, enhance, cancel };
}
