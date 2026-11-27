import { posix } from "node:path";
import { DEFAULT_UPDATE_MIRROR_PREFIX } from "@raspberrycode/shared/client-update";

export interface RemoteCdnBaseOptions {
  remoteCdnBaseUrl?: string;
  remoteCdnBaseUrls?: string[];
}

export function resolveRemoteCdnBaseUrls(options: RemoteCdnBaseOptions): string[] {
  const candidates = [...(options.remoteCdnBaseUrls ?? []), options.remoteCdnBaseUrl ?? ""]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(candidates));
}

/**
 * 判断发布根是否**已经带版本段**，即调用方不需要再追加 `/version`。
 *
 * 版本段的两种真实形态都要认：
 *   1. 纯版本号结尾：`.../releases/0.2.5`（自建 CDN/OSS 布局）；
 *   2. 带 v 前缀的 tag 结尾：`.../releases/download/v0.2.5`（GitHub Release 布局）。
 *
 * 只判断第 1 种会让 GitHub 形态漏判，多拼一级 `/0.2.5` 得到
 * `.../download/v0.2.5/0.2.5`，实测 404（2026-11-19 端到端实测确认）。
 *
 * ⚠️ 这个判定必须**只有这一份实现**。0.2.7 发出去后 SSH 全部连不上，根因就是
 * 构建期注入的是已带版本段的完整根（`.../download/v0.2.7`），而 Desktop main 侧
 * 另写了一段「无条件拼 `/version`」的逻辑，拼出 `.../download/v0.2.7/0.2.7`。
 * 两处各自看都「合理」，接起来就是必然 404。
 */
export function isReleaseRootAlreadyVersioned(releaseRoot: string, version: string): boolean {
  const normalizedBase = releaseRoot.replace(/\/+$/, "");
  return normalizedBase.endsWith(`/${version}`) || normalizedBase.endsWith(`/v${version}`);
}

export function buildReleaseBaseCandidates(remoteCdnBaseUrls: string[], version: string): string[] {
  const candidates = remoteCdnBaseUrls.flatMap((remoteCdnBaseUrl) => {
    const normalizedBase = remoteCdnBaseUrl.replace(/\/+$/, "");
    // 当调用方已经传入带版本的 CDN 基址时，继续盲目拼 `${base}/${version}`
    // 会先走一次必然失败的双版本路径（例如 .../0.2.10/0.2.10），产生无意义 404 噪音。
    if (isReleaseRootAlreadyVersioned(normalizedBase, version)) {
      return [normalizedBase];
    }
    return [`${normalizedBase}/${version}`, normalizedBase];
  });
  return Array.from(new Set(candidates));
}

/**
 * GitHub 下载镜像前缀的默认值——**与应用自更新共用同一份事实源**。
 *
 * 取值来自 `@raspberrycode/shared/client-update` 的 `DEFAULT_UPDATE_MIRROR_PREFIX`
 * （2026-11-26 实测通过 atom / Range / latest.yml 三项判据）。
 *
 * 为什么共用而不是各自维护：远程 Source Server 包约 90MB/平台，直连 GitHub 实测 390KB/s
 * （整包约 8 分钟），经镜像 835KB/s（约 2 分钟）；网络差的时段直连可掉到 50KB/s 以下，
 * 一次远端升级要等十几分钟。**这与应用更新遇到的是同一个网络问题、同一批镜像**。
 * 若两边各写一份，必然出现「客户端已切到新镜像、远程资产还在用旧镜像」的错位。
 *
 * 镜像形态是「路径式」：保留 GitHub 的 `/<owner>/<repo>/releases/download/` 路径，
 * 只替换源站（`https://<mirror>/<owner>/<repo>/...`）。只对 GitHub 的 release 资产
 * 下载有效，因此仅当 URL 落在 github.com 的 `/<owner>/<repo>/releases/download/`
 * 路径下才追加候选。自建 CDN/OSS 不加。
 */
export const DEFAULT_REMOTE_ASSET_MIRROR_PREFIX: string = DEFAULT_UPDATE_MIRROR_PREFIX;

/** 判断是否为 GitHub release 资产下载地址（与会话更新镜像同一判定口径）。 */
export function isGithubReleaseDownloadUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== "https://github.com") return false;
    return /^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/.+/u.test(url.pathname);
  } catch {
    return false;
  }
}

/** 把 GitHub 下载地址改写为路径式镜像地址；前缀为空或非 GitHub 地址时原样返回。 */
export function toRemoteAssetMirrorUrl(rawUrl: string, mirrorPrefix: string): string {
  const prefix = mirrorPrefix.trim();
  if (!prefix) return rawUrl;
  if (!isGithubReleaseDownloadUrl(rawUrl)) return rawUrl;
  // 已经是镜像地址时不重复加前缀（否则回退链会拼出 https://m/https://m/https://...）。
  if (rawUrl.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)) return rawUrl;
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const parsed = new URL(rawUrl);
  return `${normalizedPrefix}${parsed.pathname.replace(/^\/+/u, "")}${parsed.search}`;
}

