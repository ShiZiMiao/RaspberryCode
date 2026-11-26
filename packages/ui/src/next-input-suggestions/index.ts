/**
 * next-input-suggestions 公共入口（architecture-governance managed 模块）。
 * Agent 回复结束后的下一步输入预测；spec 见 specs/next-input-suggestions.md，
 * 契约见 contract.ts 与 CONTRACT.md。
 */
export {
  ConversationNextInputSuggestions,
  type ConversationNextInputSuggestionsProps,
} from "./ConversationNextInputSuggestions.js";
export { NextInputPredictionSetting } from "./NextInputPredictionSetting.js";
export {
  useNextInputSuggestions,
  type UseNextInputSuggestionsParams,
  type UseNextInputSuggestionsResult,
} from "./useNextInputSuggestions.js";
export {
  NEXT_INPUT_PREDICTION_DELAY_MS,
  NEXT_INPUT_PREDICTION_MAX_CANDIDATES,
  resolveNextInputSuggestionCandidates,
  shouldRequestNextInputPrediction,
  type NextInputPredictionConfig,
} from "./contract.js";
