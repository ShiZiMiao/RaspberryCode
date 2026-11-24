import { afterEach, describe, expect, it } from "vitest";
import { resolvePrimaryRemoteCdnBaseUrl, resolveRemoteCdnBaseUrls } from "../src/main/remoteCdn.js";

/**
 * `__RASPBERRYCODE_REMOTE_CDN_RELEASE_ROOTS__` 是 tsup 在**编译期**注入的裸常量
 * （见 packages/desktop/tsup.config.ts 的 `define`）。单测不走 tsup，所以默认不存在。
 *
 * 漏洞成因（0.2.7 远程连接全挂）：这个文件此前**没有任何用例**覆盖「构建期已注入发布根」
 * 这条路径 —— 测试里常量恒为 undefined，函数恒返回空数组，于是
 * 「注入已带版本段的根 → 又被无条件拼一次版本」这个缺陷不可能被单测发现。
 *
 * Node ESM 下裸标识符未声明时会落到 globalThis，因此这里挂到 globalThis 上即可
 * 驱动真实分支，且不需要改动生产代码或 vitest 配置。
 */
const RELEASE_ROOTS_KEY = "__RASPBERRYCODE_REMOTE_CDN_RELEASE_ROOTS__";

function injectReleaseRoots(roots: readonly string[] | undefined): void {
  if (roots === undefined) {
    delete (globalThis as Record<string, unknown>)[RELEASE_ROOTS_KEY];
    return;
  }
  (globalThis as Record<string, unknown>)[RELEASE_ROOTS_KEY] = roots;
}

afterEach(() => {
  injectReleaseRoots(undefined);
});

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

/**
 * 回归组：「构建期注入的发布根」这条真实生产路径。
 *
 * 事故背景（2026-11-24 用户反馈）：SSH 连接远端时报
 * 「Unable to resolve Source Server release descriptor
 *  (HTTP release roots unreachable: ['redacted-url'], ['redacted-url'])」，
 * 同时远端 Source Server 0.2.5 需要升级到 ≥0.2.7 却下不到安装包。
 *
 * 根因：tsup 为 GitHub Release 形态注入的是**已带 tag 的完整根**
 * `https://github.com/<owner>/<repo>/releases/download/v0.2.7`，
 * 而 resolveRemoteCdnBaseUrls 又无条件追加一次 `/0.2.7`，
 * 拼出 `.../download/v0.2.7/0.2.7/source-server-release.json` —— 实测 404。
 * 对比正确路径 `.../download/v0.2.7/source-server-release.json` 返回 200。
 */
describe("remoteCdn 构建期注入的发布根", () => {
  const GITHUB_ROOT = "https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.7";

  it("已带版本段的 GitHub tag 根不得再追加一次版本（0.2.7 事故回归）", () => {
    injectReleaseRoots([GITHUB_ROOT]);
    const bases = resolveRemoteCdnBaseUrls({ env: "production", version: "0.2.7" });
    expect(bases).toEqual([GITHUB_ROOT]);
    // 明确断言不会出现双版本路径（这是当初的真实故障形态）。
    expect(bases.some((base) => base.endsWith("/v0.2.7/0.2.7"))).toBe(false);
  });

  it("已带纯版本号的根不得再追加一次版本", () => {
    injectReleaseRoots(["https://cdn.example.com/raspberrycode/electron/releases/0.2.7"]);
    expect(resolveRemoteCdnBaseUrls({ env: "production", version: "0.2.7" })).toEqual([
      "https://cdn.example.com/raspberrycode/electron/releases/0.2.7",
    ]);
  });

  it("不带版本段的根仍应追加版本（自建 CDN 用 OSS_PATH_PREFIX 注入的形态）", () => {
    injectReleaseRoots(["https://cdn.example.com/raspberrycode/electron/releases"]);
    expect(resolveRemoteCdnBaseUrls({ env: "production", version: "0.2.7" })).toEqual([
      "https://cdn.example.com/raspberrycode/electron/releases/0.2.7",
    ]);
  });

  it("尾部斜杠不应影响版本段判定", () => {
    injectReleaseRoots([`${GITHUB_ROOT}///`]);
    expect(resolveRemoteCdnBaseUrls({ env: "production", version: "0.2.7" })).toEqual([GITHUB_ROOT]);
  });

  it("多根按注入顺序保留，逐个独立判定版本段", () => {
    injectReleaseRoots([
      GITHUB_ROOT,
      "https://cdn.example.com/raspberrycode/electron/releases",
    ]);
    expect(resolveRemoteCdnBaseUrls({ env: "production", version: "0.2.7" })).toEqual([
      GITHUB_ROOT,
      "https://cdn.example.com/raspberrycode/electron/releases/0.2.7",
    ]);
  });

  it("不同版本号时不误判（根里的版本必须与当前版本一致）", () => {
    // 根固定 v0.2.7、当前版本 0.2.8：不属于「已带版本段」，保留追加行为，
    // 后续由 assertRemoteCdnBaseVersionMatches 报版本不匹配，而不是静默用错版本。
    injectReleaseRoots([GITHUB_ROOT]);
    expect(resolveRemoteCdnBaseUrls({ env: "production", version: "0.2.8" })).toEqual([
      `${GITHUB_ROOT}/0.2.8`,
    ]);
  });
});
