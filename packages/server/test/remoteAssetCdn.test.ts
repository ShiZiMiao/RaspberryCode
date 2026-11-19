import { describe, expect, it } from "vitest";
import {
  buildComponentArtifactUrlCandidates,
  buildReleaseAssetUrlCandidates,
  buildReleaseBaseCandidates,
  isGithubReleaseDownloadUrl,
  toRemoteAssetMirrorUrl,
  withGithubMirrorCandidates,
} from "@raspberrycode/server/remote/remoteAssetCdn.js";

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

  it("镜像地址应为「前缀 + 完整原 URL」，且不重复前缀", () => {
    const mirrored = toRemoteAssetMirrorUrl(GITHUB_ASSET, "https://ghfast.top/");
    expect(mirrored).toBe(`https://ghfast.top/${GITHUB_ASSET}`);
    // 已经是镜像地址时必须幂等，否则回退链会拼出 https://m/https://m/https://...
    expect(toRemoteAssetMirrorUrl(mirrored, "https://ghfast.top/")).toBe(mirrored);
  });

  it("空前缀等于不镜像", () => {
    expect(toRemoteAssetMirrorUrl(GITHUB_ASSET, "   ")).toBe(GITHUB_ASSET);
    expect(withGithubMirrorCandidates([GITHUB_ASSET], "")).toEqual([GITHUB_ASSET]);
  });

  it("镜像候选应排在直连之前，并保留直连兜底", () => {
    const urls = withGithubMirrorCandidates([GITHUB_ASSET], "https://ghfast.top/");
    expect(urls).toEqual([`https://ghfast.top/${GITHUB_ASSET}`, GITHUB_ASSET]);
    // 关键不变量：直连必须仍在候选里。镜像服务稳定性不受我们控制，
    // 缺兜底会让镜像挂掉时远端升级直接失败。
    expect(urls).toContain(GITHUB_ASSET);
  });

  it("混入自建 CDN 时只给 GitHub 那几条加镜像", () => {
    const cdn = "https://cdn.example.com/raspberrycode/electron/releases/0.2.5/x.tar.gz";
    const urls = withGithubMirrorCandidates([GITHUB_ASSET, cdn], "https://ghfast.top/");
    expect(urls.filter((url) => url.startsWith("https://ghfast.top/"))).toEqual([
      `https://ghfast.top/${GITHUB_ASSET}`,
    ]);
    expect(urls).toContain(cdn);
  });

  it("多个 GitHub 文件时镜像集中在前、直连集中在后", () => {
    const second =
      "https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.5/raspberrycode-server-linux-arm64.tar.gz";
    const urls = withGithubMirrorCandidates([GITHUB_ASSET, second], "https://ghfast.top/");
    // 逐个文件交错会让每个文件都先吃一次镜像失败，这里要求整体分段。
    expect(urls.slice(0, 2)).toEqual([
      `https://ghfast.top/${GITHUB_ASSET}`,
      `https://ghfast.top/${second}`,
    ]);
    expect(urls.slice(2)).toEqual([GITHUB_ASSET, second]);
  });

  it("同一 URL 重复传入不产生重复候选", () => {
    const urls = withGithubMirrorCandidates([GITHUB_ASSET, GITHUB_ASSET], "https://ghfast.top/");
    expect(urls).toEqual([`https://ghfast.top/${GITHUB_ASSET}`, GITHUB_ASSET]);
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
