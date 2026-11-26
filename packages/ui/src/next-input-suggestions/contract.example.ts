/**
 * next-input-suggestions 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 */
import {
  resolveNextInputSuggestionCandidates,
  shouldRequestNextInputPrediction,
} from "./contract.js";

/**
 * 契约用法示例：一次 `show` 结果收敛成建议条文本，并确认门禁通过。
 * 仅作类型示范（contract.example.ts 参与类型检查，不进入运行时）。
 */
export function exampleResolveNextInputSuggestions(): readonly string[] {
  const canRequest = shouldRequestNextInputPrediction({
    enabled: true,
    focused: true,
    rpcReady: true,
    sessionId: "sess_example",
    turnKey: "turn-1",
    turnCompleted: true,
  });
  if (!canRequest) return [];
  return resolveNextInputSuggestionCandidates({
    decision: "show",
    candidates: [
      { text: "继续执行", confidence: 0.92 },
      { text: "先跑一遍测试", confidence: 0.81 },
    ],
  });
}
