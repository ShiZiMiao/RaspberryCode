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
  session: Session;
}

/**
 * 安装下载请求改写。返回卸载函数（测试与热重载用）。
 *
 * 注意 Electron 的 webRequest 同一事件只能有一个监听器生效，
 * 重复调用会覆盖前一个，因此这里只做幂等安装。
 */
export function installUpdateMirrorRedirect(options: UpdateMirrorInstallOptions): () => void {
  const { session, getRoute, mirrorPrefix = DEFAULT_UPDATE_MIRROR_PREFIX } = options;
  const { webRequest } = session;

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
