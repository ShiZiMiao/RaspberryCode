import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RASPBERRYCODE_VERSION } from "@raspberrycode/shared";
import { resolveSourceServerReleaseAsset } from "../src/host/sourceServerReleaseResolver.js";

const target = { kind: "ssh", host: "example.com", username: "alice" } as const;
const probe = { platform: "linux", arch: "x64", installed: false } as const;
const fileName = "raspberrycode-server-linux-x64.tar.gz";

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function descriptor(contents: string) {
  return {
    schemaVersion: 1,
    version: RASPBERRYCODE_VERSION,
    archives: [
      {
        target: "linux-x64",
        version: RASPBERRYCODE_VERSION,
        fileName,
        sha256: sha256(contents),
        sizeBytes: Buffer.byteLength(contents),
        urls: [fileName],
      },
    ],
  };
}

describe("Source Server release resolver", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("previews descriptor metadata without downloading the archive", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("source-server-release.json"))
        return new Response(JSON.stringify(descriptor("preview-package")));
      throw new Error("preview must not fetch archives");
    });
    const release = await resolveSourceServerReleaseAsset(
      probe,
      { remoteCdnBaseUrl: "https://release.test" },
      target,
      { fetch },
      { metadataOnly: true },
    );
    expect(release).toMatchObject({ version: RASPBERRYCODE_VERSION, sizeBytes: 15 });
    expect(release.localArchivePath).toBeUndefined();
    expect(
      fetch.mock.calls.every(([url]) => String(url).endsWith("source-server-release.json")),
    ).toBe(true);
  });
  it("uses and verifies a staged local archive for local-download-upload", async () => {
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-source-release-local-"));
    const releaseDir = join(root, "releases", RASPBERRYCODE_VERSION);
    const contents = "local-source-server";
    await mkdir(releaseDir, { recursive: true });
    await writeFile(join(releaseDir, fileName), contents);
    await writeFile(
      join(releaseDir, "source-server-release.json"),
      JSON.stringify(descriptor(contents)),
    );

    const release = await resolveSourceServerReleaseAsset(probe, { mockCdnDir: root }, target);

    expect(release).toMatchObject({
      localArchivePath: join(releaseDir, fileName),
      target: "linux-x64",
      version: RASPBERRYCODE_VERSION,
      sha256: sha256(contents),
      sizeBytes: Buffer.byteLength(contents),
    });
  });

  it("uses the staged local archive for development even when SSH prefers remote download", async () => {
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-source-release-dev-local-"));
    const releaseDir = join(root, "releases", RASPBERRYCODE_VERSION);
    const contents = "development-source-server";
    await mkdir(releaseDir, { recursive: true });
    await writeFile(join(releaseDir, fileName), contents);
    await writeFile(
      join(releaseDir, "source-server-release.json"),
      JSON.stringify(descriptor(contents)),
    );
    const fetchMock = vi.fn(async () => {
      throw new Error("development resolution must not access CDN");
    });
    vi.stubGlobal("fetch", fetchMock);

    const release = await resolveSourceServerReleaseAsset(
      probe,
      {
        mockCdnDir: root,
        sourceServerArtifactPolicy: "development-content-addressed",
      },
      { ...target, assetInstallMode: "remote-download" },
    );

    expect(release.localArchivePath).toBe(join(releaseDir, fileName));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed without a staged local development descriptor", async () => {
    const fetchMock = vi.fn(async () => new Response("production-release", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveSourceServerReleaseAsset(
        probe,
        {
          sourceServerArtifactPolicy: "development-content-addressed",
          remoteCdnBaseUrls: ["https://cdn.example.test/releases"],
        },
        target,
      ),
    ).rejects.toThrow("run pnpm bootstrap:with-remote");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves descriptor URLs without downloading the archive for remote-download", async () => {
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-source-release-remote-"));
    const contents = "remote-source-server";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.endsWith("/source-server-release.json")) return new Response(null, { status: 404 });
      return new Response(JSON.stringify(descriptor(contents)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const release = await resolveSourceServerReleaseAsset(
      probe,
      {
        remoteCdnBaseUrls: [`https://cdn.example.test/releases/${RASPBERRYCODE_VERSION}`],
        remoteCacheDir: root,
      },
      { ...target, assetInstallMode: "remote-download" },
    );

    expect(release).toEqual({
      target: "linux-x64",
      version: RASPBERRYCODE_VERSION,
      sha256: sha256(contents),
      sizeBytes: Buffer.byteLength(contents),
      urls: [`https://cdn.example.test/releases/${RASPBERRYCODE_VERSION}/${fileName}`],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("downloads and verifies the descriptor archive into the Desktop cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-source-release-cache-"));
    const contents = "cached-source-server";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/source-server-release.json")) {
        return new Response(JSON.stringify(descriptor(contents)), { status: 200 });
      }
      if (url.endsWith(`/${fileName}`)) return new Response(contents, { status: 200 });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const release = await resolveSourceServerReleaseAsset(
      probe,
      {
        remoteCdnBaseUrls: [`https://cdn.example.test/releases/${RASPBERRYCODE_VERSION}`],
        remoteCacheDir: root,
      },
      target,
    );

    expect(release.localArchivePath).toBe(join(root, "source-server", RASPBERRYCODE_VERSION, fileName));
    await expect(readFile(release.localArchivePath!, "utf8")).resolves.toBe(contents);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the injected remote asset network for descriptor and archive downloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-source-release-proxy-"));
    const contents = "proxy-source-server";
    const remoteAssetFetch = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/source-server-release.json")) {
        return new Response(JSON.stringify(descriptor(contents)), { status: 200 });
      }
      if (url.endsWith(`/${fileName}`)) return new Response(contents, { status: 200 });
      return new Response(null, { status: 404 });
    });
    const directFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("remote asset direct fetch is forbidden"));
    vi.stubGlobal("fetch", directFetch);

    const release = await resolveSourceServerReleaseAsset(
      probe,
      {
        remoteCdnBaseUrls: [`https://cdn.example.test/releases/${RASPBERRYCODE_VERSION}`],
        remoteCacheDir: root,
      },
      target,
      { fetch: remoteAssetFetch },
    );

    expect(release.localArchivePath).toBe(join(root, "source-server", RASPBERRYCODE_VERSION, fileName));
    expect(remoteAssetFetch).toHaveBeenCalledTimes(2);
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("does not fall back to direct fetch when the injected network fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-source-release-proxy-failure-"));
    const directFetch = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(descriptor("direct-source-server"))),
    );
    vi.stubGlobal("fetch", directFetch);
    const remoteAssetFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("proxy unavailable"));

    await expect(
      resolveSourceServerReleaseAsset(
        probe,
        {
          remoteCdnBaseUrls: [`https://cdn.example.test/releases/${RASPBERRYCODE_VERSION}`],
          remoteCacheDir: root,
        },
        target,
        { fetch: remoteAssetFetch },
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Unable to resolve Source Server release descriptor"),
      cause: expect.objectContaining({ message: "proxy unavailable" }),
    });
    expect(remoteAssetFetch).toHaveBeenCalled();
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("三源皆缺时显式失败并提示两个配置项（规则 6 不回退默认域名）", async () => {
    const fetch = vi.fn<typeof fetch>();
    await expect(resolveSourceServerReleaseAsset(probe, {}, target, { fetch })).rejects.toThrow(
      /Unable to resolve Source Server release descriptor \(no local release dir configured \(RASPBERRYCODE_REMOTE_ASSET_LOCAL_RELEASE_DIR\); no HTTP release roots configured \(RASPBERRYCODE_REMOTE_ASSET_CDN_BASE_URL\)\)/u,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("配置了本地发布目录但 descriptor 缺失时报出目录路径并保持 fail-closed", async () => {
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-source-release-missing-"));
    const fetch = vi.fn<typeof fetch>();
    // 消息经脱敏层后路径会归并为 [redacted-path]；此处锚定「哪一面缺 descriptor」与
    // 另一源的配置提示，目录本体由 fail-closed 行为与日志承载。
    await expect(
      resolveSourceServerReleaseAsset(probe, { mockCdnDir: root }, target, { fetch }),
    ).rejects.toThrow(
      /Unable to resolve Source Server release descriptor \(local release dir missing source-server-release\.json.*no HTTP release roots configured \(RASPBERRYCODE_REMOTE_ASSET_CDN_BASE_URL\)\)/u,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

/**
 * 回归组：发布根被钉在**旧版本**时必须立刻报版本不匹配。
 *
 * 事故（0.2.8，用户先发现）：用户机器上遗留了 0.2.5 事故期的人工绕过变量
 * `RASPBERRYCODE_REMOTE_ASSET_CDN_BASE_URL=.../releases/download/v0.2.5`。
 * override 分支不拼版本，于是派生两个候选：
 *   .../download/v0.2.5/0.2.8  → 404
 *   .../download/v0.2.5        → 200，但 descriptor.version=0.2.5 ≠ 0.2.8
 * 两条都拿不到可用 descriptor，最终只报一句「HTTP release roots unreachable」，
 * 且 URL 已被脱敏成 [redacted-url]，完全看不出真因。
 *
 * 该链路此前从未调用过 `assertRemoteCdnBaseVersionMatches`（只有 remoteAssetCache 调），
 * 而且那个函数的版本提取竟然认不出 `v` 前缀 —— 偏偏 GitHub tag 根就是 `v` 前缀，
 * 也就是「最该被拦下的形态恰好是唯一逃过校验的形态」。以下用例锁死这两点。
 */
describe("Source Server release resolver 发布根钉在旧版本", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("GitHub tag 根钉在旧版本时报版本不匹配，而不是静默报 unreachable", async () => {
    const fetch = vi.fn<typeof fetch>();
    await expect(
      resolveSourceServerReleaseAsset(
        probe,
        { remoteCdnBaseUrl: "https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.5" },
        target,
        { fetch },
      ),
    ).rejects.toThrow(/版本不匹配|不匹配/u);
    // 必须在发请求之前就 fail-fast，不能让用户等一轮 404。
    expect(fetch).not.toHaveBeenCalled();
  });

  it("纯版本号形态的旧根同样被拦下", async () => {
    const fetch = vi.fn<typeof fetch>();
    await expect(
      resolveSourceServerReleaseAsset(
        probe,
        { remoteCdnBaseUrl: "https://cdn.example.test/raspberrycode/electron/releases/0.2.5" },
        target,
        { fetch },
      ),
    ).rejects.toThrow(/版本不匹配|不匹配/u);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("根里的版本等于当前版本时正常放行（不得误杀正确配置）", async () => {
    const fetch = vi.fn<typeof fetch>(async () => {
      throw new Error("stop after version check passed");
    });
    await expect(
      resolveSourceServerReleaseAsset(
        probe,
        { remoteCdnBaseUrl: `https://cdn.example.test/releases/${RASPBERRYCODE_VERSION}` },
        target,
        { fetch },
      ),
    ).rejects.not.toThrow(/版本不匹配|不匹配/u);
    expect(fetch).toHaveBeenCalled();
  });

  it("不带版本段的根不触发版本校验（自建 CDN 注入形态）", async () => {
    const fetch = vi.fn<typeof fetch>(async () => {
      throw new Error("stop after version check passed");
    });
    await expect(
      resolveSourceServerReleaseAsset(
        probe,
        { remoteCdnBaseUrl: "https://cdn.example.test/raspberrycode/electron/releases" },
        target,
        { fetch },
      ),
    ).rejects.not.toThrow(/版本不匹配|不匹配/u);
    expect(fetch).toHaveBeenCalled();
  });
});
