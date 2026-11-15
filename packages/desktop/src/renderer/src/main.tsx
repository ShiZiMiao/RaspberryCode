/* eslint-disable max-lines -- Desktop renderer bridge 聚合平台、远端 attachment 与启动编排契约。 */
import { DatabaseStartupAdmission } from "./databaseStartupAdmission.js";
import { initializeDesktopLocalTtft } from "./local-ttft/contract.js";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { useEffect } from "react";
import {
  AppErrorBoundary,
  Root,
  GlobalDatabaseStartupLoading,
  RaspberryCodeIntlProvider,
  registerBaseWorkspaceServices,
  registerRemoteWorkspaceSession,
  createRemoteWorkspaceDisconnectedError,
  installDocumentHiddenMotionPause,
  playTaskNotificationSound,
  setStreamClientId,
  setReactErrorArmsReporter,
} from "@raspberrycode/ui";
import "@raspberrycode/ui/styles.css";
import { normalizeThemePreference } from "@raspberrycode/ui/useTheme";
import { connectViaMessagePort, createMessagePortServiceConnection } from "@raspberrycode/client";
import {
  InternalChannels,
  databaseStartupStateSchema,
  type DatabaseStartupControl,
  parseLaunchMarks,
  LAUNCH_MARKS_QUERY_KEY,
  type LaunchMarks,
  DEFAULT_LOCALE,
} from "@raspberrycode/shared";
import type { Locale } from "@raspberrycode/shared";
import type { IServiceAccessor } from "@raspberrycode/services";
import { createDesktopPlatform } from "./desktopPlatform.js";
import { startPerformanceTimelineCleanup } from "./performanceTimelineCleanup.js";
import { initializeDesktopUserActionTrace } from "./userActionTraceBootstrap.js";
import { buildRemoteWorkspaceSessionServicesForRegistration } from "./remoteWorkspaceSessionServices.js";
import { handleSourceSettingsServicePortMessage } from "./sourceSettingsServicePortBridge.js";
import {
  notifyRemoteWorkspaceServicePortReady,
  parseRemoteWorkspaceServicePortMessage,
  type RemoteWorkspaceServicePortRegistration,
} from "./remoteWorkspaceServicePortBridge.js";

type DesktopRendererImportMetaEnv = {
  VITE_RASPBERRYCODE_E2E_STORE_BRIDGE?: string;
};

startPerformanceTimelineCleanup();

// T4:renderer bundle 开始执行。同时从 loadURL query 解析 main 注入的 T0-T3。
const rendererStartedAt = Date.now();
const launchMarks: LaunchMarks | null = parseLaunchMarks(
  new URLSearchParams(window.location.search).get(LAUNCH_MARKS_QUERY_KEY),
);
(
  window as Window & {
    __RASPBERRYCODE_RENDERER_START__?: number;
    __RASPBERRYCODE_LAUNCH_MARKS__?: LaunchMarks | null;
  }
).__RASPBERRYCODE_RENDERER_START__ = rendererStartedAt;
(
  window as Window & { __RASPBERRYCODE_LAUNCH_MARKS__?: LaunchMarks | null }
).__RASPBERRYCODE_LAUNCH_MARKS__ = launchMarks;
registerE2EStoreBridgesIfEnabled();

function registerE2EStoreBridgesIfEnabled() {
  const env = ((import.meta as ImportMeta & { env?: DesktopRendererImportMetaEnv }).env ??
    {}) as DesktopRendererImportMetaEnv;
  if (env.VITE_RASPBERRYCODE_E2E_STORE_BRIDGE !== "1") {
    return;
  }

  void import("@raspberrycode/ui/e2e-store-bridge").then(({ registerE2EStoreBridges }) => {
    registerE2EStoreBridges();
  });
}

// 初始化主题：默认跟随系统，后续由 useTheme hook 接管
{
  // 旧值归一复用 useTheme 的 normalizeThemePreference（含 zai-* 旧代号读兼容），
  // 保证初始化分支与 hook/store 使用同一套迁移规则，避免旧值用户首帧错亮主题。
  // 没有持久化值时归一为 system，按系统亮暗解析首帧，避免深色系统闪白/浅色系统闪黑。
  const saved = normalizeThemePreference(localStorage.getItem("raspberrycode-theme"));
  const resolved =
    saved === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : saved === "dark"
        ? "dark"
        : "light";
  const appliedTheme =
    saved === "system"
      ? resolved === "dark"
        ? "dark"
        : "light"
      : saved === "dark"
        ? "dark"
        : saved === "light"
          ? "light"
          : saved;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("theme-light", appliedTheme === "light");
  document.documentElement.classList.toggle("theme-dark", appliedTheme === "dark");
}

