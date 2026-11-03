import type { ModelExecutionInput, ModelExecutionContext } from "./contract.js";

/** 两种输入协议共用执行材料投影；不把 Secret 放入可持久化的 intent。 */
export function createModelExecutionContext(input: ModelExecutionInput): ModelExecutionContext {
  return {
    ...(input.memoryExtraction ? { memoryExtraction: input.memoryExtraction } : {}),
    selectionScope: "execution",
    ...(input.subagents ? { subagents: input.subagents } : {}),
    ...(input.selectionFallback ? { selectionFallback: input.selectionFallback } : {}),
  };
}
