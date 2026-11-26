/**
 * next-input-suggestions 对外契约（spec：specs/next-input-suggestions.md）。
 *
 * 这里只放**纯函数与常量**：请求门禁、候选收敛、宿主注入的配置形状。
 * 请求编排在 `useNextInputSuggestions`，UI 在 `ConversationNextInputSuggestions`。
 *
 * 为什么门禁要单独成契约：预测每次都会调用一次模型，任何一条门禁漏掉都会在
 * 运行中、草稿会话或非聚焦 pane 上产生无意义成本。门禁必须可读、可复用，
 * 不能散落在 effect 的 if 里。
 */
import type { V4ConversationInputPredictionResult } from "@raspberrycode/shared/raspberrycode-protocol-v4";

/** 轮次完成到发起预测的延迟：用户连续发送时直接取消，避免浪费模型调用。 */
export const NEXT_INPUT_PREDICTION_DELAY_MS = 800;

/** 与线格式上限一致：最多同时展示 3 条。 */
export const NEXT_INPUT_PREDICTION_MAX_CANDIDATES = 3;

/**
 * 宿主注入给时间线 / 轮组的配置。
 * 回调由 SessionPane 提供并保持引用稳定，避免整条时间线随每次渲染重挂。
 */
export interface NextInputPredictionConfig {
  enabled: boolean;
  focused: boolean;
  revision: number;
  onSend: (text: string) => void;
  onInsertToComposer: (text: string) => void;
}

/** 是否允许发起一次预测。所有条件必须同时成立。 */
export function shouldRequestNextInputPrediction(params: {
  enabled: boolean;
  focused: boolean;
  rpcReady: boolean;
  sessionId: string | null;
  turnKey: string | null;
  turnCompleted: boolean;
}): boolean {
  return (
    params.enabled &&
    params.focused &&
    params.rpcReady &&
    params.sessionId !== null &&
    params.turnKey !== null &&
    params.turnCompleted
  );
}

/**
 * 把一次预测结果收敛成可展示的建议文本。
 *
 * - 只有 `decision === "show"` 才展示；其余决策一律 0 条（宁缺毋滥）。
 * - 候选文本在草稿为空时就是整条输入；trim 后为空则丢弃。
 * - 候选之间去重，按原顺序截断到 3 条。
 */
export function resolveNextInputSuggestionCandidates(
  result: Pick<V4ConversationInputPredictionResult, "decision" | "candidates">,
): readonly string[] {
  if (result.decision !== "show") return [];
  const seen = new Set<string>();
  const texts: string[] = [];
  for (const candidate of result.candidates) {
    const text = candidate.text.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    texts.push(text);
    if (texts.length >= NEXT_INPUT_PREDICTION_MAX_CANDIDATES) break;
  }
  return texts;
}