const isMacDesktop = navigator.userAgent.includes("Mac");
const isWindowsDesktop = navigator.userAgent.includes("Windows");
const isLinuxDesktop = !isMacDesktop && !isWindowsDesktop;
// macOS hidden 原生标题栏仍参与鼠标拖拽命中，深层浮层需要平台标记避开其高度。
document.documentElement.classList.toggle("platform-mac-desktop", isMacDesktop);
// Windows 的原生 titleBarOverlay 与 renderer 共用右上角，深层浮层拿不到
// Root 的 isWindowsDesktop prop 时会把关闭按钮放进原生窗控命中区。根节点平台标记只描述
// Desktop chrome，不会让普通 Windows Web 误用标题栏安全区。
document.documentElement.classList.toggle("platform-windows-desktop", isWindowsDesktop);
// Linux 的窗口标题栏由 renderer 自绘，应用内 Dialog overlay 如果覆盖整个 webContents，
// 会把标题栏点击区一起拦截。给桌面 Linux 根节点打平台标记，让 UI overlay 能只在 Linux 避开标题栏。
document.documentElement.classList.toggle("platform-linux-desktop", isLinuxDesktop);
const isLocalDevelopmentRuntime =
  (
    globalThis as typeof globalThis & {
      __RASPBERRYCODE_LOCAL_DEVELOPMENT_RUNTIME__?: boolean;
    }
  ).__RASPBERRYCODE_LOCAL_DEVELOPMENT_RUNTIME__ === true;

function readBooleanFlag(name: string, defaultValue: boolean): boolean {
  const value = new URLSearchParams(window.location.search).get(name);
  if (value == null) return defaultValue;
  return value !== "false" && value !== "0";
}

function readStringFlag(name: string): string | undefined {
  const value = new URLSearchParams(window.location.search).get(name);
  return value == null || value.trim() === "" ? undefined : value;
}

const restoreSession = readBooleanFlag("restoreSession", true);
const supportsSettings = readBooleanFlag("supportsSettings", true);
const initialWorkspaceAbsPath = readStringFlag("initialWorkspacePath");
const initialWorkspacePurpose = readStringFlag("initialWorkspacePurpose");
const unavailableWorkspacePath = readStringFlag("unavailableWorkspacePath");
const initialLocaleFlag = readStringFlag("locale");
const initialLocale: Locale =
  initialLocaleFlag === "zh-CN" || initialLocaleFlag === "en-US"
    ? initialLocaleFlag
    : DEFAULT_LOCALE;
let baseServicesForRemoteSessions: IServiceAccessor | null = null;
const pendingRemoteWorkspaceServicePorts: RemoteWorkspaceServicePortRegistration[] = [];

const desktopPlatform = createDesktopPlatform({ isLocalDevelopmentRuntime });
initializeDesktopLocalTtft(desktopPlatform);
initializeDesktopUserActionTrace({
  platform: desktopPlatform,
  isLocalDevelopmentRuntime,
});

/**
 * 等待 preload 通过 window.postMessage 转发 MessagePort。
 *
 * MessagePort 不能经过 contextBridge（会丢失原生方法），
 * 所以 preload 用 window.postMessage + transfer 把 port 原样传递到 renderer。
 * 本地窗口的 port 来自 utilityProcess，远程窗口也一样，renderer 无需区分。
 */
// 窗口 hidden 时禁用 CSS 动画，避免 DocumentTimeline 持有已卸载的 DOM 子树。
installDocumentHiddenMotionPause();
/**
 * renderer 只允许存在一个 React root。
 *
 * Bug 根因：旧实现直接在模块作用域 `createRoot(document.getElementById("root"))`。
 * 生产加载只会执行一次模块，但开发态 Vite HMR 会把改动过的模块（连带上游入口）重新求值，
 * 于是同一个 #root 上被反复创建 root。每个 root 都会渲染一棵 `h-dvh` 整高树并各自持有
 * container 的 children 所有权，后续提交互相 removeChild 对方节点，抛
 * `Failed to execute 'removeChild' on 'Node'`，错误边界又把整高兜底卡片追加进 #root，
 * 最终表现为应用整体下推、底部输入区被裁出视口。
 *
 * 因此 root 实例挂在 window 上跨 HMR 复用：重复求值只拿回同一个 root，
 * 并在复用前清掉上一次求值遗留的 DOM，避免旧树与兜底卡片叠加。
 * 符号必须在 createRendererRoot 调用之前初始化，否则模块顶层会踩 TDZ。
 */
const RENDERER_ROOT_SYMBOL = Symbol.for("raspberrycode.renderer.root");

