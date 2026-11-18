/**
 * prompt-enhance 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 *
 * 关键点：草稿的读写都留在 composer —— 点击时读一次，结果由 composer 决定是否写回。
 * 本文件是 `.ts`（无 JSX），组件渲染见 `PromptEnhanceButton.tsx`。
 */
import { useCallback, useRef } from "react";
import { usePromptEnhance } from "./usePromptEnhance.js";
import { canApplyEnhancedPrompt } from "./contract.js";

export interface ComposerDraftBridge {
  readDraft: () => string;
  writeDraft: (text: string) => void;
  notify: (message: string) => void;
}

export function useComposerPromptEnhance(options: {
  workspacePath: string;
  /**
   * 当前草稿的作用域标识（会话 id 或草稿 key）。
   * composer 跨会话复用实例，切换时必须让在途请求作废，否则会写进别的草稿。
   */
  draftScopeId: string;
  /** composer 当前选中的模型；与工具条显示的是同一份事实。 */
  selection: { providerId: string; modelId: string } | null;
  draft: ComposerDraftBridge;
}) {
  const { workspacePath, draftScopeId, selection, draft } = options;
  // 点击那一刻的原文：撤销与「草稿已改动」判定都以它为准。
  const originalDraftRef = useRef<string | null>(null);

  const enhancer = usePromptEnhance({
    workspacePath,
    draftScopeId,
    selection,
    readDraft: () => {
      const text = draft.readDraft();
      originalDraftRef.current = text;
      return text;
    },
  });

  const run = useCallback(async () => {
    const outcome = await enhancer.enhance();
    if (outcome.status !== "applied") return outcome;
    const original = originalDraftRef.current;
    if (original === null) return outcome;
    // 用户已经继续编辑 → 放弃写回，不吞掉新输入。
    if (!canApplyEnhancedPrompt({ originalDraft: original, currentDraft: draft.readDraft() })) {
      draft.notify("draft changed; enhancement not applied");
      return outcome;
    }
    draft.writeDraft(outcome.text);
    return outcome;
  }, [draft, enhancer]);

  return {
    pending: enhancer.pending,
    /** 缺少草稿或模型时按钮应为禁用态。 */
    canEnhance: enhancer.canEnhance,
    run,
    /** 撤销：把草稿恢复成点击那一刻的原文。 */
    undo: () => {
      if (originalDraftRef.current !== null) draft.writeDraft(originalDraftRef.current);
    },
  };
}
