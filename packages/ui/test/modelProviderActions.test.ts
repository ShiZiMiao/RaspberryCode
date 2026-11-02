import { describe, expect, it, vi } from "vitest";
import type { IntlInstance } from "@/i18n/IntlProvider.js";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { confirmAndDeleteModelProvider } from "@/settings/model-provider-section/modelProviderActions.js";

const intlStub = {
  formatMessage: ({ id }: { id: string }) => id,
} as unknown as IntlInstance;

function providerWithGroup(group: string): ProviderSettingsFormProvider {
  return {
    providerId: "provider-1",
    providerName: "Provider One",
    config: { group },
  } as unknown as ProviderSettingsFormProvider;
}

describe("confirmAndDeleteModelProvider", () => {
  it.each(["zai-family", "bigmodel-family"] as const)(
    "品牌 group=%s 不得享有删除豁免",
    async (group) => {
      const deleteProvider = vi.fn(async () => {});
      const confirmDialog = vi.fn(async () => true);

      await confirmAndDeleteModelProvider({
        provider: providerWithGroup(group),
        confirmDialog,
        intl: intlStub,
        deleteProvider,
      });

      // specs/provider-neutrality.md：删除规则对全部供应商统一，不按品牌静默跳过。
      expect(confirmDialog).toHaveBeenCalledTimes(1);
      expect(deleteProvider).toHaveBeenCalledWith("provider-1");
    },
  );

  it("用户取消确认时仍不删除", async () => {
    const deleteProvider = vi.fn(async () => {});
    const confirmDialog = vi.fn(async () => false);

    await confirmAndDeleteModelProvider({
      provider: providerWithGroup("zai-family"),
      confirmDialog,
      intl: intlStub,
      deleteProvider,
    });

    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(deleteProvider).not.toHaveBeenCalled();
  });
});
