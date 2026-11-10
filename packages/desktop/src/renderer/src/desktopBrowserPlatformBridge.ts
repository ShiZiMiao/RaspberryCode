import type { IPlatformService } from "@raspberrycode/shared";

type DesktopBrowserPlatformBridge = Pick<
  IPlatformService,
  | "onBrowserViewDownloadStarted"
  | "onBrowserViewReady"
  | "onBrowserViewOperation"
  | "onBrowserViewViewportChanged"
  | "onBrowserViewVisibility"
  | "onBrowserViewCloseTab"
  | "onBrowserViewSuspend"
  | "onBrowserViewRestore"
  | "browserViewLoadUrl"
  | "browserViewAttachGuest"
  | "browserViewDetachGuest"
  | "browserViewCloseTab"
  | "browserViewReportResidency"
  | "browserViewSuspendReady"
  | "browserViewEnsureResident"
  | "browserViewRestoreTabs"
  | "browserViewUpdateViewport"
  | "importChromeBrowserData"
  | "clearEmbeddedBrowserData"
  | "getPathForFile"
  | "saveFile"
  | "printPageToPdf"
>;

// Rebase 集成：browser bridge 若继续内联在 renderer 入口，会让入口越过 max-lines 门禁。
// 独立对象只做 preload 委托与旧 bridge 兼容兜底，不持有 Browser 业务状态。
export const desktopBrowserPlatformBridge = {
  getPathForFile: (file) => window.raspberrycode.getPathForFile?.(file) ?? null,
  saveFile: (payload) =>
    window.raspberrycode.saveFile?.(payload) ?? Promise.resolve({ success: false, error: "not_supported" }),
  // 条件定义而非兜底返回失败：UI 靠方法是否存在做能力检测，旧 preload 下必须保持 undefined
  printPageToPdf: window.raspberrycode.printPageToPdf ? () => window.raspberrycode.printPageToPdf!() : undefined,
  onBrowserViewDownloadStarted: (handler) =>
    window.raspberrycode.onBrowserViewDownloadStarted?.(handler) ?? (() => {}),
  onBrowserViewReady: (handler) => window.raspberrycode.onBrowserViewReady?.(handler) ?? (() => {}),
  onBrowserViewOperation: (handler) => window.raspberrycode.onBrowserViewOperation?.(handler) ?? (() => {}),
  onBrowserViewViewportChanged: (handler) =>
    window.raspberrycode.onBrowserViewViewportChanged?.(handler) ?? (() => {}),
  onBrowserViewVisibility: (handler) =>
    window.raspberrycode.onBrowserViewVisibility?.(handler) ?? (() => {}),
  onBrowserViewCloseTab: (handler) => window.raspberrycode.onBrowserViewCloseTab?.(handler) ?? (() => {}),
  onBrowserViewSuspend: (handler) => window.raspberrycode.onBrowserViewSuspend?.(handler) ?? (() => {}),
  onBrowserViewRestore: (handler) => window.raspberrycode.onBrowserViewRestore?.(handler) ?? (() => {}),
  browserViewLoadUrl: (payload) => window.raspberrycode.browserViewLoadUrl!(payload),
  browserViewAttachGuest: (payload) =>
    window.raspberrycode.browserViewAttachGuest?.(payload) ??
    // 兜底字面量经显式泛型收窄（"not-found" 是合法拒绝原因）；裸 Promise.resolve 会把
    // 字面量类型拓宽成 { ok: boolean; reason: string }，与判别联合不兼容（TS2322）。
    Promise.resolve<import("@raspberrycode/shared").BrowserGuestAttachResult>({
      ok: false,
      reason: "not-found",
      recoveryRequested: false,
    }),
  browserViewDetachGuest: (payload) =>
    window.raspberrycode.browserViewDetachGuest?.(payload) ?? Promise.resolve(false),
  browserViewCloseTab: (payload) =>
    window.raspberrycode.browserViewCloseTab?.(payload) ?? Promise.resolve(),
  browserViewReportResidency: (payload) =>
    window.raspberrycode.browserViewReportResidency?.(payload) ?? Promise.resolve(),
  browserViewSuspendReady: (payload) =>
    window.raspberrycode.browserViewSuspendReady?.(payload) ?? Promise.resolve(),
  browserViewEnsureResident: (payload) =>
    window.raspberrycode.browserViewEnsureResident?.(payload) ?? Promise.resolve(),
  browserViewRestoreTabs: (payload) =>
    window.raspberrycode.browserViewRestoreTabs?.(payload) ?? Promise.resolve([]),
  browserViewUpdateViewport: (payload) =>
    window.raspberrycode.browserViewUpdateViewport?.(payload) ?? Promise.resolve(),
  importChromeBrowserData: (options) =>
    window.raspberrycode.importChromeBrowserData?.(options) ??
    // 同上：兜底对象经显式泛型收窄，避免字面量拓宽后与结果类型不兼容（TS2322）。
    Promise.resolve<import("@raspberrycode/shared").ChromeBrowserDataImportResult>({
      success: false,
      cookies: { imported: 0, skipped: 0, failed: 0 },
      localStorage: {
        originsImported: 0,
        entriesImported: 0,
        originsSkipped: 0,
        originsFailed: 0,
      },
      error: "chrome_browser_data_import_unavailable",
    }),
  clearEmbeddedBrowserData: (mode) =>
    window.raspberrycode.clearEmbeddedBrowserData?.(mode) ??
    Promise.resolve({ success: false, error: "unsupported" }),
} satisfies DesktopBrowserPlatformBridge;
