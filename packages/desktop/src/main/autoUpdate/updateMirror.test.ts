import { describe, expect, it } from "vitest";
import {
  buildDownloadAttemptKey,
  buildManualDownloadUrl,
  DEFAULT_UPDATE_MIRROR_CANDIDATES,
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
  // 不代表默认候选。真实候选是 `DEFAULT_UPDATE_MIRROR_CANDIDATES`，
  // 由发版前实测生成、存在 shared 的 client-update/contract.ts 里。
  // 不要把这些字符串当成「每版都要同步更新」的断言。
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

  it("默认前缀取候选列表首项（不硬编码具体镜像）", () => {
    // 不能断言具体域名：候选列表由发版前的探测脚本按速度重新生成，
    // 写死域名会让测试在每次换镜像时报错，与「镜像本来就会变」的事实冲突。
    // 这里只锁定结构约束：默认前缀必须等于候选首项，且形状合法。
    expect(DEFAULT_UPDATE_MIRROR_PREFIX).toBe(DEFAULT_UPDATE_MIRROR_CANDIDATES[0]);
    expect(DEFAULT_UPDATE_MIRROR_PREFIX.endsWith("/")).toBe(true);
    expect(() => new URL(DEFAULT_UPDATE_MIRROR_PREFIX)).not.toThrow();
  });

  it("候选列表最多 3 家（不足 3 家时按实际数量）", () => {
    // 用户 2026-11-23 规则：全通的按速度取前 3，不足有几个算几个。
    // GitHub 直连是兜底层（direct），不占候选名额，因此这里只数镜像。
    expect(DEFAULT_UPDATE_MIRROR_CANDIDATES.length).toBeGreaterThan(0);
    expect(DEFAULT_UPDATE_MIRROR_CANDIDATES.length).toBeLessThanOrEqual(3);
  });

  it("候选列表至少包含默认前缀，且都是 https origin 带末尾斜杠", () => {
    expect(DEFAULT_UPDATE_MIRROR_CANDIDATES).toContain(DEFAULT_UPDATE_MIRROR_PREFIX);
    for (const prefix of DEFAULT_UPDATE_MIRROR_CANDIDATES) {
      const url = new URL(prefix);
      // 必须是 https：http 前缀会被 Electron 当作不安全重定向拒绝。
      expect(url.protocol).toBe("https:");
      // 必须以 / 结尾：前缀拼接语义依赖它（toMirrorUrl 会补，但列表里写清更不易错）。
      expect(prefix.endsWith("/")).toBe(true);
      // 必须只是 origin，不带路径：带路径会让「前缀 + 完整原 URL」拼出错误地址。
      expect(url.pathname).toBe("/");
    }
  });

  it("候选列表无重复项（重复会让轮换白跑一轮）", () => {
    const normalized = DEFAULT_UPDATE_MIRROR_CANDIDATES.map((prefix) => prefix.toLowerCase());
    expect(new Set(normalized).size).toBe(normalized.length);
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

  describe("候选镜像轮换（单家公益镜像失效时先换候选，再降级直连）", () => {
    it("未配置候选时退化为单一前缀，行为与旧版一致", () => {
      const fallback = new UpdateDownloadFallback();
      fallback.beginAttempt("0.1.0");
      expect(fallback.currentMirrorPrefix("https://only.example/")).toBe("https://only.example/");
      expect(fallback.advance()).toBe("direct");
    });

    it("候选未用尽时停留在 mirror 级并切换前缀", () => {
      const fallback = new UpdateDownloadFallback();
      fallback.setMirrorCandidates(["https://a.example/", "https://b.example/"]);
      fallback.beginAttempt("0.1.0");

      expect(fallback.currentMirrorPrefix("ignored")).toBe("https://a.example/");
      // 第一家失败 → 换第二家，仍是 mirror 级
      expect(fallback.advance()).toBe("mirror");
      expect(fallback.currentMirrorPrefix("ignored")).toBe("https://b.example/");
      // 候选耗尽才降级到直连
      expect(fallback.advance()).toBe("direct");
      expect(fallback.advance()).toBe("manual");
    });

    it("beginAttempt 重新从第一个候选起步（上次候选可能只是临时故障）", () => {
      const fallback = new UpdateDownloadFallback();
      fallback.setMirrorCandidates(["https://a.example/", "https://b.example/"]);
      fallback.beginAttempt("0.1.0");
      fallback.advance();
      expect(fallback.currentMirrorPrefix("ignored")).toBe("https://b.example/");
      fallback.beginAttempt("0.1.0");
      expect(fallback.currentMirrorPrefix("ignored")).toBe("https://a.example/");
    });

    it("空候选列表表示禁用镜像：advance 直接降到直连", () => {
      const fallback = new UpdateDownloadFallback();
      fallback.setMirrorCandidates([]);
      fallback.beginAttempt("0.1.0");
      expect(fallback.currentMirrorPrefix("fallback.example/")).toBe("fallback.example/");
      expect(fallback.advance()).toBe("direct");
    });

    it("空白候选被过滤，不会产生空前缀导致的直连假象", () => {
      const fallback = new UpdateDownloadFallback();
      fallback.setMirrorCandidates(["", "  ", "https://a.example/"]);
      fallback.beginAttempt("0.1.0");
      expect(fallback.currentMirrorPrefix("ignored")).toBe("https://a.example/");
      expect(fallback.advance()).toBe("direct");
    });

    it("beginAttemptKeepingMirror 保留检查阶段已轮换的候选（下载不撞同一面墙）", () => {
      const fallback = new UpdateDownloadFallback();
      fallback.setMirrorCandidates(["https://a.example/", "https://b.example/"]);
      // 检查阶段：第 1 家失败，轮换到第 2 家
      fallback.beginAttempt("check");
      expect(fallback.advance()).toBe("mirror");
      expect(fallback.currentMirrorPrefix("ignored")).toBe("https://b.example/");
      // 下载阶段换归属键，但必须继续用第 2 家
      fallback.beginAttemptKeepingMirror("0.2.0");
      expect(fallback.currentRoute).toBe("mirror");
      expect(fallback.currentAttemptKey).toBe("v0.2.0");
      expect(fallback.currentMirrorPrefix("ignored")).toBe("https://b.example/");
    });

    it("beginAttemptKeepingMirror 在候选变少时夹紧下标，不越界", () => {
      const fallback = new UpdateDownloadFallback();
      fallback.setMirrorCandidates(["https://a.example/", "https://b.example/", "https://c.example/"]);
      fallback.beginAttempt("check");
      fallback.advance();
      fallback.advance();
      expect(fallback.currentMirrorPrefix("ignored")).toBe("https://c.example/");
      // 候选池缩到 1 个后继续下载：下标必须夹到 0，而不是指向不存在的 c
      fallback.setMirrorCandidates(["https://only.example/"]);
      fallback.beginAttemptKeepingMirror("0.2.0");
      expect(fallback.currentMirrorPrefix("ignored")).toBe("https://only.example/");
    });

    it("beginAttemptKeepingMirror 在候选为空时退回 fallback 前缀", () => {
      const fallback = new UpdateDownloadFallback();
      fallback.setMirrorCandidates([]);
      fallback.beginAttemptKeepingMirror("0.2.0");
      expect(fallback.currentMirrorPrefix("fallback.example/")).toBe("fallback.example/");
    });

    it("重复设置同一候选列表不清零下标（降级重试会重复调用，否则死循环）", () => {
      const fallback = new UpdateDownloadFallback();
      const candidates = ["https://a.example/", "https://b.example/"];
      fallback.setMirrorCandidates(candidates);
      fallback.beginAttempt("check");
      fallback.advance();
      expect(fallback.currentMirrorPrefix("ignored")).toBe("https://b.example/");

      // 降级重试再次进入检查流程 → 用同样内容再喂一次，不能把下标打回 0
      fallback.setMirrorCandidates([...candidates]);
      expect(fallback.currentMirrorPrefix("ignored")).toBe("https://b.example/");
    });

    it("候选列表内容真的变化时重置下标（配置切换语义）", () => {
      const fallback = new UpdateDownloadFallback();
      fallback.setMirrorCandidates(["https://a.example/", "https://b.example/"]);
      fallback.beginAttempt("check");
      fallback.advance();
      expect(fallback.currentMirrorPrefix("ignored")).toBe("https://b.example/");

      fallback.setMirrorCandidates(["https://x.example/", "https://y.example/"]);
      expect(fallback.currentMirrorPrefix("ignored")).toBe("https://x.example/");
    });
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
