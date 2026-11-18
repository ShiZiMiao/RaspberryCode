/**
 * prompt-enhance 公共入口（architecture-governance managed 模块）。
 * 输入框草稿优化；spec 见 docs/prompt-enhance.md，契约见 contract.ts 与 CONTRACT.md。
 */
export { PromptEnhanceButton, type PromptEnhanceButtonProps } from "./PromptEnhanceButton.js";
export { usePromptEnhance } from "./usePromptEnhance.js";
export type {
  PromptEnhanceFailureReason,
  PromptEnhanceOutcome,
  UsePromptEnhanceOptions,
  UsePromptEnhanceResult,
} from "./usePromptEnhance.js";
export {
  PROMPT_ENHANCE_QUERY_SOURCE,
  buildPromptEnhanceMessages,
  canApplyEnhancedPrompt,
  classifyEnhancedPrompt,
  fingerprintDraft,
  isResultInScope,
  normalizeEnhancedPrompt,
  resolveDraftWriteMode,
  toPromptEnhanceSelection,
  type DraftWriteMode,
  type EnhancedPromptVerdict,
  type PromptEnhanceMessage,
} from "./contract.js";
