import type { ModelSelectionView } from "@zcode/provider";

// 闲时/加速卡下线后 OFF_PEAK_PROVIDER_IDS 已移除；夹具改用合成账号 provider id，
// 保留「两个域同时存在，工具只能选择当前账号域」的语义。
const FAMILY_TEST_PROVIDER_IDS: Record<"bigmodel" | "zai", string> = {
  bigmodel: "account:bigmodel-test-plan",
  zai: "account:zai-test-plan",
};

/** 两个域同时存在，用于锁定工具只能选择当前账号域，不能按 Provider 顺序猜。 */
export function offPeakSelectionView(
  values: readonly string[] = ["disabled", "high", "max"],
): ModelSelectionView {
  return {
    revision: 1,
    providers: (["bigmodel", "zai"] as const).map((family) => ({
      providerId: FAMILY_TEST_PROVIDER_IDS[family],
      config: { visibility: "hidden" },
      models: [family === "zai" ? "ZAI-only" : "BigModel-only", "GLM-5.2"].map((modelId) => ({
        modelId,
        config: {
          enabled: true,

          properties: {
            requiresMfjsToolSchema: false,
            contextWindow: 200000,
            inputFormat: {
              supportsText: true,
              supportsImage: false,
              supportsVideo: false,
              supportsAudio: false,
              supportsPdf: false,
            },
            outputFormat: { supportsText: true },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
          },
          optionSpecs: {
            reasoningLevel: { values, map: "{}" },
            maxOutputTokens: { max: 32000, map: "{}" },
          },
        },
      })),
    })),
  };
}