function createRendererRoot(): ReactRoot {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("renderer root container is missing");
  }
  const scope = window as Window & { [RENDERER_ROOT_SYMBOL]?: ReactRoot };
  const existing = scope[RENDERER_ROOT_SYMBOL];
  if (existing) {
    // HMR 重入：旧树的节点仍留在 container 里，必须先清空再交给复用的 root。
    container.replaceChildren();
    return existing;
  }
  const root = createRoot(container);
  scope[RENDERER_ROOT_SYMBOL] = root;
  return root;
}
let appInitialized = false;
const databaseStartupAdmission = new DatabaseStartupAdmission();
// 注意：appInitialized 只门禁"业务根是否已建立"，不负责挂载去重。
// 挂载去重由上面的 createRendererRoot 承担，两者职责不同，不能互相替代。
const appRoot = createRendererRoot();
const sendStartupControl = (control: DatabaseStartupControl) =>
  window.postMessage({ type: InternalChannels.DatabaseStartupControl, control }, "*");
function renderDatabaseStartup(): void {
  appRoot?.render(
    <AppErrorBoundary isDesktop isMacDesktop={isMacDesktop} isWindowsDesktop={isWindowsDesktop}>
      <RaspberryCodeIntlProvider
        initialLocale={initialLocaleFlag ? initialLocale : undefined}
        resolveSystemLocale={desktopPlatform.getSystemLocale}
      >
        <StartupReadyNotifier />
        <GlobalDatabaseStartupLoading
          state={databaseStartupAdmission.state}
          onRetry={() => {
            if (databaseStartupAdmission.state)
              sendStartupControl({
                action: "retry",
                attemptId: databaseStartupAdmission.state.attemptId,
              });
          }}
          onCopy={(details) => navigator.clipboard.writeText(details)}
          onExit={() => sendStartupControl({ action: "exit" })}
        />
      </RaspberryCodeIntlProvider>
    </AppErrorBoundary>,
  );
}
function enterAppIfPrepared(): void {
  if (appInitialized) return;
  const port = databaseStartupAdmission.takeReadyPort();
  if (port) initializeBusinessRoot(port);
}
const firstStartupStateTimer = setTimeout(() => {
  if (databaseStartupAdmission.state) return;
  const now = Date.now();
  databaseStartupAdmission.state = {
    schemaVersion: 1,
    startupId: "unavailable",
    attemptId: "startup-channel-unavailable",
    sequence: 0,
    startedAt: rendererStartedAt,
    updatedAt: now,
    phase: "failed",
    errorCode: "startup_status_timeout",
    disk: [],
  };
  renderDatabaseStartup();
}, 30_000);

function registerRemoteWorkspaceServicePort(params: RemoteWorkspaceServicePortRegistration) {
  if (!baseServicesForRemoteSessions) {
    return;
  }

  const remoteConnection = createMessagePortServiceConnection(params.port);
  const remoteServices = remoteConnection.services;
  const services = buildRemoteWorkspaceSessionServicesForRegistration({
    baseServices: baseServicesForRemoteSessions,
    remoteServices,
    targetKind: params.target.kind,
    sourceServerId: params.sourceServerId,
  });
  registerRemoteWorkspaceSession({
    sessionId: params.sessionId,
    ...(params.sourceServerId ? { sourceServerId: params.sourceServerId } : {}),
    ...(params.workspacePath ? { workspacePath: params.workspacePath } : {}),
    ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
    ...(params.workspacePurpose ? { workspacePurpose: params.workspacePurpose } : {}),
    target: params.target,
    services,
    dispose: (reason) =>
      remoteConnection.dispose(reason ?? createRemoteWorkspaceDisconnectedError()),
  });
  // canonical workspace bind 会换代 remote-scoped port。
  // 只有 store 已注册新 services 后才能确认 ready，bind IPC 返回后的调用方才可重新读取并使用新代 services。
  notifyRemoteWorkspaceServicePortReady(params);
}

function flushPendingRemoteWorkspaceServicePorts(): void {
  if (!baseServicesForRemoteSessions || pendingRemoteWorkspaceServicePorts.length === 0) {
    return;
  }

  const pending = pendingRemoteWorkspaceServicePorts.splice(0);
  for (const entry of pending) {
    registerRemoteWorkspaceServicePort(entry);
  }
}

function StartupReadyNotifier() {
  useEffect(() => {
    // T5:React 首次 commit。供启动分阶段耗时计算 react_commit 段。
    (
      window as Window & { __RASPBERRYCODE_REACT_COMMIT_AT__?: number }
    ).__RASPBERRYCODE_REACT_COMMIT_AT__ = Date.now();
    // HTML 启动壳的弹出动画结束时，React 首屏可能还没 commit，直接移除壳会露出空白。
    // 这里在 React commit 后通知 index.html，再由启动壳统一判断动画和 React ready 两个条件后退场。
    window.dispatchEvent(new Event("raspberrycode-react-startup-ready"));
  }, []);

  return null;
}

