import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseModelConfig, parseRaspberryCodeBuiltinModelConfigRules } from "@raspberrycode/provider";

describe("MCS published capability boundaries", () => {
  it("supports known Claude models across sites, without granting Sonnet or a different API", async () => {
    const release = JSON.parse(
      await readFile(
        new URL("../../../config/provider/raspberrycode-builtin.json", import.meta.url),
        "utf8",
      ),
    );
    const rules = parseRaspberryCodeBuiltinModelConfigRules(release.config.modelConfigRules);
    for (const baseUrl of ["https://api.anthropic.com/v1", "https://proxy.example/v1"]) {
      for (const modelId of [
        "claude-opus-4-8",
        "anthropic/claude-opus-4.8",
        "gateway/claude-opus-4-8:free",
        "claude-opus-5",
        "claude-fable-5",
        "claude-fable-5-1",
        "claude-mythos-5-1",
        "claude-sonnet-5",
        "claude-sonnet-4-6",
        "claude-unknown",
      ]) {
        const config = rules.resolve({
          providerId: "fixture",
          modelId,
          baseUrl,
          apiType: "anthropic-messages",
        });
        const expected = !modelId.includes("sonnet") && !modelId.includes("unknown");
        expect(config.properties?.supportsMidConversationSystem, `${baseUrl}/${modelId}`).toBe(
          expected,
        );
        expect(
          config.overlay(parseModelConfig({ properties: { supportsMidConversationSystem: false } }))
            .properties?.supportsMidConversationSystem,
        ).toBe(false);
        expect(
          rules.resolve({
            providerId: "fixture",
            modelId,
            baseUrl,
            apiType: "openai-chat-completions",
          }).properties?.supportsMidConversationSystem,
        ).toBe(false);
      }
    }
    for (const provider of release.config.providerConfigRules.providerRules) {
      const { api } = provider.config;
      const config = rules.resolve({
        providerId: provider.providerId,
        modelId: "GLM-5.3-Flash",
        apiType: api.type,
        baseUrl: api.baseUrl,
      });
      expect(config.properties?.supportsMidConversationSystem, provider.providerId).toBe(true);
      // 闲时保留 MCS，但按 Todo140 关闭内置搜索；普通套餐不能随之回退。
      expect(config.properties?.supportsNativeWebSearch, provider.providerId).toBe(
        provider.config.access.mode !== "off-peak",
      );
    }
    // 官方 plan/off-peak 网关已随账号订阅链拆除（server 无对应路由），网关精确端点的
    // 授予用例随之退役；数据侧的死网关规则同步清理（BYOK 厂商授予与防仿冒断言保留在上方）。
  });
});
