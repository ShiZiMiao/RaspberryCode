import type { ProviderConfigObject } from "@raspberrycode/provider";
import { isMeteredBridgedVisionModel } from "@raspberrycode/shared";

/**
 * 视觉能力徽标展示判定（specs/provider-neutrality.md）：计量/套餐接入下
 * 图片输入为服务端桥接的模型不标原生视觉徽标。桥接模型名单是共享展示事实数据
 * （`@raspberrycode/shared` 的 bridged-vision-models），本模块不按 modelId 硬编码。
 * 只控制徽标，不改能力事实、附件校验或精确模型身份。
 */
export function shouldShowModelVisionBadge(
  modelId: string,
  supportsImage: boolean | null | undefined,
  access?: ProviderConfigObject["access"],
): boolean {
  if (supportsImage !== true) return false;
  // 计量/套餐接入的图片输入由服务端桥接（含历史套餐 access 读兼容值）；直连 API Key 不受此影响。
  const meteredAccess =
    access?.type === "metered-api-key" ||
    access?.type === "zhipu-coding-plan-api-key" ||
    (access?.type === "zhipu-account" &&
      (access.mode === "individual-coding-plan" ||
        access.mode === "team-coding-plan" ||
        access.mode === "start-plan"));
  return !(meteredAccess && isMeteredBridgedVisionModel(modelId));
}
