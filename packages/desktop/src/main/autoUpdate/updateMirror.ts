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
 * 镜像前缀**不写死**：第三方公益镜像生命周期不可控（ghfast.top 已对 atom 返回 403），
 * 由调用方从配置读取；本文件只提供内置默认值与候选列表用作兜底。
 *
 * 实现方式：不改 electron-updater 内部（其 provider 的下载 URL 由 baseUrl 拼装，
 * 且 resolveFiles 为私有方法、createClient 不可注入，无法靠配置接入路径前缀式镜像）。
 * 改为在 Electron session 的 webRequest 层重写请求的 URL。
 *
 * 本文件只放纯函数与状态机，便于单测；webRequest 接线在 updateMirrorSession.ts。
 */

/**
 * 候选镜像与默认前缀**不在此定义**，事实源是
 * `@raspberrycode/shared` 的 `client-update/contract.ts`。
 *
 * 为什么放在 shared：远程资产下载（`packages/server/src/remote/remoteAssetCdn.ts`）
 * 面对的是同一个网络问题，但它在另一个包里、跑在 Host 子进程的 undici 栈上
 * （Electron 的 `Session.setProxy` 影响不到它），代码无法复用。若两边各维护一份列表，
 * 必然出现「一边已切到新镜像、另一边还在用已失效旧镜像」的错位。
 * 共用一个常量让「发版前重跑探测、只改一处」成为可能。
 *
 * 这里重新导出，是为了既有调用方（autoUpdateService / index.ts / 测试）的导入路径不变。
 */
export {
  DEFAULT_UPDATE_MIRROR_CANDIDATES,
  DEFAULT_UPDATE_MIRROR_PREFIX,
} from "@raspberrycode/shared/client-update";

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
 * - **候选镜像轮换**：`mirror` 级内部还可能有多个候选前缀。某个候选失败时先换下一个
 *   候选（仍停留在 mirror 级），候选耗尽才降到 direct。这样单个公益镜像失效不会
 *   直接掉到慢速直连。
 */
export class UpdateDownloadFallback {
  private route: UpdateDownloadRoute = "mirror";
  private attemptKey: string | null = null;
  private succeeded = false;
  /** 当前使用的镜像前缀下标（指向构造时传入的候选列表）。 */
  private mirrorIndex = 0;
  /** 候选镜像列表；为空表示只用单一前缀（由外部 getMirrorPrefix 提供）。 */
  private mirrorCandidates: readonly string[] = [];

  get currentRoute(): UpdateDownloadRoute {
    return this.route;
  }

  get currentAttemptKey(): string | null {
    return this.attemptKey;
  }

  /** 当前镜像候选下标，供日志与测试断言。 */
  get currentMirrorIndex(): number {
    return this.mirrorIndex;
  }

  /**
   * 设置候选镜像列表（通常由配置注入）。
   *
   * **已轮换过时不清零下标**：降级重试会重复进入检查流程，每次都调用本方法；
   * 若无条件重置为 0，刚轮换到的第 2 家会被打回第 1 家，形成「反复撞同一面墙」的死循环。
   * 只有候选列表内容真的变了才重置（配置切换语义）。
   */
  setMirrorCandidates(candidates: readonly string[]): void {
    const next = candidates.filter((prefix) => prefix.trim().length > 0);
    const changed =
      next.length !== this.mirrorCandidates.length ||
      next.some((prefix, index) => prefix !== this.mirrorCandidates[index]);
    this.mirrorCandidates = next;
    if (changed) {
      this.mirrorIndex = 0;
    } else {
      // 内容未变：夹紧越界（例如候选配置被外部改小过又改回）。
      this.mirrorIndex = Math.min(this.mirrorIndex, Math.max(0, next.length - 1));
    }
  }

  /**
   * 当前生效的镜像前缀。
   * 候选列表为空时返回传入的 fallback（调用方的配置值或内置默认）。
   */
  currentMirrorPrefix(fallback: string): string {
    const candidate = this.mirrorCandidates[this.mirrorIndex];
    return candidate ?? fallback;
  }

  beginAttempt(version: string): UpdateDownloadRoute {
    this.attemptKey = buildDownloadAttemptKey(version);
    this.route = "mirror";
    this.succeeded = false;
    // 新一轮尝试重新从第一个候选镜像起步：上次那个候选可能只是临时故障。
    this.mirrorIndex = 0;
    return this.route;
  }

  /**
   * 开新一轮尝试，但**保留当前镜像候选下标**。
   *
   * 用于「检查阶段已经轮换过候选」的场景：检查用 gh-proxy 失败后切到第二家成功，
   * 下载必须继续用第二家。若调用 beginAttempt 会把下标清零、重新撞同一面墙。
   *
   * 与 beginAttempt 的区别只有镜像下标；route 仍重置为 mirror（因为要重新开始下载）。
   */
  beginAttemptKeepingMirror(version: string): UpdateDownloadRoute {
    const keptIndex = this.mirrorIndex;
    this.beginAttempt(version);
    // 候选列表可能在上次与本次之间变化，夹紧避免越界。
    this.mirrorIndex = Math.min(keptIndex, Math.max(0, this.mirrorCandidates.length - 1));
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
   *
   * mirror 级内部先轮换候选镜像，全部候选用尽后再降到 direct。
   * 候选列表为空（单一前缀模式）时行为与旧版一致：mirror → direct → manual。
   */
  advance(): UpdateDownloadRoute {
    if (this.succeeded) return this.route;
    if (this.route === "mirror") {
      if (this.mirrorIndex + 1 < this.mirrorCandidates.length) {
        this.mirrorIndex += 1;
        return this.route;
      }
      this.route = "direct";
      return this.route;
    }
    if (this.route === "direct") this.route = "manual";
    return this.route;
  }

  /** 取消或结束后清理，避免下一次下载继承旧状态。 */
  reset(): void {
    this.route = "mirror";
    this.attemptKey = null;
    this.succeeded = false;
    this.mirrorIndex = 0;
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
