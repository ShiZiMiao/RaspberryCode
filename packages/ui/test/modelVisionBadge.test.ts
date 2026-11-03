import { describe, expect, it } from "vitest";
import type { ProviderConfigObject } from "@raspberrycode/provider";
import { shouldShowModelVisionBadge } from "@/lib/modelVisionBadge.js";

type Access = NonNullable<ProviderConfigObject["access"]>;

const metered: Access = { type: "metered-api-key" };
const apiKey: Access = { type: "api-key" };

describe("shouldShowModelVisionBadge", () => {
  it("计量接入下桥接视觉模型不标原生视觉徽标（展示事实来自共享数据）", () => {
    expect(shouldShowModelVisionBadge("GLM-5.3", true, metered)).toBe(false);
    expect(shouldShowModelVisionBadge("glm-5.3", true, metered)).toBe(false);
  });

  it("计量接入下名单外模型不受影响", () => {
    expect(shouldShowModelVisionBadge("GLM-5.3-Flash", true, metered)).toBe(true);
    expect(shouldShowModelVisionBadge("other-model", true, metered)).toBe(true);
  });

  it("直连 API Key 不受桥接展示事实影响", () => {
    expect(shouldShowModelVisionBadge("glm-5.3", true, apiKey)).toBe(true);
    expect(shouldShowModelVisionBadge("glm-5.3", true, undefined)).toBe(true);
  });

  it("历史套餐 access 读兼容值同样适用桥接展示事实", () => {
    expect(shouldShowModelVisionBadge("glm-5.3", true, { type: "zhipu-coding-plan-api-key" })).toBe(
      false,
    );
    expect(
      shouldShowModelVisionBadge("glm-5.3", true, {
        type: "zhipu-account",
        mode: "individual-coding-plan",
      }),
    ).toBe(false);
  });

  it("不支持图片输入时恒不显示徽标", () => {
    expect(shouldShowModelVisionBadge("glm-5.3", false, metered)).toBe(false);
    expect(shouldShowModelVisionBadge("glm-5.3", undefined, apiKey)).toBe(false);
  });
});
