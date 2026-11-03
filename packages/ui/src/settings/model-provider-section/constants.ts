import {
  createUuid,
  type BuiltinModelProviderId,
  type OAuthProviderId,
} from "@raspberrycode/shared";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";

export function generateId(): string {
  return createUuid();
}

export interface PresetProviderSpec {
  id: BuiltinModelProviderId;
  displayName: string;
  oauthProviderId?: OAuthProviderId;
}

// 订阅/套餐预置已随 Coding Plan 体系移除（specs/no-login-startup.md 后续裁剪）：
// 预置套餐不再进入模型接入导航，模型接入只剩 API Key 与自定义供应商。
// 类型与 BUILTIN ID 常量保留供会话迁移/命名兼容。
export const PRESET_PROVIDER_SPECS: PresetProviderSpec[] = [];

export const PRESET_PROVIDER_SPEC_BY_ID = new Map<BuiltinModelProviderId, PresetProviderSpec>(
  PRESET_PROVIDER_SPECS.map((item) => [item.id, item]),
);

export function resolveModelProviderDisplayName(
  provider: Pick<ProviderSettingsFormProvider, "providerId" | "config">,
): string {
  return getProviderFormLabel(provider);
}

export type ModelProviderNavItem =
  | {
      key: string;
      type: "preset";
      /** 品牌入口图标独立于其历史 Start 导航身份。 */
      logo?: ProviderSettingsFormProvider["config"]["logo"];
      /** 账号组圆点只展示当前具体连接的公共执行结果。 */
      statusProvider?: ProviderSettingsFormProvider | null;
      presetId: BuiltinModelProviderId;
      label: string;
      provider: ProviderSettingsFormProvider | null;
      displayName: string;
      statusActive: boolean;
    }
  | {
      key: string;
      type: "custom";
      label: string;
      provider: ProviderSettingsFormProvider;
      statusActive: boolean;
    };

export type ModelProviderNavGroupId = "preset" | "custom";

export interface ModelProviderNavGroup {
  id: ModelProviderNavGroupId;
  title: string;
  items: ModelProviderNavItem[];
}
