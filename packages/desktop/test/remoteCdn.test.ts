import { describe, expect, it } from "vitest";
import { resolvePrimaryRemoteCdnBaseUrl, resolveRemoteCdnBaseUrls } from "../src/main/remoteCdn.js";

describe("remoteCdn", () => {
  it("测试产品环境应固定使用内网 SSH remote assets 根目录", () => {
    expect(
      resolveRemoteCdnBaseUrls({
        env: "test",
        version: "0.0.0-test",
      }),
    ).toEqual(["http://intranet.example.invalid:12345/ssh-remote-assets/0.0.0-test"]);
  });

  it("显式覆盖 CDN 基址时不再按产品环境选择默认值", () => {
    expect(
      resolveRemoteCdnBaseUrls({
        env: "test",
        overrideBaseUrl: "https://cdn.example.com/releases///",
        version: "0.0.0-test",
      }),
    ).toEqual(["https://cdn.example.com/releases"]);
  });

  it("生产态无构建注入且未配置时不得回退任何默认 CDN", () => {
    // 中立性回归（specs/provider-neutrality.md 规则 6）：品牌 CDN 默认值已移除，
    // 未配置下载根时返回空列表，由装配层报错而不是静默请求任何默认域名。
    expect(
      resolveRemoteCdnBaseUrls({
        env: "production",
        version: "0.0.0-test",
      }),
    ).toEqual([]);
    expect(
      resolvePrimaryRemoteCdnBaseUrl({
        env: "production",
        version: "0.0.0-test",
      }),
    ).toBeUndefined();
  });
});
