import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getE2EProviderEndpointEnv,
  shouldUseProductionE2EProviderEndpoint,
} from "#e2e/helpers/e2e-provider-endpoint";

// 普通用例是否切控制面属于请求安全实现（开源版为空）；这里只验证公共 helper 原样委托。
const requestSecurityEnv = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock("#e2e/helpers/request-security-edition/index", () => ({
  requestSecurityEndpointEnv: () => requestSecurityEnv.current,
}));

const liveTeam = "conversation-session-r3-live-bigmodel-team.test.ts";
const ordinary = "conversation-session-v4-sendnow.test.ts";

afterEach(() => {
  requestSecurityEnv.current = {};
});

describe("E2E provider endpoint ownership", () => {
  it("普通用例的控制面覆盖原样来自请求安全实现，不获得真实 Team 的 BigModel 接口覆盖", () => {
    expect(getE2EProviderEndpointEnv([ordinary], "deepseek", "replay")).toEqual({});
    expect(shouldUseProductionE2EProviderEndpoint([ordinary], "deepseek", "replay")).toBe(false);

    requestSecurityEnv.current = { RASPBERRYCODE_BASE_URL: "https://config.example.com" };
    expect(getE2EProviderEndpointEnv([ordinary], "example-preset", "capture")).toEqual({
      RASPBERRYCODE_BASE_URL: "https://config.example.com",
    });
    expect(shouldUseProductionE2EProviderEndpoint([ordinary], "example-preset", "capture")).toBe(
      true,
    );
  });
  it.each([
    liveTeam,
    `/repo/packages/desktop/test/e2e/conversation-session/manual-review/pending/${liveTeam}`,
    `file:///repo/packages/desktop/test/e2e/conversation-session/manual-review/pending/${liveTeam}`,
    `C:\\repo\\packages\\desktop\\test\\e2e\\${liveTeam}`,
  ])("生产账号材料的独立 live-team 使用生产控制面：%s", (spec) => {
    expect(shouldUseProductionE2EProviderEndpoint([spec], "deepseek", "replay")).toBe(true);
  });

  it.each([{ specs: [] }, { specs: ["conversation-session-r3-live-zapi.test.ts"] }])(
    "普通或 ZAPI 用例不获得生产账号控制面例外：$specs",
    ({ specs }) => {
      expect(shouldUseProductionE2EProviderEndpoint(specs, "deepseek", "replay")).toBe(false);
    },
  );

  it.each([
    [liveTeam, ordinary],
    [ordinary, liveTeam],
  ])("拒绝 live-team 与其他 spec 混跑：%j", (...specs) => {
    expect(() => shouldUseProductionE2EProviderEndpoint(specs, "deepseek", "replay")).toThrow(
      "live-team 必须独立运行",
    );
  });
});
