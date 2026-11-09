import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DEFAULT_UPDATE_FEED_GITHUB,
  type AutoUpdatePreferences,
  type UpdateCheckResultPayload,
  type UpdateStatePayload,
} from "./contract.js";

describe("client-update-contract", () => {
  it("默认 GitHub 更新源固定为 ShiZiMiao/RaspberryCode（spec 产品规则 1）", () => {
    expect(DEFAULT_UPDATE_FEED_GITHUB).toEqual({ owner: "ShiZiMiao", repo: "RaspberryCode" });
  });

  it("状态快照与检查结果保持判别联合形状", () => {
    // 用索引访问类型断言联合全集；赋值后判别字段会被字面量窄化，不能直接断言。
    expectTypeOf<UpdateStatePayload["kind"]>().toEqualTypeOf<
      "idle" | "checking" | "update-available" | "download-progress" | "update-downloaded"
    >();
    expectTypeOf<UpdateCheckResultPayload["kind"]>().toEqualTypeOf<
      | "up-to-date"
      | "available"
      | "downloading"
      | "already-downloading"
      | "ready"
      | "dev-skipped"
      | "error"
    >();
    const state: UpdateStatePayload = { kind: "idle", enabled: true };
    expect(state.kind).toBe("idle");
  });

  it("偏好载荷包含自动下载、跳过版本与 GitHub 源字段", () => {
    const preferences: AutoUpdatePreferences = {
      autoDownloadAndInstallUpdates: false,
      skippedUpdateVersion: null,
      updateFeedGithubOwner: "",
      updateFeedGithubRepo: "",
    };
    expect(preferences.skippedUpdateVersion).toBeNull();
  });
});
