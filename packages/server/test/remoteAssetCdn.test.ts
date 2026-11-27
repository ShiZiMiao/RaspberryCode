import { describe, expect, it } from "vitest";
import {
  assertRemoteCdnBaseVersionMatches,
  buildComponentArtifactUrlCandidates,
  buildReleaseAssetUrlCandidates,
  buildReleaseBaseCandidates,
  DEFAULT_REMOTE_ASSET_MIRROR_PREFIX,
  isGithubReleaseDownloadUrl,
  toRemoteAssetMirrorUrl,
  withGithubMirror,
} from "@raspberrycode/server/remote/remoteAssetCdn.js";
import { DEFAULT_UPDATE_MIRROR_PREFIX } from "@raspberrycode/shared/client-update";

describe("remoteAssetCdn URL encoding", () => {
  it("组件路径包含 '+' 时应编码为 %2B", () => {
    const urls = buildComponentArtifactUrlCandidates(
      ["https://cdn.example.com/raspberrycode/electron/releases/1.3.0"],
      "components/linux-arm64/server-bundle/v1.3.0+7138ea7a9b45.tar.gz",
      "1.3.0",
    );

    expect(urls).toEqual([
      "https://cdn.example.com/raspberrycode/electron/releases/components/linux-arm64/server-bundle/v1.3.0%2B7138ea7a9b45.tar.gz",
      "https://cdn.example.com/raspberrycode/electron/releases/1.3.0/components/linux-arm64/server-bundle/v1.3.0%2B7138ea7a9b45.tar.gz",
    ]);
  });

  it("组件产物应从带版本 manifest 基址回退到跨版本 components 根目录", () => {
    const urls = buildComponentArtifactUrlCandidates(
      [
        "https://cdn.example.com/raspberrycode/electron/releases/1.3.0",
        "https://backup.example.com/raspberrycode/electron/releases/1.3.0",
      ],
      "components/linux-arm64/server-bundle/v1.3.0.tar.gz",
      "1.3.0",
    );

    expect(urls).toEqual([
      "https://cdn.example.com/raspberrycode/electron/releases/components/linux-arm64/server-bundle/v1.3.0.tar.gz",
      "https://cdn.example.com/raspberrycode/electron/releases/1.3.0/components/linux-arm64/server-bundle/v1.3.0.tar.gz",
      "https://backup.example.com/raspberrycode/electron/releases/components/linux-arm64/server-bundle/v1.3.0.tar.gz",
      "https://backup.example.com/raspberrycode/electron/releases/1.3.0/components/linux-arm64/server-bundle/v1.3.0.tar.gz",
    ]);
  });

  it("已编码路径不应重复编码", () => {
    const urls = buildReleaseAssetUrlCandidates(
      ["https://cdn.example.com/raspberrycode/electron/releases/1.3.0"],
      ["components/linux-arm64/server-bundle/v1.3.0%2B7138ea7a9b45.tar.gz"],
    );

    expect(urls).toEqual([
      "https://cdn.example.com/raspberrycode/electron/releases/1.3.0/components/linux-arm64/server-bundle/v1.3.0%2B7138ea7a9b45.tar.gz",
    ]);
  });
});

