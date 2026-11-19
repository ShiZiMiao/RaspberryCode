/**
 * Source Server 远程包的后台预下载。
 *
 * 背景：远端首次连接（或远端版本落后需要升级）时要先把 Source Server 包送到远端。
 * 包体积约 90MB/平台，即使走镜像（实测 1301KB/s）也要约 70 秒，直连更慢。
 * 这段时间用户只能看着连接进度条等。
 *
 * 而这类包的版本是「跟 Desktop 版本绑定的」——0.2.6 的 Desktop 永远只要 0.2.6 的包。
 * 因此完全可以在用户发起连接之前就把它下好，连接时直接命中本地缓存上传，
 * 省掉整段下载等待。缓存命中判定复用 `downloadArchive` 的 sha256 校验，
 * 预下载只是「提前把缓存填好」，不引入第二套信任模型。
 *
 * 边界（有意为之）：
 * - **只预取当前 Desktop 版本的包**。跨版本包没有用处：`readDescriptor` 要求
 *   descriptor.version 严格等于运行时版本，取回来也用不上。
 * - **只预取 Linux 两平台**。当前产品只在 Linux 上承载远端（见 `resolveReleaseAsset`
 *   的平台白名单）；macOS 暂不纳入，每多一个平台就多约 90MB 流量。
 * - **失败完全静默**。这是纯优化路径，任何失败都不能影响连接本身——
 *   真连的时候会重新走一次完整解析与下载，那条路径有自己的错误处理。
 * - **不并发抢占**。同一时刻只跑一次；已有缓存命中时直接跳过，不产生网络请求。
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { RASPBERRYCODE_VERSION } from "@raspberrycode/shared";
import type { RemoteAssetNetworkPort } from "@raspberrycode/server/remote/remoteAssetNetwork.js";
import type { SourceServerProbeResult } from "@raspberrycode/server/source-server";
import type { RemoteTarget } from "@raspberrycode/shared";
import type { WindowRemoteAssetDirs } from "./windowRemoteConnectionRegistry.js";
import { resolveSourceServerReleaseAsset } from "./sourceServerReleaseResolver.js";

type PrefetchTarget = { platform: "linux" | "darwin"; arch: "x64" | "arm64" };

/** 预取目标：Linux 两平台，与远端可部署白名单的 Linux 部分一致。 */
export const SOURCE_SERVER_PREFETCH_TARGETS: readonly PrefetchTarget[] = [
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
];

export interface SourceServerPrefetchOptions {
  remoteAssets: WindowRemoteAssetDirs;
  remoteAssetNetwork?: RemoteAssetNetworkPort;
  /** 诊断输出；预下载是后台行为，默认不打扰用户。 */
  log?: (message: string) => void;
  /** 只下指定目标；默认 `SOURCE_SERVER_PREFETCH_TARGETS`。测试用它收窄范围。 */
  targets?: readonly PrefetchTarget[];
}

export interface SourceServerPrefetchResult {
  target: string;
  /** `cached` = 本地已有，未产生本次下载；`downloaded` = 本次取回；`failed` = 失败（已静默）。 */
  outcome: "cached" | "downloaded" | "failed";
  message?: string;
}

/**
 * 预取结果里是否真的产生了网络下载。
 *
 * 用于让调用方区分「白跑一趟」与「确实下了东西」——启动日志据此决定要不要打印耗时。
 */
export function didPrefetchDownload(results: readonly SourceServerPrefetchResult[]): boolean {
  return results.some((result) => result.outcome === "downloaded");
}

/**
 * 构造一个仅用于「取包」的探测结果。
 *
 * `resolveReleaseAsset` 实际只读取 `platform` 与 `arch` 来决定 target 与 descriptor 条目，
 * 其余字段（installed / daemonStatus 等）只在连接流程里用。这里如实标注这一点，
 * 而不是把整个对象当作已有事实传下去。
 */
function createPrefetchProbe(target: PrefetchTarget): SourceServerProbeResult {
  return {
    platform: target.platform,
    arch: target.arch,
    // 预取与「远端是否已安装」无关：要的就是本版本可部署的包。
    installed: false,
  };
}

/**
 * 构造仅用于取包的远端目标。
 *
 * 传 `ssh` + `local-download-upload` 是刻意的：只有这个组合会让 `resolveReleaseAsset`
 * 走「下载到本地缓存」分支（`remote-download` 只返回 URL 不落盘，预下载就失去意义）。
 * host/username 不参与地址解析，仅占位；真正连接时会用 Profile 里的值。
 */
function createPrefetchTarget(): Exclude<RemoteTarget, { kind: "server" }> {
  return {
    kind: "ssh",
    host: "prefetch.invalid",
    port: 22,
    username: "prefetch",
    assetInstallMode: "local-download-upload",
  };
}

/**
 * 预取当前版本的 Linux 远程包到本地缓存。
 *
 * 返回每个目标的结果而不是抛错：预下载失败不能阻断连接，调用方只需记日志。
 */
export async function prefetchSourceServerReleases(
  options: SourceServerPrefetchOptions,
): Promise<SourceServerPrefetchResult[]> {
  const { remoteAssets, remoteAssetNetwork, log } = options;
  const targets = options.targets ?? SOURCE_SERVER_PREFETCH_TARGETS;
  const results: SourceServerPrefetchResult[] = [];

  // 没有缓存目录时预下载没有意义：`downloadArchive` 要求 cacheRoot，
  // 而这种情况真连接时也会以同样原因失败，不在启动阶段制造噪音。
  if (!remoteAssets.remoteCacheDir) {
    log?.("[source-server-prefetch] skipped: remoteCacheDir is not configured");
    return results;
  }

  const cacheRoot = remoteAssets.remoteCacheDir;
  const remoteTarget = createPrefetchTarget();

  for (const target of targets) {
    const targetKey = `${target.platform}-${target.arch}`;
    const alreadyCached = await hasCachedArchive(cacheRoot, targetKey);
    try {
      // metadataOnly=false 才会真正把 archive 落到缓存；这正是预下载想要的。
      await resolveSourceServerReleaseAsset(
        createPrefetchProbe(target),
        remoteAssets,
        remoteTarget,
        remoteAssetNetwork,
        { metadataOnly: false },
      );
      // 用「进循环前缓存是否已存在」判定，不额外维护一个「已下载」标记，
      // 避免标记与实际缓存状态分叉。
      const outcome = alreadyCached ? "cached" : "downloaded";
      log?.(`[source-server-prefetch] ${targetKey}: ${outcome}`);
      results.push({ target: targetKey, outcome });
    } catch (error) {
      // 预下载是优化路径：失败必须静默，真连接时会重新解析并给出面向用户的错误。
      const message = error instanceof Error ? error.message : String(error);
      log?.(`[source-server-prefetch] ${targetKey}: failed (${message})`);
      results.push({ target: targetKey, outcome: "failed", message });
    }
  }

  return results;
}

/**
 * 该平台 archive 是否已在缓存目录里。
 *
 * 只判存在性与非空（真正的 sha256 校验由 `downloadArchive` 在使用时做）。
 * 刻意不在这里重算 90MB 文件的哈希：启动阶段不该为一个乐观判断做整文件读取。
 */
async function hasCachedArchive(cacheRoot: string, targetKey: string): Promise<boolean> {
  const fileName = `raspberrycode-server-${targetKey}.tar.gz`;
  const path = join(cacheRoot, "source-server", RASPBERRYCODE_VERSION, fileName);
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}
