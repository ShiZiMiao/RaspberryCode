import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RASPBERRYCODE_VERSION } from "@raspberrycode/shared";

// 预下载是启动阶段的纯优化路径。它的失败绝不能影响连接，
// 因此这里钉住的核心不变量是「不抛错、不阻断、缓存已存在时不重复下载」。
const resolveSourceServerReleaseAsset = vi.fn();
vi.mock("../src/host/sourceServerReleaseResolver.js", () => ({
  resolveSourceServerReleaseAsset: (...args: unknown[]) =>
    resolveSourceServerReleaseAsset(...args),
}));

const { prefetchSourceServerReleases, didPrefetchDownload, SOURCE_SERVER_PREFETCH_TARGETS } =
  await import("../src/host/sourceServerPrefetch.js");

let cacheRoot: string;

function cacheFileFor(target: string): string {
  return join(cacheRoot, "source-server", RASPBERRYCODE_VERSION, `raspberrycode-server-${target}.tar.gz`);
}

async function seedCachedArchive(target: string): Promise<void> {
  const path = cacheFileFor(target);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "cached-archive-bytes");
}

beforeEach(async () => {
  cacheRoot = await mkdtemp(join(tmpdir(), "rc-prefetch-"));
  resolveSourceServerReleaseAsset.mockReset();
  // 默认成功：模拟「下载并落盘」。真实实现由 downloadArchive 负责写文件，
  // 这里只关心预取层的判定逻辑，故用空实现表示成功。
  resolveSourceServerReleaseAsset.mockResolvedValue({});
});

afterEach(async () => {
  await rm(cacheRoot, { recursive: true, force: true });
});

describe("prefetchSourceServerReleases", () => {
  it("默认只预取 Linux 两平台（不含 macOS）", () => {
    expect(SOURCE_SERVER_PREFETCH_TARGETS).toEqual([
      { platform: "linux", arch: "x64" },
      { platform: "linux", arch: "arm64" },
    ]);
  });

  it("缓存目录未配置时直接跳过，不发起任何下载", async () => {
    const results = await prefetchSourceServerReleases({ remoteAssets: {} });
    expect(results).toEqual([]);
    expect(resolveSourceServerReleaseAsset).not.toHaveBeenCalled();
  });

  it("缓存缺失时应下载并标记为 downloaded", async () => {
    const results = await prefetchSourceServerReleases({
      remoteAssets: { remoteCacheDir: cacheRoot },
      targets: [{ platform: "linux", arch: "x64" }],
    });
    expect(resolveSourceServerReleaseAsset).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ target: "linux-x64", outcome: "downloaded" }]);
  });

  it("缓存已存在时仍走一次解析（用于 sha256 校验），但标记为 cached", async () => {
    await seedCachedArchive("linux-x64");
    const results = await prefetchSourceServerReleases({
      remoteAssets: { remoteCacheDir: cacheRoot },
      targets: [{ platform: "linux", arch: "x64" }],
    });
    // 解析内部会先验 sha256 再决定是否复用，所以这里必须真的调用一次；
    // 关键区别是 outcome 为 cached，且真实实现不会产生网络请求。
    expect(resolveSourceServerReleaseAsset).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ target: "linux-x64", outcome: "cached" }]);
  });

  it("单个目标失败不影响其他目标，且不抛错", async () => {
    resolveSourceServerReleaseAsset.mockImplementation((probe: { arch: string }) => {
      if (probe.arch === "x64") return Promise.reject(new Error("network down"));
      return Promise.resolve({});
    });

    const results = await prefetchSourceServerReleases({
      remoteAssets: { remoteCacheDir: cacheRoot },
    });

    // 这是最关键的不变量：预下载失败绝不能让 Host 启动或连接流程炸掉。
    expect(results).toEqual([
      { target: "linux-x64", outcome: "failed", message: "network down" },
      { target: "linux-arm64", outcome: "downloaded" },
    ]);
  });

  it("全部失败时返回结果而不抛错", async () => {
    resolveSourceServerReleaseAsset.mockRejectedValue(new Error("boom"));
    await expect(
      prefetchSourceServerReleases({ remoteAssets: { remoteCacheDir: cacheRoot } }),
    ).resolves.toHaveLength(2);
  });

  it("传入的探测结果只携带平台信息，不伪装成已安装状态", async () => {
    await prefetchSourceServerReleases({
      remoteAssets: { remoteCacheDir: cacheRoot },
      targets: [{ platform: "linux", arch: "arm64" }],
    });
    const [probe, , target] = resolveSourceServerReleaseAsset.mock.calls[0];
    expect(probe).toEqual({ platform: "linux", arch: "arm64", installed: false });
    // 必须是 local-download-upload：remote-download 只返回 URL 不落盘，预下载就没有意义。
    expect(target.assetInstallMode).toBe("local-download-upload");
  });

  it("didPrefetchDownload 只在真的下载过时为真", () => {
    expect(
      didPrefetchDownload([
        { target: "linux-x64", outcome: "cached" },
        { target: "linux-arm64", outcome: "cached" },
      ]),
    ).toBe(false);
    expect(
      didPrefetchDownload([
        { target: "linux-x64", outcome: "cached" },
        { target: "linux-arm64", outcome: "downloaded" },
      ]),
    ).toBe(true);
    expect(didPrefetchDownload([{ target: "linux-x64", outcome: "failed" }])).toBe(false);
  });
});