function handleServicePortMessage(event: MessageEvent): void {
  if (event.source === window && event.data?.type === InternalChannels.DatabaseStartupState) {
    const result = databaseStartupStateSchema.safeParse(event.data.state);
    if (!result.success || appInitialized) return;
    const next = result.data;
    if (!databaseStartupAdmission.acceptState(next)) return;
    if (firstStartupStateTimer) clearTimeout(firstStartupStateTimer);
    renderDatabaseStartup();
    enterAppIfPrepared();
    return;
  }

  if (event.data === InternalChannels.TaskNotificationSound) {
    void playTaskNotificationSound();
    return;
  }

  if (handleSourceSettingsServicePortMessage(event)) return;

  const remoteWorkspacePort = parseRemoteWorkspaceServicePortMessage(event);
  if (remoteWorkspacePort) {
    if (!baseServicesForRemoteSessions) {
      // renderer reload 时 main 可能先补投 remote port，再投本地 ServicePort。
      // 早到的 remote port 不能直接丢弃，否则 SSH host 仍存活但 UI 会进入断连代理。
      pendingRemoteWorkspaceServicePorts.push(remoteWorkspacePort);
      return;
    }

    registerRemoteWorkspaceServicePort(remoteWorkspacePort);
    return;
  }

  if (
    event.source !== window ||
    event.data?.type !== InternalChannels.ServicePort ||
    appInitialized
  )
    return;
  const port = event.ports[0];
  if (!port) return;
  databaseStartupAdmission.acceptPort({ databaseStartupId: event.data.databaseStartupId }, port);
  enterAppIfPrepared();
}

function initializeBusinessRoot(port: MessagePort): void {
  appInitialized = true;
  const services = connectViaMessagePort(port, {
    sourceServerManagementService: true,
    deviceSyncStateService: true,
  });
  baseServicesForRemoteSessions = services;
  registerBaseWorkspaceServices(services);
  flushPendingRemoteWorkspaceServicePorts();
  const settingService = supportsSettings ? services.settingService : undefined;

  // 初始化稳定的设备 ID，确保所有 hook 在首次渲染前就使用正确的值
  setStreamClientId(desktopPlatform.getDeviceId());

  // React 错误边界捕获的异常不会冒泡到 window.onerror，RUM Browser SDK 默认收不到。
  // 必须在 createRoot 之前注入 reporter：根级 AppErrorBoundary 的职责正是兜住 Root 自身
  // 渲染崩溃，若依赖 Root 的 effect 注入，则 Root 首帧就崩时上报会丢失。
  setReactErrorArmsReporter(desktopPlatform);

  appRoot?.render(
    <AppErrorBoundary isDesktop isMacDesktop={isMacDesktop} isWindowsDesktop={isWindowsDesktop}>
      <RaspberryCodeIntlProvider
        settingService={settingService}
        broadcastService={services.broadcastService}
        resolveSystemLocale={desktopPlatform.getSystemLocale}
      >
        <StartupReadyNotifier />
        <Root
          services={services}
          platform={desktopPlatform}
          isDesktop
          assistantCodeCommentCardsEnabled
          isMacDesktop={isMacDesktop}
          isWindowsDesktop={isWindowsDesktop}
          restoreSession={restoreSession}
          supportsSettings={supportsSettings}
          initialWorkspaceAbsPath={initialWorkspaceAbsPath}
          initialWorkspacePurpose={
            initialWorkspacePurpose === "conversation" ? "conversation" : "project"
          }
          unavailableWorkspacePath={unavailableWorkspacePath}
        />
      </RaspberryCodeIntlProvider>
    </AppErrorBoundary>,
  );
}

// 监听器同样必须在 HMR 下保持单份：每次重入先摘掉上一次注册的处理函数，
// 否则同一个 ServicePort 消息会被多份闭包分别处理，重复 render 与重复 acceptPort。
// HMR 重入时本模块内的函数是新引用，removeEventListener 摘不掉旧闭包，
// 因此把登记过的处理函数也挂在 window 上，按引用精确移除。
const SERVICE_PORT_LISTENER_SYMBOL = Symbol.for("raspberrycode.renderer.servicePortListener");
{
  const scope = window as Window & {
    [SERVICE_PORT_LISTENER_SYMBOL]?: (event: MessageEvent) => void;
  };
  const previous = scope[SERVICE_PORT_LISTENER_SYMBOL];
  if (previous) {
    window.removeEventListener("message", previous);
  }
  scope[SERVICE_PORT_LISTENER_SYMBOL] = handleServicePortMessage;
  window.addEventListener("message", handleServicePortMessage);
}
renderDatabaseStartup();
sendStartupControl({ action: "snapshot" });