// 远程 Source Server 包约 90MB/平台，直连 GitHub 实测 390KB/s、经镜像 835KB/s；
// 网络差的时段直连可掉到 50KB/s 以下。镜像候选解决的是这个耗时问题。
describe("remoteAssetCdn GitHub 镜像候选", () => {
  const GITHUB_ASSET =
    "https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.5/raspberrycode-server-linux-x64.tar.gz";

  it("GitHub release 资产应识别为可镜像", () => {
    expect(isGithubReleaseDownloadUrl(GITHUB_ASSET)).toBe(true);
  });

  it("非 GitHub 主机、非 releases/download 路径不应被镜像", () => {
    // 自建 CDN/OSS 没有对应镜像能力，硬加前缀只会得到 404。
    expect(isGithubReleaseDownloadUrl("https://cdn.example.com/rel/a.tar.gz")).toBe(false);
    // api.github.com 是元数据接口，镜像不做透明转发。
    expect(
      isGithubReleaseDownloadUrl("https://api.github.com/repos/o/r/releases/tags/v1"),
    ).toBe(false);
    // 同主机但不在 releases/download 下（例如仓库页面）。
    expect(isGithubReleaseDownloadUrl("https://github.com/o/r/releases/tag/v1")).toBe(false);
  });

  it("镜像地址应为「替换源站、保留路径」，且不重复前缀", () => {
    const mirrored = toRemoteAssetMirrorUrl(GITHUB_ASSET, "https://ghfast.top/");
    expect(mirrored).toBe(
      "https://ghfast.top/ShiZiMiao/RaspberryCode/releases/download/v0.2.5/raspberrycode-server-linux-x64.tar.gz",
    );
    // 已经是镜像地址时必须幂等，否则回退链会拼出 https://m/https://m/https://...
    expect(toRemoteAssetMirrorUrl(mirrored, "https://ghfast.top/")).toBe(mirrored);
  });

  it("空前缀等于不镜像", () => {
    expect(toRemoteAssetMirrorUrl(GITHUB_ASSET, "   ")).toBe(GITHUB_ASSET);
    expect(withGithubMirror([GITHUB_ASSET], "")).toEqual([GITHUB_ASSET]);
  });

  it("镜像候选应排在直连之前，并保留直连兜底", () => {
    const urls = withGithubMirror([GITHUB_ASSET], "https://ghfast.top/");
    expect(urls).toEqual([
      "https://ghfast.top/ShiZiMiao/RaspberryCode/releases/download/v0.2.5/raspberrycode-server-linux-x64.tar.gz",
      GITHUB_ASSET,
    ]);
    // 关键不变量：直连必须仍在候选里。镜像服务稳定性不受我们控制，
    // 缺兜底会让镜像挂掉时远端升级直接失败。
    expect(urls).toContain(GITHUB_ASSET);
  });

  it("混入自建 CDN 时只给 GitHub 那几条加镜像", () => {
    const cdn = "https://cdn.example.com/raspberrycode/electron/releases/0.2.5/x.tar.gz";
    const urls = withGithubMirror([GITHUB_ASSET, cdn], "https://ghfast.top/");
    expect(urls.filter((url) => url.startsWith("https://ghfast.top/"))).toEqual([
      "https://ghfast.top/ShiZiMiao/RaspberryCode/releases/download/v0.2.5/raspberrycode-server-linux-x64.tar.gz",
    ]);
    expect(urls).toContain(cdn);
  });

  it("多个 GitHub 文件时镜像集中在前、直连集中在后", () => {
    const second =
      "https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.5/raspberrycode-server-linux-arm64.tar.gz";
    const urls = withGithubMirror([GITHUB_ASSET, second], "https://ghfast.top/");
    // 逐个文件交错会让每个文件都先吃一次镜像失败，这里要求整体分段。
    expect(urls.slice(0, 2)).toEqual([
      "https://ghfast.top/ShiZiMiao/RaspberryCode/releases/download/v0.2.5/raspberrycode-server-linux-x64.tar.gz",
      "https://ghfast.top/ShiZiMiao/RaspberryCode/releases/download/v0.2.5/raspberrycode-server-linux-arm64.tar.gz",
    ]);
    expect(urls.slice(2)).toEqual([GITHUB_ASSET, second]);
  });

  it("同一 URL 重复传入不产生重复候选", () => {
    const urls = withGithubMirror([GITHUB_ASSET, GITHUB_ASSET], "https://ghfast.top/");
    expect(urls).toEqual([
      "https://ghfast.top/ShiZiMiao/RaspberryCode/releases/download/v0.2.5/raspberrycode-server-linux-x64.tar.gz",
      GITHUB_ASSET,
    ]);
  });
});

