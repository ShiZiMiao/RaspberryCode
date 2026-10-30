import { BUILTIN_MODEL_PROVIDER_IDS, isBuiltinModelProviderId } from "@zcode/shared";
import type { IntlInstance } from "@/i18n/IntlProvider.js";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";

export interface V4ModelTriggerDisplay {
  fullLabel: string;
  modelLabel: string;
  providerPrefix?: string;
}

export function formatModelChangeLabel(
  providerId: string | undefined,
  providerName: string | undefined,
  modelName: string,
  intl: Pick<IntlInstance, "formatMessage">,
): string {
  let planLabelId: string;
  // 切换记录必须保留当时的套餐身份，不能从当前连接或可用模型目录反推历史套餐。
  switch (providerId) {
    case BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan:
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan:
      planLabelId = "settings.modelProvider.connectionMode.codingPlan";
      break;
    case BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan:
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan:
      planLabelId = "settings.modelProvider.connectionMode.startPlan";
      break;
    case BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan:
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan:
      planLabelId = "settings.modelProvider.connectionMode.teamPlan";
      break;
    default:
      return formatProviderModelLabel(providerId, providerName, modelName);
  }
  return `${modelName}(${intl.formatMessage({ id: planLabelId })})`;
}

export function formatProviderModelLabel(
  providerId: string | undefined,
  providerName: string | undefined,
  modelName: string,
): string {
  // 内置预置供应商只显示模型名（产品固定入口的名字不拼进触发器/时间线）。
  if (providerId && isBuiltinModelProviderId(providerId)) {
    return modelName;
  }
  const normalizedProviderName = providerName?.trim();
  return normalizedProviderName ? `${normalizedProviderName}/${modelName}` : modelName;
}

export function resolveV4ModelTriggerLabel({
  modelGroups,
  normalizedValue,
  fallbackLabel,
  providerId,
  providerName,
}: {
  modelGroups: readonly ModelSelectGroup[];
  normalizedValue: string;
  fallbackLabel: string;
  providerId: string | undefined;
  providerName?: string;
}): string {
  const selectedGroup = modelGroups.find((group) =>
    group.items.some((item) => item.value === normalizedValue),
  );
  const selectedItem = selectedGroup?.items.find((item) => item.value === normalizedValue);
  if (!selectedGroup || !selectedItem) {
    return fallbackLabel;
  }

  // 仅当前菜单中存在的连接按 ID 兜底；历史记录的通用格式化保留原有语义。
  return formatProviderModelLabel(
    providerId,
    providerName?.trim() || providerId,
    selectedItem.name,
  );
}

export function resolveV4ModelTriggerDisplay({
  modelGroups,
  normalizedValue,
  fallbackLabel,
  providerId,
  providerName,
}: {
  modelGroups: readonly ModelSelectGroup[];
  normalizedValue: string;
  fallbackLabel: string;
  providerId: string | undefined;
  providerName?: string;
}): V4ModelTriggerDisplay {
  // 把 provider/model 预先拼成单一字符串后，响应式布局只能整段隐藏或依赖
  // 平台 JS 分支裁剪；这里保留结构化前缀，让 composer 容器断点统一决定可见密度。
  const fullLabel = resolveV4ModelTriggerLabel({
    modelGroups,
    normalizedValue,
    fallbackLabel,
    providerId,
    providerName,
  });
  const selectedGroup = modelGroups.find((group) =>
    group.items.some((item) => item.value === normalizedValue),
  );
  const selectedItem = selectedGroup?.items.find((item) => item.value === normalizedValue);
  if (!selectedGroup || !selectedItem) {
    return { fullLabel, modelLabel: fallbackLabel };
  }

  const modelLabel = selectedItem.name;
  const normalizedProviderName = providerName?.trim() || providerId;
  // 内置预置供应商没有可隐藏的 provider 前缀（名字不拼进触发器）。
  if (!normalizedProviderName || (providerId && isBuiltinModelProviderId(providerId))) {
    return { fullLabel, modelLabel };
  }

  return {
    fullLabel,
    providerPrefix: `${normalizedProviderName}/`,
    modelLabel,
  };
}
