/**
 * 把自更新下载镜像接到 Electron session 的 webRequest 层。
 *
 * 为什么在这一层：electron-updater 的 GitHubProvider 下载 URL 由 baseUrl 拼装，
 * resolveFiles 是私有方法、createClient 也不可注入，无法靠 PublishConfiguration
 * 接入「前缀 + 完整原 URL」形态的镜像（实测只换 host 会 403）。
 * onBeforeRequest 的 redirectURL 是唯一无需 fork 依赖的接入点。
 *
 * 约束：
 * - 只重写 release 资产下载（isGithubReleaseDownloadUrl），不影响 API 元数据请求。
 * - 直连阶段不注册任何重定向（行为回到改造前）。
 * - 该监听器全局生效于传入的 session，故必须在应用启动时只安装一次。
 */
import type { Session } from "electron";
import { logger } from "../logger.js";
import {
  DEFAULT_UPDATE_MIRROR_PREFIX,
  isGithubReleaseDownloadUrl,
  resolveDownloadUrl,
  type UpdateDownloadRoute,
} from "./updateMirror.js";

export interface UpdateMirrorInstallOptions {
  /** 镜像前缀；空字符串表示禁用镜像（等价于只走直连）。 */
  mirrorPrefix?: string;
  /** 当前下载阶段由 UpdateDownloadFallback 决定；mirror / direct / manual。 */
  getRoute: () => UpdateDownloadRoute;
  /**
   * 目标 session。默认取 electron-updater 自己的 partition。
   *
   * 关键：electron-updater 的下载走 `session.fromPartition("electron-updater")`
   * （见 electron-updater/out/electronHttpExecutor.js 的 NET_SESSION_NAME），
   * 不是 defaultSession。装在 defaultSession 上对下载请求完全不生效——
   * v0.2.0 首次实测即因此零重定向。测试可注入 fake session。
   */
  session?: Session;
  /** 构造 session 的工厂；仅测试用，生产走 electron 的 session.fromPartition。 */
  resolveSession?: () => Session;
  /**
   * 按当前阶段切换该 session 的代理模式；不传则不切换（沿用外部已配置的代理）。
   *
   * 为什么必须切：镜像与 GitHub 在这里是**互斥**的两条网络路径。
   * 实测（2026-11-13，系统代理 127.0.0.1:7897 可访问 GitHub）：
   *   - ghfast.top 直连 200，经 7897 代理 ERR_CONNECTION_CLOSED
   *   - github.com  直连 RESET，经 7897 代理 200
   * 若统一跟随系统代理，镜像请求会被代理劫持而全灭；若统一直连，GitHub 又不通。
   * 因此按阶段切换：mirror 阶段 direct，direct 阶段 system。
   */
  applyProxyForRoute?: (route: UpdateDownloadRoute) => Promise<void>;
}

/** electron-updater 使用的 session partition 名（与上游保持一致，勿改）。 */
export const UPDATER_SESSION_PARTITION = "electron-updater";

/**
 * 安装下载请求改写。返回卸载函数（测试与热重载用）。
 *
 * 注意 Electron 的 webRequest 同一事件只能有一个监听器生效，
 * 重复调用会覆盖前一个，因此这里只做幂等安装。
 */
export function installUpdateMirrorRedirect(options: UpdateMirrorInstallOptions): () => void {
  const { getRoute, mirrorPrefix = DEFAULT_UPDATE_MIRROR_PREFIX, resolveSession } = options;
  const session = options.session ?? resolveSession?.();
  if (!session) {
    throw new Error("[auto-update] update mirror requires a session or resolveSession");
  }
  const { webRequest } = session;

  // 代理切换在「阶段变化」时进行，而不是在请求回调里做：回调是同步的，
  // 而 setProxy 是异步的，在回调里切会来不及作用于当前请求。
  let appliedRoute: UpdateDownloadRoute | null = null;
  const applyProxyIfNeeded = (route: UpdateDownloadRoute): void => {
    if (!options.applyProxyForRoute || appliedRoute === route) return;
    appliedRoute = route;
    void options.applyProxyForRoute(route).catch((error: unknown) => {
      logger.warn(`[auto-update] apply proxy for route=${route} failed:`, error);
    });
  };

  const listener = (
    details: Electron.OnBeforeRequestListenerDetails,
    callback: (response: Electron.CallbackResponse) => void,
  ): void => {
    const route = getRoute();
    if (route === "manual") {
      // 手动阶段不应再发起更新下载；放行让上层超时收口。
      callback({});
      return;
    }
    if (!isGithubReleaseDownloadUrl(details.url)) {
      callback({});
      return;
    }
    // 语义保底：某个阶段第一次出现的请求，先把该阶段的代理切好再放行。
    // 命中缓存（appliedRoute 相同）时不重复切，热路径无额外开销。
    applyProxyIfNeeded(route);
    const target = resolveDownloadUrl(details.url, route, mirrorPrefix);
    if (!target || target === details.url) {
      callback({});
      return;
    }
    logger.info(
      `[auto-update] mirror redirect route=${route} url=${shorten(details.url)} -> ${shorten(target)}`,
    );
    callback({ redirectURL: target });
  };

  webRequest.onBeforeRequest({ urls: ["https://github.com/*"] }, listener);
  logger.info(
    `[auto-update] mirror redirect installed: partition=${session.storagePath ?? "n/a"} prefix=${mirrorPrefix || "(direct only)"}`,
  );

  return () => {
    // Electron 不提供移除单个 listener 的 API；置空等价于不重定向。
    webRequest.onBeforeRequest(null);
  };
}

function shorten(url: string): string {
  const index = url.indexOf("/releases/download/");
  if (index < 0) return url.length > 96 ? `${url.slice(0, 96)}…` : url;
  return `…${url.slice(index)}`;
}
