/**
 * 自更新下载镜像（spec：specs/client-github-self-update.md 产品规则 10）。
 *
 * 背景：GitHub Releases 的元数据与资产域名在部分网络下不可达或极慢。实测同一 183MB
 * 安装包：直连约 34KB/s，经 gh-proxy.com 前缀镜像约 9.6MB/s（约 20 秒）。
 *
 * 关键约束（2026-11-23 实测）：检查阶段同样需要镜像。electron-updater 的 github provider
 * 每次检查发三条请求（releases.atom / releases/latest / releases/download/<tag>/latest.yml），
 * 只重写第三条会让无代理用户在第一条就超时（报 ERR_CONNECTION_TIMED_OUT）。
 * 因此 mirror 阶段拦截 github.com 全站——GitHubProvider 全程不访问 api.github.com，
 * 放宽范围不会误伤 API 请求。
 *
 * 策略（三级回退）：
 *  1. 优先镜像：`https://github.com/<owner>/<repo>/...`
 *     → `https://<mirror>/https://github.com/<owner>/<repo>/...`
 *  2. 镜像失败 → 直连（空前缀，行为与改造前一致）
 *  3. 直连也失败 → 进入 manual-required，UI 提供「手动下载」把 release 页交给浏览器
 *
 * 默认镜像固定为 `https://gh-proxy.org/`（2026-11-26 实测通过 atom / Range /
 * latest.yml 三项判据）。镜像前缀仍可由 setting.json 的 `updateMirrorPrefix`
 * 覆盖或设为空串（只走直连），无需发版。
 *
 * 实现方式：不改 electron-updater 内部（其 provider 的下载 URL 由 baseUrl 拼装，
 * 且 resolveFiles 为私有方法、createClient 不可注入，无法靠配置接入路径前缀式镜像）。
 * 改为在 Electron session 的 webRequest 层重写请求的 URL。
 *
 * 本文件只放纯函数与状态机，便于单测；webRequest 接线在 updateMirrorSession.ts。
 */

/**
 * 默认镜像前缀**不在此定义**，事实源是
 * `@raspberrycode/shared` 的 `client-update/contract.ts`。
 *
 * 为什么放在 shared：远程资产下载（`packages/server/src/remote/remoteAssetCdn.ts`）
 * 面对的是同一个网络问题，但它在另一个包里、跑在 Host 子进程的 undici 栈上
 * （Electron 的 `Session.setProxy` 影响不到它），代码无法复用。两边共用一份常量，
 * 避免「一边已切到新镜像、另一边还在用旧镜像」的错位。
 *
 * 这里重新导出，是为了既有调用方（autoUpdateService / index.ts / 测试）的导入路径不变。
 */
export { DEFAULT_UPDATE_MIRROR_PREFIX } from "@raspberrycode/shared/client-update";

/** 下载请求的规范源站；镜像与直连都以它为判断依据。 */
export const GITHUB_DOWNLOAD_ORIGIN = "https://github.com";

/** 回退层级：mirror → direct → manual。 */
export type UpdateDownloadRoute = "mirror" | "direct" | "manual";

/**
 * 判断请求是否应被镜像重写。
 *
 * 覆盖 `github.com` 全站而非仅 `/releases/download/`：检查阶段的第一步是
 * `releases.atom`，若不放行就永远轮不到下载阶段（实测无代理用户必现超时）。
 *
 * 排除 `api.github.com` 是安全的必要保险：GitHubProvider 不使用它，
 * 但自定义 host / GitHub Enterprise 场景可能使用，不应改写。
 */
export function isGithubMirrorTarget(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== GITHUB_DOWNLOAD_ORIGIN) return false;
    // /<owner>/<repo>/ 之后必须还有内容，避免把 github.com 首页也改写。
    return /^\/[^/]+\/[^/]+\/.+/.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * 兼容旧名：仅判断「release 资产下载」请求。
 *
 * 保留导出是因为既有测试与调用方按此语义断言；新代码应改用
 * `isGithubMirrorTarget`（覆盖检查阶段的元数据请求）。
 */
export function isGithubReleaseDownloadUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== GITHUB_DOWNLOAD_ORIGIN) return false;
    return /^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/.+/.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * 把 GitHub 下载地址改写为镜像地址。
 *
 * 镜像采用「前缀 + 完整原 URL」的形式（ghfast.top / ghproxy 系均如此），
 * 因此不能只替换 host：`https://ghfast.top/owner/repo/...` 会 403。
 */
export function toMirrorUrl(rawUrl: string, mirrorPrefix: string): string {
  const prefix = mirrorPrefix.trim();
  if (!prefix) return rawUrl;
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return `${normalizedPrefix}${rawUrl}`;
}

/** 由 route 决定实际请求 URL；manual 不发起请求，返回 null。 */
export function resolveDownloadUrl(
  rawUrl: string,
  route: UpdateDownloadRoute,
  mirrorPrefix: string,
): string | null {
  if (route === "manual") return null;
  if (route === "direct") return rawUrl;
  const mirrored = toMirrorUrl(rawUrl, mirrorPrefix);
  // 镜像前缀为空等价于直连，避免无限自指。
  return mirrored === rawUrl ? rawUrl : mirrored;
}

/** 一次下载尝试的归属键：同一版本的同一次下载共享回退状态。 */
export function buildDownloadAttemptKey(version: string): string {
  return `v${version.replace(/^v/, "")}`;
}

/**
 * 手动下载回退地址：release 详情页（而非资产直链）。
 *
 * 之所以给页面而不是 `.exe` 直链：直链同样会被网络问题挡住，
 * 让用户自己在浏览器里换网络/用下载工具选择资产更实际。
 */
export function buildManualDownloadUrl(owner: string, repo: string, tag?: string): string {
  const base = `${GITHUB_DOWNLOAD_ORIGIN}/${owner}/${repo}/releases`;
  return tag ? `${base}/tag/${tag.startsWith("v") ? tag : `v${tag}`}` : `${base}/latest`;
}

/**
 * 下载回退状态机。
 *
 * 设计要点：
 * - 每次 `beginAttempt` 从 mirror 起步（用户重试时也重新给镜像一次机会，
 *   不因上次直连成功就永久跳过镜像）。
 * - `advance(route)` 返回下一级；到 manual 后不再变化。
 * - 某级「成功」（收到首块数据或完成）后由调用方 `markSucceeded`，
 *   该次对话内不再降级，避免下载中途反复横跳导致文件损坏。
 */
export class UpdateDownloadFallback {
  private route: UpdateDownloadRoute = "mirror";
  private attemptKey: string | null = null;
  private succeeded = false;

  get currentRoute(): UpdateDownloadRoute {
    return this.route;
  }

  get currentAttemptKey(): string | null {
    return this.attemptKey;
  }

  beginAttempt(version: string): UpdateDownloadRoute {
    this.attemptKey = buildDownloadAttemptKey(version);
    this.route = "mirror";
    this.succeeded = false;
    return this.route;
  }

  /** 标记该次下载已经收到有效数据，锁定当前 route 不再降级。 */
  markSucceeded(): void {
    this.succeeded = true;
  }

  get hasSucceeded(): boolean {
    return this.succeeded;
  }

  /**
   * 仅在尚未成功时允许降级；返回降级后的 route。
   * 固定链路：mirror → direct → manual，到 manual 后不再变化。
   */
  advance(): UpdateDownloadRoute {
    if (this.succeeded) return this.route;
    if (this.route === "mirror") this.route = "direct";
    else if (this.route === "direct") this.route = "manual";
    return this.route;
  }

  /** 取消或结束后清理，避免下一次下载继承旧状态。 */
  reset(): void {
    this.route = "mirror";
    this.attemptKey = null;
    this.succeeded = false;
  }

  /**
   * 只更新归属键、保留当前路线与成功标记。
   *
   * 用于「检查阶段已降级」的场景：下载沿用已降级到的 direct，不再回退到 mirror
   * 重蹈同一个失败；同时把 attemptKey 从 "check" 换成真实版本号。
   */
  resetAttemptKey(version: string): void {
    this.attemptKey = buildDownloadAttemptKey(version);
  }
}