// GitHub Release 的发布根以 tag 结尾（.../releases/download/v0.2.5），
// 自建 CDN 以纯版本号结尾（.../releases/0.2.5）。两种形态都必须识别为「已带版本段」，
// 否则会多拼一级版本，产生必然 404 的候选（2026-11-19 实测 .../download/v0.2.5/0.2.5 -> 404）。
describe("remoteAssetCdn 带版本段的发布根", () => {
  const FILE = "raspberrycode-server-linux-x64.tar.gz";

  it("GitHub tag 形态的根不应再拼一级版本", () => {
    const bases = buildReleaseBaseCandidates(
      ["https://github.com/o/r/releases/download/v0.2.5"],
      "0.2.5",
    );
    expect(bases).toEqual(["https://github.com/o/r/releases/download/v0.2.5"]);
    const urls = buildReleaseAssetUrlCandidates(bases, [FILE]);
    expect(urls).toEqual([`https://github.com/o/r/releases/download/v0.2.5/${FILE}`]);
  });

  it("纯版本号形态的根不应再拼一级版本", () => {
    const bases = buildReleaseBaseCandidates(
      ["https://cdn.example.com/raspberrycode/electron/releases/0.2.5"],
      "0.2.5",
    );
    expect(bases).toEqual(["https://cdn.example.com/raspberrycode/electron/releases/0.2.5"]);
  });

  it("未带版本段的根仍应同时给出「带版本」与「不带版本」两个候选", () => {
    const bases = buildReleaseBaseCandidates(["https://cdn.example.com/releases"], "0.2.5");
    // 保留两种候选：既有部署把产物放在 releases/<version>/ 下，也有放在 releases/ 根下。
    expect(bases).toEqual([
      "https://cdn.example.com/releases/0.2.5",
      "https://cdn.example.com/releases",
    ]);
  });

  it("v 前缀与无前缀混用时各自正确判定", () => {
    const bases = buildReleaseBaseCandidates(
      ["https://github.com/o/r/releases/download/v0.2.5", "https://cdn.example.com/releases"],
      "0.2.5",
    );
    expect(bases).toEqual([
      "https://github.com/o/r/releases/download/v0.2.5",
      "https://cdn.example.com/releases/0.2.5",
      "https://cdn.example.com/releases",
    ]);
  });
});

/**
 * 与客户端自更新共用默认镜像（2026-11-26）。
 *
 * 背景：这里原本固定写着 `https://ghfast.top/`，而它早已对 atom 返回 403、
 * 下载速度也大幅劣化。客户端那边已固定为自建 `https://ghm.shizimiao.cc.cd/`，
 * 若远程资产仍用旧的写死值，就会出现「客户端已切到新镜像、远程升级还在用旧镜像」。
 *
 * 因此默认前缀的事实源上移到 `@raspberrycode/shared/client-update`，两边共用一份。
 * 这些用例锁住三件事：默认用 shared 的单一镜像、镜像排在直连之前、直连始终兜底在末尾。
 */
describe("withGithubMirror 与客户端共用默认镜像", () => {
  const ASSET =
    "https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.8/pkg-linux-x64.tar.gz";

  it("默认使用 shared 的单一镜像前缀", () => {
    const out = withGithubMirror([ASSET]);
    expect(out).toEqual([
      `${DEFAULT_UPDATE_MIRROR_PREFIX}ShiZiMiao/RaspberryCode/releases/download/v0.2.8/pkg-linux-x64.tar.gz`,
      ASSET,
    ]);
  });

  it("直连永远排在最后，不会被镜像挤掉（镜像挂了仍能升级）", () => {
    const out = withGithubMirror([ASSET]);
    expect(out[out.length - 1]).toBe(ASSET);
    expect(out.filter((u) => u === ASSET)).toHaveLength(1);
  });

  it("默认前缀与 shared 常量一致（避免两个常量脱节）", () => {
    expect(DEFAULT_REMOTE_ASSET_MIRROR_PREFIX).toBe(DEFAULT_UPDATE_MIRROR_PREFIX);
  });

  it("空前缀等价于禁用镜像（只走直连）", () => {
    expect(withGithubMirror([ASSET], "")).toEqual([ASSET]);
    expect(withGithubMirror([ASSET], "   ")).toEqual([ASSET]);
  });

  it("非 GitHub 资产（自建 CDN）不加镜像前缀", () => {
    const cdn = "https://cdn.example.com/releases/0.2.8/pkg.tar.gz";
    expect(withGithubMirror([cdn])).toEqual([cdn]);
  });
});

