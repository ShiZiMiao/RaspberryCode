import { describe, expect, it } from "vitest";
import {
  buildDownloadAttemptKey,
  buildManualDownloadUrl,
  DEFAULT_UPDATE_MIRROR_PREFIX,
  GITHUB_DOWNLOAD_ORIGIN,
  isGithubMirrorTarget,
  isGithubReleaseDownloadUrl,
  resolveDownloadUrl,
  toMirrorUrl,
  UpdateDownloadFallback,
} from "./updateMirror.js";

const DOWNLOAD_URL =
  "https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.1.0/RaspberryCode-0.1.0-win-x64.exe";

describe("isGithubReleaseDownloadUrl（旧语义，仅资产下载）", () => {
  it("识别 release 资产下载", () => {
    expect(isGithubReleaseDownloadUrl(DOWNLOAD_URL)).toBe(true);
    expect(
      isGithubReleaseDownloadUrl(
        "https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.1.0/RaspberryCode-0.1.0-win-x64.exe.blockmap",
      ),
    ).toBe(true);
  });

  it("只认 download 段，不认元数据", () => {
    expect(isGithubReleaseDownloadUrl("https://github.com/o/r/releases/tag/v1")).toBe(false);
    expect(isGithubReleaseDownloadUrl("https://github.com/o/r/releases.atom")).toBe(false);
  });

  it("拒绝缺少资产文件名的下载路径", () => {
    expect(isGithubReleaseDownloadUrl("https://github.com/o/r/releases/download/v1/")).toBe(false);
  });
});

describe("isGithubMirrorTarget（新语义，覆盖检查阶段）", () => {
  it("覆盖检查阶段三条请求（这是修复「检查更新失败」的关键）", () => {
    // GitHubProvider 每次检查先取 atom，再取 latest，最后取 latest.yml。
    // 只重写最后一条会让无代理用户在第一条就超时。
    expect(isGithubMirrorTarget("https://github.com/o/r/releases.atom")).toBe(true);
    expect(isGithubMirrorTarget("https://github.com/o/r/releases/latest")).toBe(true);
    expect(isGithubMirrorTarget(DOWNLOAD_URL)).toBe(true);
  });

  it("放行 api.github.com（GitHubProvider 不用，但 Enterprise 场景可能用）", () => {
    expect(isGithubMirrorTarget("https://api.github.com/repos/o/r/releases")).toBe(false);
  });

  it("放行非 github 域与畸形 URL", () => {
    expect(isGithubMirrorTarget("https://objects.githubusercontent.com/x")).toBe(false);
    expect(isGithubMirrorTarget("https://raw.githubusercontent.com/o/r/main/a.txt")).toBe(false);
    expect(isGithubMirrorTarget("not a url")).toBe(false);
    expect(isGithubMirrorTarget("")).toBe(false);
  });

  it("放行 github.com 根路径（不该被改写）", () => {
    expect(isGithubMirrorTarget("https://github.com/")).toBe(false);
    expect(isGithubMirrorTarget("https://github.com/o")).toBe(false);
    expect(isGithubMirrorTarget("https://github.com/o/r")).toBe(false);
  });
});

describe("toMirrorUrl", () => {
  // 注意：本 describe 里的 `https://gh-proxy.com` 只是**任取的样例前缀**，
  // 用于验证「前缀 + 完整原 URL」的拼接与末尾斜杠归一化，
  // 不代表默认镜像。默认镜像是 `DEFAULT_UPDATE_MIRROR_PREFIX`。
  it("前缀 + 完整原 URL（镜像要求保留 https://github.com 整段）", () => {
    expect(toMirrorUrl(DOWNLOAD_URL, "https://gh-proxy.com")).toBe(
      `https://gh-proxy.com/${DOWNLOAD_URL}`,
    );
    expect(toMirrorUrl(DOWNLOAD_URL, "https://gh-proxy.com/")).toBe(
      `https://gh-proxy.com/${DOWNLOAD_URL}`,
    );
  });

  it("空前缀不改写（等价直连）", () => {
    expect(toMirrorUrl(DOWNLOAD_URL, "")).toBe(DOWNLOAD_URL);
    expect(toMirrorUrl(DOWNLOAD_URL, "   ")).toBe(DOWNLOAD_URL);
  });

  it("默认镜像固定为 cdn.akaere.online，且形状合法", () => {
    expect(DEFAULT_UPDATE_MIRROR_PREFIX).toBe("https://cdn.akaere.online/");
    const url = new URL(DEFAULT_UPDATE_MIRROR_PREFIX);
    // 必须是 https：http 前缀会被 Electron 当作不安全重定向拒绝。
    expect(url.protocol).toBe("https:");
    // 必须以 / 结尾：前缀拼接语义依赖它（toMirrorUrl 会补，但常量里写清更不易错）。
    expect(DEFAULT_UPDATE_MIRROR_PREFIX.endsWith("/")).toBe(true);
    // 必须只是 origin，不带路径：带路径会让「前缀 + 完整原 URL」拼出错误地址。
    expect(url.pathname).toBe("/");
  });
});

describe("resolveDownloadUrl", () => {
  it("mirror 走镜像前缀", () => {
    expect(resolveDownloadUrl(DOWNLOAD_URL, "mirror", "https://gh-proxy.com/")).toBe(
      `https://gh-proxy.com/${DOWNLOAD_URL}`,
    );
  });

  it("direct 用原站地址", () => {
    expect(resolveDownloadUrl(DOWNLOAD_URL, "direct", "https://gh-proxy.com/")).toBe(DOWNLOAD_URL);
  });

  it("manual 不发请求", () => {
    expect(resolveDownloadUrl(DOWNLOAD_URL, "manual", "https://gh-proxy.com/")).toBeNull();
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

describe("UpdateDownloadFallback.resetAttemptKey", () => {
  it("保留已降级路线，只换归属键（供检查→下载交接）", () => {
    const fallback = new UpdateDownloadFallback();
    fallback.beginAttempt("check");
    fallback.advance(); // mirror → direct
    expect(fallback.currentRoute).toBe("direct");

    fallback.resetAttemptKey("0.2.0");
    // 关键：不能被打回 mirror，否则下载会在同一处再失败一次
    expect(fallback.currentRoute).toBe("direct");
    expect(fallback.currentAttemptKey).toBe("v0.2.0");
  });

  it("不改变 succeeded 标记", () => {
    const fallback = new UpdateDownloadFallback();
    fallback.beginAttempt("check");
    fallback.markSucceeded();
    fallback.resetAttemptKey("0.2.0");
    expect(fallback.hasSucceeded).toBe(true);
  });
});
