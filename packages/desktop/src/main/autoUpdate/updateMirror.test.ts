import { describe, expect, it } from "vitest";
import {
  buildDownloadAttemptKey,
  buildManualDownloadUrl,
  DEFAULT_UPDATE_MIRROR_PREFIX,
  GITHUB_DOWNLOAD_ORIGIN,
  isGithubReleaseDownloadUrl,
  resolveDownloadUrl,
  toMirrorUrl,
  UpdateDownloadFallback,
} from "./updateMirror.js";

const DOWNLOAD_URL =
  "https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.1.0/RaspberryCode-0.1.0-win-x64.exe";

describe("isGithubReleaseDownloadUrl", () => {
  it("识别 release 资产下载", () => {
    expect(isGithubReleaseDownloadUrl(DOWNLOAD_URL)).toBe(true);
    expect(
      isGithubReleaseDownloadUrl(
        "https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.1.0/RaspberryCode-0.1.0-win-x64.exe.blockmap",
      ),
    ).toBe(true);
  });

  it("放行非下载请求（API / 元数据 / 其他站点）", () => {
    // 检查更新走 API，镜像对其无透明转发能力，必须放行
    expect(isGithubReleaseDownloadUrl("https://api.github.com/repos/o/r/releases")).toBe(false);
    expect(isGithubReleaseDownloadUrl("https://github.com/o/r")).toBe(false);
    // latest.yml 走 release 页而非 download 段时不该被改写
    expect(isGithubReleaseDownloadUrl("https://github.com/o/r/releases/tag/v1")).toBe(false);
    expect(isGithubReleaseDownloadUrl("https://objects.githubusercontent.com/x")).toBe(false);
    expect(isGithubReleaseDownloadUrl("not a url")).toBe(false);
  });

  it("拒绝缺少资产文件名的下载路径", () => {
    expect(isGithubReleaseDownloadUrl("https://github.com/o/r/releases/download/v1/")).toBe(false);
  });
});

describe("toMirrorUrl", () => {
  it("前缀 + 完整原 URL（ghfast 系镜像要求保留 https://github.com 整段）", () => {
    expect(toMirrorUrl(DOWNLOAD_URL, "https://ghfast.top")).toBe(
      `https://ghfast.top/${DOWNLOAD_URL}`,
    );
    expect(toMirrorUrl(DOWNLOAD_URL, "https://ghfast.top/")).toBe(
      `https://ghfast.top/${DOWNLOAD_URL}`,
    );
  });

  it("空前缀不改写（等价直连）", () => {
    expect(toMirrorUrl(DOWNLOAD_URL, "")).toBe(DOWNLOAD_URL);
    expect(toMirrorUrl(DOWNLOAD_URL, "   ")).toBe(DOWNLOAD_URL);
  });

  it("默认镜像指向 ghfast", () => {
    expect(DEFAULT_UPDATE_MIRROR_PREFIX).toBe("https://ghfast.top/");
  });
});

describe("resolveDownloadUrl", () => {
  it("mirror 走镜像前缀", () => {
    expect(resolveDownloadUrl(DOWNLOAD_URL, "mirror", "https://ghfast.top/")).toBe(
      `https://ghfast.top/${DOWNLOAD_URL}`,
    );
  });

  it("direct 用原站地址", () => {
    expect(resolveDownloadUrl(DOWNLOAD_URL, "direct", "https://ghfast.top/")).toBe(DOWNLOAD_URL);
  });

  it("manual 不发请求", () => {
    expect(resolveDownloadUrl(DOWNLOAD_URL, "manual", "https://ghfast.top/")).toBeNull();
  });

  it("空前缀下 mirror 退化为直连而非自指", () => {
    expect(resolveDownloadUrl(DOWNLOAD_URL, "mirror", "")).toBe(DOWNLOAD_URL);
  });
});

describe("buildManualDownloadUrl", () => {
  it("指向 release 详情页而非资产直链", () => {
    expect(buildManualDownloadUrl("ShiZiMiao", "RaspberryCode", "0.2.0")).toBe(
      "https://github.com/ShiZiMiao/RaspberryCode/releases/tag/v0.2.0",
    );
    // 已带 v 前缀不重复加
    expect(buildManualDownloadUrl("ShiZiMiao", "RaspberryCode", "v0.2.0")).toBe(
      "https://github.com/ShiZiMiao/RaspberryCode/releases/tag/v0.2.0",
    );
    // 无版本时回退 latest
    expect(buildManualDownloadUrl("o", "r")).toBe("https://github.com/o/r/releases/latest");
  });

  it("使用与下载一致的源站常量", () => {
    expect(buildManualDownloadUrl("o", "r").startsWith(GITHUB_DOWNLOAD_ORIGIN)).toBe(true);
  });
});

describe("buildDownloadAttemptKey", () => {
  it("归一化 v 前缀", () => {
    expect(buildDownloadAttemptKey("0.1.0")).toBe("v0.1.0");
    expect(buildDownloadAttemptKey("v0.1.0")).toBe("v0.1.0");
  });
});

describe("UpdateDownloadFallback", () => {
  it("默认从镜像起步", () => {
    const fallback = new UpdateDownloadFallback();
    expect(fallback.currentRoute).toBe("mirror");
  });

  it("每次 beginAttempt 重置回镜像（重试仍给镜像机会）", () => {
    const fallback = new UpdateDownloadFallback();
    fallback.beginAttempt("0.1.0");
    fallback.advance();
    expect(fallback.currentRoute).toBe("direct");
    fallback.beginAttempt("0.1.0");
    expect(fallback.currentRoute).toBe("mirror");
  });

  it("mirror → direct → manual 逐级降级后停在 manual", () => {
    const fallback = new UpdateDownloadFallback();
    fallback.beginAttempt("0.1.0");
    expect(fallback.advance()).toBe("direct");
    expect(fallback.advance()).toBe("manual");
    expect(fallback.advance()).toBe("manual");
  });

  it("已收到有效数据后不再降级（防中途换源拼坏文件）", () => {
    const fallback = new UpdateDownloadFallback();
    fallback.beginAttempt("0.1.0");
    fallback.markSucceeded();
    expect(fallback.hasSucceeded).toBe(true);
    expect(fallback.advance()).toBe("mirror");
  });

  it("reset 清空状态回到镜像", () => {
    const fallback = new UpdateDownloadFallback();
    fallback.beginAttempt("0.1.0");
    fallback.advance();
    fallback.markSucceeded();
    fallback.reset();
    expect(fallback.currentRoute).toBe("mirror");
    expect(fallback.currentAttemptKey).toBeNull();
    expect(fallback.hasSucceeded).toBe(false);
  });

  it("记录当前下载归属版本", () => {
    const fallback = new UpdateDownloadFallback();
    fallback.beginAttempt("0.2.0");
    expect(fallback.currentAttemptKey).toBe("v0.2.0");
  });
});
