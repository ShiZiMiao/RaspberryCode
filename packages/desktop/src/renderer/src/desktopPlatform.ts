import { recordArmsCustomEventForE2E } from "@raspberrycode/ui";
import { DesktopCommandIds, buildLocalMediaPreviewUrl, type IPlatformService } from "@raspberrycode/shared";

import { desktopBrowserPlatformBridge } from "./desktopBrowserPlatformBridge.js";
import { createDesktopPluginSandboxPlatform } from "./plugin-sandbox/desktopPluginSandboxPlatform.js";

export function createDesktopPlatform(options: {
  isLocalDevelopmentRuntime: boolean;
}): IPlatformService {
  return {
    canSelectFilePath: true,
    canOpenLocalFiles: true,
    pluginSandbox: createDesktopPluginSandboxPlatform(),
    createLocalMediaPreviewUrl: buildLocalMediaPreviewUrl,
    isLocalDevelopmentRuntime: options.isLocalDevelopmentRuntime,
    selectDirectory: () => window.raspberrycode.selectDirectory(),
    selectDirectories: () => window.raspberrycode.selectDirectories(),
    selectFile: () => window.raspberrycode.selectFile(),
    selectFiles: () => window.raspberrycode.selectFiles?.() ?? Promise.resolve([]),
    createTempTextAttachment: (payload) => window.raspberrycode.createTempTextAttachment(payload),
    materializeWorkflowArtifactFile: (payload) =>
      window.raspberrycode.materializeWorkflowArtifactFile(payload),
    onRemoteConnectionLog: (handler) => window.raspberrycode.onRemoteConnectionLog(handler),
    onRemoteSessionClosed: (handler) => window.raspberrycode.onRemoteSessionClosed(handler),
    // Source 自动重连会替换 logical session；统一由 preload bridge 转发换代事件。
    onRemoteSessionReconnected: (handler) =>
      window.raspberrycode.onRemoteSessionReconnected?.(handler) ?? (() => {}),
    activateOrSetWorkspace: (path) =>
      window.raspberrycode.activateOrSetWorkspace?.(path) ?? Promise.resolve({ activated: false }),
    connectRemote: (remoteOptions, requestId, context) =>
      window.raspberrycode.connectRemote(remoteOptions, requestId, context),
    requestSourceSettingsAttachment: (sourceServerId) =>
      window.raspberrycode.requestSourceSettingsAttachment?.(sourceServerId) ??
      Promise.reject(new Error("Source settings attachment bridge unavailable")),
    cancelPendingRemoteConnection: (requestId) =>
      window.raspberrycode.cancelPendingRemoteConnection?.(requestId) ?? Promise.resolve(),
    bindRemoteWorkspaceSessionContext: (context) =>
      window.raspberrycode.bindRemoteWorkspaceSessionContext?.(context) ??
      Promise.reject(new Error("Desktop bindRemoteWorkspaceSessionContext bridge unavailable")),
    disposeRemoteSession: (sessionId) => window.raspberrycode.disposeRemoteSession(sessionId),
    isDockerAvailable: () => window.raspberrycode.isDockerAvailable(),
    listWSLDistros: () => window.raspberrycode.listWSLDistros(),
    listDockerContainers: () => window.raspberrycode.listDockerContainers(),
    listSSHConfigAliases: () => window.raspberrycode.listSSHConfigAliases(),
    loadMcpFromUserDirectory: (payload) => window.raspberrycode.loadMcpFromUserDirectory(payload),
    saveMcpToUserDirectory: (payload) => window.raspberrycode.saveMcpToUserDirectory(payload),
    openExternal: (url) => window.raspberrycode.openExternal(url),
    openFeedback: () => window.raspberrycode.executeDesktopCommand(DesktopCommandIds.OpenFeedback),
    openCommunity: () => window.raspberrycode.executeDesktopCommand(DesktopCommandIds.OpenCommunity),
    canOpenCommunity: (locale) => window.raspberrycode.canOpenCommunity(locale),
    openInFileManager: (path) => window.raspberrycode.openInFileManager(path),
    openExternalFile: (path) => window.raspberrycode.openExternalFile(path),
    openCuaPermissionOnboarding: window.raspberrycode.openCuaPermissionOnboarding
      ? (permissionOptions) =>
          window.raspberrycode.openCuaPermissionOnboarding?.(permissionOptions) ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    prepareCuaHelperPermissionDrag: window.raspberrycode.prepareCuaHelperPermissionDrag
      ? () =>
          window.raspberrycode.prepareCuaHelperPermissionDrag?.() ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    startCuaHelperPermissionDrag: window.raspberrycode.startCuaHelperPermissionDrag
      ? () => window.raspberrycode.startCuaHelperPermissionDrag?.()
      : undefined,
    registerOAuthState: (payload) => window.raspberrycode.registerOAuthState(payload),
    onOAuthCallback: (callback) => window.raspberrycode.onOAuthCallback(callback),
    notifyRendererReady: () => window.raspberrycode.notifyRendererReady(),
    reportTelemetryEvent: (payload) => window.raspberrycode.reportTelemetryEvent(payload),
    reportArmsCustomEvent: (payload) => {
      recordArmsCustomEventForE2E(payload);
      return window.raspberrycode.reportArmsCustomEvent(payload);
    },
    getRendererActionTraceConfig: window.raspberrycode.getRendererActionTraceConfig
      ? () => window.raspberrycode.getRendererActionTraceConfig!()
      : undefined,
    onRendererActionTraceConfigChanged: window.raspberrycode.onRendererActionTraceConfigChanged
      ? (callback) => window.raspberrycode.onRendererActionTraceConfigChanged!(callback)
      : undefined,
    reportLocalTtftBatch: (batch) => window.raspberrycode.reportLocalTtftBatch(batch),
    reportRendererActionTraceBatch: window.raspberrycode.reportRendererActionTraceBatch
      ? (batch) => window.raspberrycode.reportRendererActionTraceBatch!(batch)
      : undefined,
    reportRendererHeapSample: window.raspberrycode.reportRendererHeapSample
      ? (sample) => window.raspberrycode.reportRendererHeapSample!(sample)
      : undefined,
    showTaskNotification: (payload) => window.raspberrycode.showTaskNotification(payload),
    syncWindowTabs: (paths) => window.raspberrycode.syncWindowTabs(paths),
    syncWindowUnreadCount: (count) => window.raspberrycode.syncWindowUnreadCount(count),
    syncActiveTaskSession: (sessionId) => window.raspberrycode.syncActiveTaskSession(sessionId),
    syncAppSettings: (patch) => window.raspberrycode.syncAppSettings?.(patch),
    // 桥缺失（旧 preload 升级窗口）时按 supported 兜底，与 Windows 现状一致，设置开关可用。
    getCloseToTrayCapability: () =>
      window.raspberrycode.getCloseToTrayCapability?.() ??
      Promise.resolve({ supported: true, gnomeLikeWithoutTray: false }),
    setShortcutRecordingActive: (active) => window.raspberrycode.setShortcutRecordingActive?.(active),
    onFocusTab: (handler) => window.raspberrycode.onFocusTab(handler),
    onNewTab: (handler) => window.raspberrycode.onNewTab(handler),
    onCloseActiveContextRequest: (handler) =>
      window.raspberrycode.onCloseActiveContextRequest?.(handler) ?? (() => {}),
    onOpenBrowserUrl: (handler) => window.raspberrycode.onOpenBrowserUrl?.(handler) ?? (() => {}),
    onEmbeddedBrowserPermissionPrompt: (handler) =>
      window.raspberrycode.onEmbeddedBrowserPermissionPrompt?.(handler) ?? (() => {}),
    resolveEmbeddedBrowserPermissionPrompt: (request) =>
      window.raspberrycode.resolveEmbeddedBrowserPermissionPrompt?.(request),
    getEmbeddedBrowserSitePermissions: () =>
      window.raspberrycode.getEmbeddedBrowserSitePermissions?.() ?? Promise.resolve({}),
    setEmbeddedBrowserSitePermission: (request) =>
      window.raspberrycode.setEmbeddedBrowserSitePermission?.(request) ?? Promise.resolve({}),
    clearEmbeddedBrowserSitePermissions: () =>
      window.raspberrycode.clearEmbeddedBrowserSitePermissions?.() ?? Promise.resolve({}),
    resetEmbeddedBrowserSitePermission: (request) =>
      window.raspberrycode.resetEmbeddedBrowserSitePermission?.(request) ?? Promise.resolve({}),
    onBrowserViewScreenshotSurfacePrepare: (handler) =>
      window.raspberrycode.onBrowserViewScreenshotSurfacePrepare?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfaceRelease: (handler) =>
      window.raspberrycode.onBrowserViewScreenshotSurfaceRelease?.(handler) ?? (() => {}),
    browserViewScreenshotSurfaceReady: (payload) =>
      window.raspberrycode.browserViewScreenshotSurfaceReady?.(payload),
    ...desktopBrowserPlatformBridge,
    onNewTask: (handler) => window.raspberrycode.onNewTask(handler),
    onOpenWorkspace: (handler) => {
      // 开发态或升级后的旧窗口可能仍运行未暴露 onOpenWorkspace 的 preload，
      // renderer 直接调用会在启动时崩溃。这里和 activateOrSetWorkspace 一样做兼容兜底，
      // 缺少该 bridge 时只禁用原生菜单回调，不影响应用继续打开。
      return window.raspberrycode.onOpenWorkspace?.(handler) ?? (() => {});
    },
    onOpenWorkspacePath: (handler) => window.raspberrycode.onOpenWorkspacePath?.(handler) ?? (() => {}),
    onOpenFeedbackDialog: (handler) => window.raspberrycode.onOpenFeedbackDialog?.(handler) ?? (() => {}),
    onOpenTicketsPanel: (handler) => window.raspberrycode.onOpenTicketsPanel?.(handler) ?? (() => {}),
    onWindowFullscreenChanged: (handler) => window.raspberrycode.onWindowFullscreenChanged(handler),
    getDesktopWindowChromeState: window.raspberrycode.getDesktopWindowChromeState
      ? () => window.raspberrycode.getDesktopWindowChromeState!()
      : undefined,
    onDesktopWindowChromeStateChanged: window.raspberrycode.onDesktopWindowChromeStateChanged
      ? (handler) => window.raspberrycode.onDesktopWindowChromeStateChanged!(handler)
      : undefined,
    getWindowControlsOverlayMetrics: () => window.raspberrycode.getWindowControlsOverlayMetrics?.() ?? null,
    onWindowControlsOverlayChanged: (handler) =>
      window.raspberrycode.onWindowControlsOverlayChanged?.(handler) ?? (() => {}),
    getDesktopZoomLevel: () =>
      window.raspberrycode.getDesktopZoomLevel?.() ?? Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: (handler) =>
      window.raspberrycode.onDesktopZoomLevelChanged?.(handler) ?? (() => {}),
    onTaskNotificationClick: (handler) => window.raspberrycode.onTaskNotificationClick(handler),
    exportLogs: () => window.raspberrycode.exportLogs(),
    captureWindowScreenshot: () =>
      window.raspberrycode.captureWindowScreenshot?.() ?? Promise.resolve(null),
    getDesktopSessionActivity: () =>
      window.raspberrycode.getDesktopSessionActivity?.() ??
      Promise.resolve({ runningAgentSessionCount: 0 }),
    getRaspberryCodeStdioTapDevState: () =>
      window.raspberrycode.getRaspberryCodeStdioTapDevState?.() ??
      Promise.resolve({ enabled: false, visible: false, logDir: "", statePath: "" }),
    onSettingsChanged: (callback) => window.raspberrycode.onSettingsChanged?.(callback) ?? (() => {}),
    onApplicationLocaleChanged: (callback) =>
      window.raspberrycode.onApplicationLocaleChanged?.(callback) ?? (() => {}),
    getInstalledEditors: (filePath) => window.raspberrycode.getInstalledEditors(filePath),
    getApplicationIcon: (bundleId) =>
      window.raspberrycode.getApplicationIcon?.(bundleId) ?? Promise.resolve(null),
    openInEditor: (editorId, path, editorOptions) =>
      window.raspberrycode.openInEditor(editorId, path, editorOptions),
    executeDesktopCommand: (command) => window.raspberrycode.executeDesktopCommand(command),
    setApplicationLocale: (locale) => window.raspberrycode.setApplicationLocale(locale),
    getSystemLocale: () =>
      window.raspberrycode.getSystemLocale?.() ??
      Promise.resolve(navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"),
    setTitleBarTheme: (theme) => window.raspberrycode.setTitleBarTheme(theme),
    getDeviceId: () =>
      (window as Window & { __RASPBERRYCODE_DEVICE_ID__?: string }).__RASPBERRYCODE_DEVICE_ID__ ?? "",
  };
}