/**
 * 为一批发布根生成「镜像优先、直连兜底」的 URL 候选。
 *
 * 顺序刻意是镜像在前：镜像命中就省下一次直连的 8 分钟等待；镜像不可用时
 * 才走直连。调用方（descriptor 解析、archive 下载）都是「按顺序试，首个成功即用」，
 * 所以顺序直接决定正常路径的快慢。
 *
 * 注意：不能让镜像成为**唯一**候选。镜像服务稳定性不受我们控制，
 * 一旦它挂了而直连还在，缺兜底会让远端升级直接失败。
 */
export function withGithubMirror(
  urls: readonly string[],
  mirrorPrefix: string = DEFAULT_UPDATE_MIRROR_PREFIX,
): string[] {
  const prefix = mirrorPrefix.trim();
  if (!prefix) return [...urls];
  const mirrored: string[] = [];
  for (const url of urls) {
    const candidate = toRemoteAssetMirrorUrl(url, prefix);
    if (candidate !== url) mirrored.push(candidate);
  }
  // 镜像候选整体排在前，直连候选整体排在后：同一文件先镜像后直连，
  // 而不是逐个文件交错（否则每个文件都要先吃一次镜像失败）。
  return Array.from(new Set([...mirrored, ...urls]));
}

export function buildReleaseAssetUrlCandidates(
  releaseBaseCandidates: string[],
  fileCandidates: string[],
): string[] {
  const urls: string[] = [];
  for (const fileCandidate of fileCandidates) {
    const normalizedFileCandidate = normalizeRemoteAssetRelativePath(
      fileCandidate,
      "release asset path",
    );
    for (const releaseBaseCandidate of releaseBaseCandidates) {
      urls.push(joinCdnUrl(releaseBaseCandidate, normalizedFileCandidate));
    }
  }
  return Array.from(new Set(urls));
}

export function buildArtifactUrlCandidates(
  remoteCdnBaseUrls: string[],
  artifactPath: string,
): string[] {
  const normalizedArtifactPath = normalizeRemoteAssetRelativePath(artifactPath, "artifactPath");
  const urls = remoteCdnBaseUrls.map((remoteCdnBaseUrl) =>
    joinCdnUrl(remoteCdnBaseUrl, normalizedArtifactPath),
  );
  return Array.from(new Set(urls));
}

export function buildComponentArtifactUrlCandidates(
  releaseBaseCandidates: string[],
  artifactPath: string,
  version: string,
): string[] {
  return buildArtifactUrlCandidates(
    buildComponentReleaseBaseCandidates(releaseBaseCandidates, version),
    artifactPath,
  );
}

export function buildComponentReleaseBaseCandidates(
  releaseBaseCandidates: string[],
  version: string,
): string[] {
  const candidates = releaseBaseCandidates.flatMap((releaseBaseCandidate) => {
    const normalizedBase = releaseBaseCandidate.replace(/\/+$/, "");
    if (normalizedBase.endsWith(`/${version}`)) {
      // 当前 CI 只把 component artifact 上传到跨版本 components 根目录。
      // 因此运行时应先探测父级 release root，避免每个组件都先命中一次已停止发布的版本化路径。
      return [normalizedBase.slice(0, -version.length - 1), normalizedBase];
    }
    return [normalizedBase];
  });
  return Array.from(new Set(candidates.filter((candidate) => candidate.length > 0)));
}

export function normalizeRemoteAssetRelativePath(rawPath: string, label: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error(`[remote-assets] ${label} is empty`);
  }
  if (trimmed.includes("\\")) {
    throw new Error(`[remote-assets] ${label} must not contain backslash: ${rawPath}`);
  }
  if (trimmed.startsWith("/") || /^[A-Za-z]:/u.test(trimmed)) {
    throw new Error(`[remote-assets] ${label} must be relative path: ${rawPath}`);
  }

  const rawSegments = trimmed.split("/");
  if (rawSegments.some((segment) => segment.length === 0)) {
    throw new Error(`[remote-assets] ${label} contains empty path segment: ${rawPath}`);
  }
  if (rawSegments.includes("..")) {
    throw new Error(`[remote-assets] ${label} must not contain '..': ${rawPath}`);
  }
  if (rawSegments.includes(".")) {
    throw new Error(`[remote-assets] ${label} must not contain '.': ${rawPath}`);
  }

  const normalized = posix.normalize(trimmed);
  const normalizedSegments = normalized.split("/");
  if (
    normalizedSegments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new Error(`[remote-assets] ${label} is invalid after normalize: ${rawPath}`);
  }

  return normalizedSegments.join("/");
}

