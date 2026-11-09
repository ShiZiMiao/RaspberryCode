import type {
  DesktopWindowChromeState,
  IPlatformService,
  UpdateStatePayload,
} from "@raspberrycode/shared";
import { useEffect, useRef, useState } from "react";
import { logger } from "@/logger.js";
import { toast } from "@/components/ui/toast.js";
import { useRaspberryCodeIntl } from "@/i18n/IntlProvider.js";

const MACOS_WINDOW_CONTROLS_DEFAULT_LEFT_PADDING_PX = 96;
const WINDOWS_WINDOW_CONTROLS_DEFAULT_RIGHT_PADDING_PX = 136;

function readFinitePositivePx(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function resolveInitialWindowControlsPaddingPx({
  isDesktop,
  isMacDesktop,
  isWindowsDesktop,
  platform,
}: {
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  platform: IPlatformService;
}) {
  const metrics = platform.getWindowControlsOverlayMetrics?.();
  const leftPaddingPx =
    isDesktop && isMacDesktop
      ? (readFinitePositivePx(metrics?.leftPaddingPx) ??
        MACOS_WINDOW_CONTROLS_DEFAULT_LEFT_PADDING_PX)
      : MACOS_WINDOW_CONTROLS_DEFAULT_LEFT_PADDING_PX;
  const rightPaddingPx =
    isDesktop && isWindowsDesktop
      ? (readFinitePositivePx(metrics?.rightPaddingPx) ??
        WINDOWS_WINDOW_CONTROLS_DEFAULT_RIGHT_PADDING_PX)
      : WINDOWS_WINDOW_CONTROLS_DEFAULT_RIGHT_PADDING_PX;

  return { leftPaddingPx, rightPaddingPx };
}


export function useAppChromeState({
  isDesktop,
  isMacDesktop,
  isWindowsDesktop,
  platform,
  workspaceAbsPath,
}: {
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  platform: IPlatformService;
  workspaceAbsPath: string;
}) {
  const initialWindowControlsPadding = resolveInitialWindowControlsPaddingPx({
    isDesktop,
    isMacDesktop,
    isWindowsDesktop,
    platform,
  });
  const [isMacFullscreen, setIsMacFullscreen] = useState(false);
  const [desktopWindowChromeState, setDesktopWindowChromeState] =
    useState<DesktopWindowChromeState | null>(null);
  const [macWindowControlsLeftPaddingPx, setMacWindowControlsLeftPaddingPx] = useState(
    () => initialWindowControlsPadding.leftPaddingPx,
  );
  const [windowsWindowControlsRightPaddingPx, setWindowsWindowControlsRightPaddingPx] = useState(
    () => initialWindowControlsPadding.rightPaddingPx,
  );
  const [updateState, setUpdateState] = useState<UpdateStatePayload | null>(null);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
  const sidebarContainerRef = useRef<HTMLElement | null>(null);
  const hasShownUpdateToastRef = useRef(false);
  const updateStateEventRevisionRef = useRef(0);
  const { intl } = useRaspberryCodeIntl();

  useEffect(() => {
    let cancelled = false;
    // 「自动更新」开关（默认开）：开启时静默流程，入口/提示整体隐藏（spec 产品规则 7）。
    const refresh = () => {
      void platform.getAutoUpdatePreferences?.().then(
        (preferences) => {
          if (!cancelled) setAutoUpdateEnabled(preferences.autoDownloadAndInstallUpdates);
        },
        (error) => {
          logger.warn("[App] 同步自动更新偏好失败", { error });
        },
      );
    };
    refresh();
    const disposeSettingsChanged = platform.onSettingsChanged?.(refresh) ?? (() => {});
    return () => {
      cancelled = true;
      disposeSettingsChanged();
    };
  }, [platform]);

  // 静默模式下不投影更新入口；手动「检查更新」toast 是用户主动发起，不受此掩蔽影响。
  const visibleUpdateState = autoUpdateEnabled ? null : updateState;

  useEffect(() => {
    let cancelled = false;

    // 更新状态事实由 desktop main 的 autoUpdateService 持有（spec：specs/client-github-self-update.md）；
    // 这里只做订阅快照，供 WorkspaceShellLayout 派发给更新入口。
    if (platform.getUpdateState) {
      const requestRevision = updateStateEventRevisionRef.current;
      void platform.getUpdateState().then(
        (payload) => {
          if (!cancelled && updateStateEventRevisionRef.current === requestRevision) {
            setUpdateState(payload);
          }
        },
        (error) => {
          logger.warn("[App] 同步自动更新状态失败", { error });
        },
      );
    }

    if (!platform.onUpdateStateChanged) {
      return () => {
        cancelled = true;
      };
    }

    const dispose = platform.onUpdateStateChanged((payload) => {
      updateStateEventRevisionRef.current += 1;
      setUpdateState(payload);
    });
    return () => {
      cancelled = true;
      dispose();
    };
  }, [platform]);

  useEffect(() => {
    // 手动「检查更新」结果统一在此转 toast（菜单点击与设置页按钮共用一条通路）。
    return (
      platform.onUpdateCheckResult?.((result) => {
        switch (result.kind) {
          case "up-to-date":
            toast(
              intl.formatMessage({ id: "update.toast.upToDate" }, { version: result.currentVersion }),
            );
            return;
          case "available":
            toast(intl.formatMessage({ id: "update.toast.available" }, { version: result.version }));
            return;
          case "downloading":
            toast(
              intl.formatMessage({ id: "update.toast.downloading" }, { version: result.version }),
            );
            return;
          case "already-downloading":
            toast(
              intl.formatMessage(
                { id: "update.toast.alreadyDownloading" },
                { progress: result.progress },
              ),
            );
            return;
          case "ready":
            toast(intl.formatMessage({ id: "update.toast.ready" }, { version: result.version }));
            return;
          case "dev-skipped":
            toast(intl.formatMessage({ id: "update.toast.devSkipped" }));
            return;
          case "error":
            toast(intl.formatMessage({ id: "update.toast.error" }, { error: result.message }));
            return;
        }
      }) ?? (() => {})
    );
  }, [intl, platform]);

  useEffect(() => {
    // Windows 上更新下载完成给一次轻提示，不阻塞主界面；其余平台靠更新入口自明。
    // 自动更新模式全程无感，不提示（spec 产品规则 7）。
    if (
      !isWindowsDesktop ||
      autoUpdateEnabled ||
      visibleUpdateState?.kind !== "update-downloaded" ||
      hasShownUpdateToastRef.current
    ) {
      return;
    }
    hasShownUpdateToastRef.current = true;
    toast(
      intl.formatMessage({ id: "update.toast.ready" }, { version: visibleUpdateState.version }),
      {
        durationMs: 4000,
        position: "bottom-left",
        variant: "update",
      },
    );
  }, [autoUpdateEnabled, intl, isWindowsDesktop, visibleUpdateState]);

  useEffect(() => {
    if (!isDesktop || !isMacDesktop) {
      setIsMacFullscreen(false);
      setMacWindowControlsLeftPaddingPx(MACOS_WINDOW_CONTROLS_DEFAULT_LEFT_PADDING_PX);
      return;
    }

    // macOS 全屏后红绿灯会重新贴近左上角布局。
    // 顶部浮层继续沿用窗口态的 pl-24 会把左侧安全区撑得过大，视觉上像是三键"消失"。
    // 这里订阅桌面窗口全屏状态，只在 macOS 全屏时收窄留白，不影响普通窗口态。
    return platform.onWindowFullscreenChanged((fullscreen) => {
      setIsMacFullscreen(fullscreen);
    });
  }, [isDesktop, isMacDesktop, platform]);

  useEffect(() => {
    // 排除 macOS 会让版本始终未知，Tahoe 也错误采用 Sequoia 的 6px 圆角。
    // 所有桌面平台共用窗口状态查询，保留事件优先和卸载清理；Web 不读取原生状态。
    if (!isDesktop || !platform.getDesktopWindowChromeState) {
      setDesktopWindowChromeState(null);
      return;
    }

    let disposed = false;
    let eventRevision = 0;
    const dispose = platform.onDesktopWindowChromeStateChanged?.((state) => {
      eventRevision += 1;
      setDesktopWindowChromeState(state);
    });
    const requestRevision = eventRevision;

    // 只监听 maximize/unmaximize 会漏掉“应用启动时窗口已最大化”的初始状态。
    // 先订阅再主动查询，并用 revision 防止较慢的查询结果覆盖更新的窗口事件。
    void platform.getDesktopWindowChromeState().then(
      (state) => {
        if (!disposed && eventRevision === requestRevision) setDesktopWindowChromeState(state);
      },
      (error) => logger.warn("[app-chrome] 同步桌面窗口外观状态失败", { error }),
    );

    return () => {
      disposed = true;
      dispose?.();
    };
  }, [isDesktop, platform]);

  useEffect(() => {
    const isLinuxDesktop = isDesktop && !isMacDesktop && !isWindowsDesktop;
    const rootElement = document.documentElement;
    if (!rootElement) return;
    // Linux 外壳由 renderer 裁切，若最大化后仍保留圆角，屏幕四角会露出透明缺口。
    // 复用 main 进程的窗口状态作为唯一来源，让 Workspace 与设置页同时切换。
    rootElement.classList.toggle(
      "window-maximized",
      isLinuxDesktop && (desktopWindowChromeState?.isMaximized ?? false),
    );
    return () => rootElement.classList.remove("window-maximized");
  }, [desktopWindowChromeState?.isMaximized, isDesktop, isMacDesktop, isWindowsDesktop]);

  useEffect(() => {
    if (
      !isDesktop ||
      (!isMacDesktop && !isWindowsDesktop) ||
      !platform.onWindowControlsOverlayChanged
    ) {
      setMacWindowControlsLeftPaddingPx(MACOS_WINDOW_CONTROLS_DEFAULT_LEFT_PADDING_PX);
      setWindowsWindowControlsRightPaddingPx(WINDOWS_WINDOW_CONTROLS_DEFAULT_RIGHT_PADDING_PX);
      return;
    }

    // 页面缩放后，原生窗口控制区不会随 renderer zoom 一起缩放。
    // macOS 同步左侧红绿灯安全区，Windows 同步右侧标题栏按钮安全区。
    return platform.onWindowControlsOverlayChanged((metrics) => {
      const leftPaddingPx = readFinitePositivePx(metrics.leftPaddingPx);
      const rightPaddingPx = readFinitePositivePx(metrics.rightPaddingPx);
      logger.debug("[app-chrome] 收到原生窗口控制区几何变化", {
        isMacDesktop,
        isWindowsDesktop,
        leftPaddingPx,
        rightPaddingPx,
      });
      if (isMacDesktop && leftPaddingPx !== null) {
        setMacWindowControlsLeftPaddingPx(leftPaddingPx);
      }
      if (isWindowsDesktop && rightPaddingPx !== null) {
        setWindowsWindowControlsRightPaddingPx(rightPaddingPx);
      }
    });
  }, [isDesktop, isMacDesktop, isWindowsDesktop, platform]);

  return {
    isMacFullscreen,
    desktopWindowChromeState,
    macWindowControlsLeftPaddingPx,
    windowsWindowControlsRightPaddingPx,
    sidebarContainerRef,
    updateState: visibleUpdateState,
    updateReadyVersion:
      visibleUpdateState?.kind === "update-downloaded" ? visibleUpdateState.version : null,
  };
}