/**
 * 回归组：版本锁校验必须认得出 `v` 前缀。
 *
 * 事故（0.2.8，用户先发现）：用户机器遗留的覆盖变量是
 * `https://github.com/.../releases/download/v0.2.5`。旧实现的版本提取用
 * 数字开头的锚定正则，`v0.2.5` 提取结果为 `null`，而 `null` 在这个校验里
 * 的语义是「根没钉版本」→ **直接放行**。
 * 于是「GitHub tag 根钉在旧版本」这个最该被拦下的形态，恰好成了唯一逃过校验的形态。
 * 判定口径必须与 `isReleaseRootAlreadyVersioned` 一致（它同时认 /0.2.5 与 /v0.2.5）。
 */
describe("assertRemoteCdnBaseVersionMatches", () => {
  it("GitHub tag 根钉在旧版本时抛出（v 前缀必须被识别）", () => {
    expect(() =>
      assertRemoteCdnBaseVersionMatches(
        ["https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.5"],
        "0.2.8",
      ),
    ).toThrow(/0\.2\.5/u);
  });

  it("GitHub tag 根与当前版本一致时放行", () => {
    expect(() =>
      assertRemoteCdnBaseVersionMatches(
        ["https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.8"],
        "0.2.8",
      ),
    ).not.toThrow();
  });

  it("预发布版本（-rc.N）按完整版本号比较，不做前段匹配", () => {
    expect(() =>
      assertRemoteCdnBaseVersionMatches(
        ["https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.8-rc.2"],
        "0.2.8-rc.3",
      ),
    ).toThrow(/0\.2\.8-rc\.2/u);
    expect(() =>
      assertRemoteCdnBaseVersionMatches(
        ["https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.8-rc.3"],
        "0.2.8-rc.3",
      ),
    ).not.toThrow();
  });

  it("纯版本号形态的旧根同样被拦下", () => {
    expect(() =>
      assertRemoteCdnBaseVersionMatches(
        ["https://cdn.example.com/raspberrycode/electron/releases/0.2.5"],
        "0.2.8",
      ),
    ).toThrow(/0\.2\.5/u);
  });

  it("不带版本段的根不参与校验（自建 CDN 兜底形态，仍由候选派生拼版本）", () => {
    expect(() =>
      assertRemoteCdnBaseVersionMatches(
        ["https://cdn.example.com/raspberrycode/electron/releases"],
        "0.2.8",
      ),
    ).not.toThrow();
  });

  it("路径段看起来像版本但语义不是版本时不误报（如 /v2/assets）", () => {
    expect(() => assertRemoteCdnBaseVersionMatches(["https://cdn.example.com/v2/assets"], "0.2.8")).not.toThrow();
    expect(() => assertRemoteCdnBaseVersionMatches(["https://cdn.example.com/releases"], "0.2.8")).not.toThrow();
  });

  it("多根里只要有一个钉错就报错，并逐个列出（便于定位是哪个源）", () => {
    expect(() =>
      assertRemoteCdnBaseVersionMatches(
        [
          "https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.5",
          "https://cdn.example.com/raspberrycode/electron/releases",
        ],
        "0.2.8",
      ),
    ).toThrow(/0\.2\.5/u);
  });
});