export function assertRemoteCdnBaseVersionMatches(
  remoteCdnBaseUrls: string[],
  expectedVersion: string,
): void {
  const mismatchedBases = remoteCdnBaseUrls.flatMap((remoteCdnBaseUrl) => {
    const pinnedVersion = extractPinnedReleaseVersionFromCdnBaseUrl(remoteCdnBaseUrl);
    if (!pinnedVersion || pinnedVersion === expectedVersion) {
      return [];
    }

    return [{ remoteCdnBaseUrl, pinnedVersion }];
  });
  if (mismatchedBases.length === 0) {
    return;
  }

  // 开发态常会临时覆盖 RASPBERRYCODE_REMOTE_ASSET_CDN_BASE_URL 做分支联调。
  // 如果把基址固定到旧版本（如 .../0.2.7）但客户端已经是 0.2.10，
  // 之前会把旧 remote-assets 落到新版本缓存目录，最终在 deploy 阶段才报 bundle 版本不匹配。
  // 这里前置做版本锁校验，避免“下载成功但后续部署失败”的误导性体验。
  throw new Error(
    `[remote-assets] remoteCdnBaseUrl 版本不匹配：当前应用版本是 ${expectedVersion}，但以下基址固定在其他版本：` +
      `${mismatchedBases.map(({ remoteCdnBaseUrl, pinnedVersion }) => `${pinnedVersion} (${remoteCdnBaseUrl})`).join(", ")}。` +
      `请将 RASPBERRYCODE_REMOTE_ASSET_CDN_BASE_URL 改为不带版本的发布根目录，或改为 ${expectedVersion} 对应目录。`,
  );
}

function joinCdnUrl(baseUrl: string, relativePath: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  // 组件版本里会带 '+'（如 v1.3.0+abcd），直接拼 URL 会在部分 CDN 侧命中失败（404）。
  // 这里按路径段做 URL 编码，保证对象 key 与下载 URL 一致（+ -> %2B）。
  const encodedRelativePath = encodeRelativePathForUrl(relativePath);
  return `${normalizedBase}/${encodedRelativePath}`;
}

function encodeRelativePathForUrl(relativePath: string): string {
  return relativePath
    .split("/")
    .map((segment) => encodePathSegment(segment))
    .join("/");
}

function encodePathSegment(segment: string): string {
  // 兼容已编码输入：先尝试解码再编码，避免把 %2B 再编码成 %252B。
  // 若输入包含非法 '%' 序列则回退到直接编码，确保不会抛异常。
  try {
    return encodeURIComponent(decodeURIComponent(segment));
  } catch {
    return encodeURIComponent(segment);
  }
}

function extractPinnedReleaseVersionFromCdnBaseUrl(remoteCdnBaseUrl: string): string | null {
  const normalizedBase = remoteCdnBaseUrl.replace(/\/+$/, "");
  const parsedPathname = tryParseUrlPathname(normalizedBase);
  const pathname = parsedPathname ?? normalizedBase;
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const lastSegment = segments.at(-1);
  if (!lastSegment) {
    return null;
  }

  const pinnedVersion = normalizePinnedReleaseVersion(lastSegment);
  return isSemverLike(pinnedVersion) ? pinnedVersion : null;
}

/**
 * 去掉版本段可能带的 `v` 前缀，归一成可与 `RASPBERRYCODE_VERSION` 直接比较的裸版本号。
 *
 * 为什么必须归一（0.2.8 用户反馈的缺陷）：GitHub Release 的根是
 * `.../releases/download/v0.2.5`，语义版本却写作 `0.2.5`。此前 `isSemverLike`
 * 的锚定正则以数字开头，`v0.2.5` 提取结果为 `null`，而 `null` 在
 * `assertRemoteCdnBaseVersionMatches` 里的语义是「这个根没钉版本」→ **直接放行**。
 * 于是最该被拦下的形态（GitHub tag 根钉死在旧版本）恰好是唯一逃过校验的形态。
 *
 * 口径必须与 `isReleaseRootAlreadyVersioned` 一致：它同时认 `/0.2.5` 与 `/v0.2.5`。
 */
function normalizePinnedReleaseVersion(value: string): string {
  return value.startsWith("v") ? value.slice(1) : value;
}

function tryParseUrlPathname(urlOrPath: string): string | null {
  try {
    return new URL(urlOrPath).pathname;
  } catch {
    return null;
  }
}

function isSemverLike(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(value);
}
