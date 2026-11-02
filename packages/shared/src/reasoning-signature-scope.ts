import { BUILTIN_MODEL_PROVIDER_IDS } from "./model-provider-types.js";

/**
 * Thinking 签名兼容域（reasoning signature scope）。
 *
 * thinking block 的 signature / redactedData 与服务端密钥绑定：签名 reasoning 只能
 * 回放到同一签名体系的服务，跨服务回放会被 provider 以 400（thinking signature 校验失败）
 * 拒绝。同一服务对外暴露多个 provider 身份（如个人/团队套餐、历史 builtin 身份）时，
 * 这些身份共享同一套签名密钥，属于同一个「签名兼容域」。
 *
 * 域成员是数据声明，不是能力特权：任何供应商（含自定义 provider）需要跨身份共享
 * 签名 reasoning 时，都应通过同样的域声明/注入机制表达，不得在模型执行路径里
 * 按品牌名单特判（见 specs/provider-neutrality.md）。
 */
export type ReasoningSignatureScope = readonly string[];

/**
 * 内置签名兼容域：同一服务多个 provider 身份的既知事实声明。
 * 与品牌无关的判定逻辑走 {@link areReasoningSignatureCompatible}；
 * 迁移期保留 legacy builtin 身份（旧历史数据仍带这些 ID）。
 */
export const BUILTIN_REASONING_SIGNATURE_SCOPES: readonly ReasoningSignatureScope[] = [
  // 同一 Coding Plan 服务的 legacy builtin 身份、个人与团队账号身份共享签名密钥。
  // Start Plan 等其他接入方式不共享该签名体系，因此不在域内。
  [
    "builtin:zai-coding-plan",
    BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
    BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan,
  ],
  [
    "builtin:bigmodel-coding-plan",
    BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
  ],
];

/**
 * 判断两个 provider 身份之间的签名 reasoning 是否可互相回放。
 * 同一身份恒兼容；其余按签名兼容域判定，调用方可注入额外域（自定义多身份场景）。
 */
export function areReasoningSignatureCompatible(
  source: string,
  target: string,
  extraScopes: readonly ReasoningSignatureScope[] = [],
): boolean {
  if (source === target) return true;
  const scopes = extraScopes.length > 0 ? [...BUILTIN_REASONING_SIGNATURE_SCOPES, ...extraScopes] : BUILTIN_REASONING_SIGNATURE_SCOPES;
  return scopes.some((scope) => scope.includes(source) && scope.includes(target));
}
