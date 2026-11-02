/**
 * 计量接入下图片输入为服务端桥接的模型展示事实。
 *
 * 通过计量/套餐接入（metered-api-key 及历史套餐 access）使用这些模型时，图片输入由
 * 服务端桥接处理，不具备模型原生视觉语义，UI 不得为其标注原生视觉徽标
 * （specs/provider-neutrality.md）。展示事实以数据声明维护：新增此类模型在此登记，
 * 不在 UI 逻辑分支里写 modelId。BYOK 直连（api-key）不受此声明影响。
 */
export const METERED_BRIDGED_VISION_MODEL_IDS: readonly string[] = ["glm-5.3"];

/** 该模型在计量接入下是否为服务端桥接视觉（仅影响徽标展示，不改能力事实与附件校验）。 */
export function isMeteredBridgedVisionModel(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return METERED_BRIDGED_VISION_MODEL_IDS.some((id) => id.toLowerCase() === normalized);
}
