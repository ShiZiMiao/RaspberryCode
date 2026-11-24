// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopWindowChromeState, IPlatformService } from "@raspberrycode/shared";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useRaspberryCodeIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
  }),
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: vi.fn(),
}));

vi.mock("@/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function createMinimalElement(ownerDocument: Document, tagName = "div") {
  const element = {
    addEventListener: () => {},
    appendChild: (child: { parentNode?: unknown }) => {
      child.parentNode = element;
      return child;
    },
    childNodes: [] as unknown[],
    getAttribute: () => null,
    insertBefore: (child: { parentNode?: unknown }) => {
      child.parentNode = element;
      return child;
    },
    nodeName: tagName.toUpperCase(),
    nodeType: 1,
    ownerDocument,
    parentNode: null as unknown,
    removeAttribute: () => {},
    removeChild: (child: { parentNode?: unknown }) => {
      child.parentNode = null;
      return child;
    },
    removeEventListener: () => {},
    setAttribute: () => {},
    style: {},
    tagName: tagName.toUpperCase(),
  };
  return element as unknown as Element;
}

function installMinimalDom() {
  const documentMock = {
    addEventListener: () => {},
    createElement: (tagName: string) =>
      createMinimalElement(documentMock as unknown as Document, tagName),
    createElementNS: (_namespace: string, tagName: string) =>
      createMinimalElement(documentMock as unknown as Document, tagName),
    createTextNode: (nodeValue: string) => ({
      nodeType: 3,
      nodeValue,
      ownerDocument: documentMock,
      parentNode: null,
    }),
    nodeType: 9,
    removeEventListener: () => {},
  } as unknown as Document;
  const windowMock = {
    addEventListener: () => {},
    document: documentMock,
    HTMLIFrameElement: function HTMLIFrameElement() {},
    HTMLElement: function HTMLElement() {},
    Node: function Node() {},
    removeEventListener: () => {},
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: documentMock,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowMock,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  return createMinimalElement(documentMock);
}

describe("useAppChromeState desktop chrome state", () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
  });

  it.each([
    [15, 6],
    [26, 12],
  ])("loads macOS %i from the platform before resolving radius %i", async (version, radius) => {
    const { useAppChromeState } = await import("@/app-shell/useAppChromeState.js");
    const { resolveWorkspaceShellPanelRadiusPx } = await import("@/app-shell/workspaceShellWindowChrome.js");
    const dispose = vi.fn();
    const platform = {
      onWindowFullscreenChanged: vi.fn(() => () => {}),
      getDesktopWindowChromeState: vi.fn(async () => ({
        isMaximized: false,
        supportsNativeRoundedCorners: false,
        macOSMajorVersion: version,
      })),
      onDesktopWindowChromeStateChanged: vi.fn(() => dispose),
    } as unknown as IPlatformService;
    let actualRadius: number | undefined;
    const root = createRoot(installMinimalDom());
    const Harness = () => {
      const { desktopWindowChromeState } = useAppChromeState({
        isDesktop: true,
        isMacDesktop: true,
        platform,
        workspaceAbsPath: "/repo/demo",
      });
      actualRadius = resolveWorkspaceShellPanelRadiusPx({
        isMacDesktop: true,
        macOSMajorVersion: desktopWindowChromeState?.macOSMajorVersion,
      });
      return null;
    };
    try {
      await act(async () => root.render(createElement(Harness)));
      expect(platform.getDesktopWindowChromeState).toHaveBeenCalledOnce();
      expect(actualRadius).toBe(radius);
    } finally {
      act(() => root.unmount());
    }
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("keeps capability unknown when the desktop bridge is unavailable", async () => {
    const { useAppChromeState } = await import("@/app-shell/useAppChromeState.js");
    let latestState: DesktopWindowChromeState | null | undefined;
    const root: Root = createRoot(installMinimalDom());
    const Harness = () => {
      latestState = useAppChromeState({
        isDesktop: true,
        isMacDesktop: false,
        isWindowsDesktop: true,
        platform: {} as IPlatformService,
        workspaceAbsPath: "/repo/demo",
      }).desktopWindowChromeState;
      return null;
    };

    await act(async () => {
      root.render(createElement(Harness));
    });

    expect(latestState).toBeNull();
    act(() => root.unmount());
  });

  it("does not let the initial query overwrite a newer maximize event", async () => {
    const { useAppChromeState } = await import("@/app-shell/useAppChromeState.js");
    let resolveInitialState: ((state: DesktopWindowChromeState) => void) | null = null;
    let stateCallback: ((state: DesktopWindowChromeState) => void) | null = null;
    let latestState: DesktopWindowChromeState | null | undefined;
    const platform = {
      getDesktopWindowChromeState: vi.fn(
        () =>
          new Promise<DesktopWindowChromeState>((resolve) => {
            resolveInitialState = resolve;
          }),
      ),
      onDesktopWindowChromeStateChanged: vi.fn(
        (callback: (state: DesktopWindowChromeState) => void) => {
          stateCallback = callback;
          return () => {};
        },
      ),
    } as unknown as IPlatformService;
    const root: Root = createRoot(installMinimalDom());
    const Harness = () => {
      latestState = useAppChromeState({
        isDesktop: true,
        isMacDesktop: false,
        isWindowsDesktop: true,
        platform,
        workspaceAbsPath: "/repo/demo",
      }).desktopWindowChromeState;
      return null;
    };

    await act(async () => {
      root.render(createElement(Harness));
    });
    act(() => {
      stateCallback?.({ isMaximized: true, supportsNativeRoundedCorners: true });
    });
    await act(async () => {
      resolveInitialState?.({ isMaximized: false, supportsNativeRoundedCorners: true });
      await Promise.resolve();
    });

    expect(latestState).toEqual({ isMaximized: true, supportsNativeRoundedCorners: true });
    act(() => root.unmount());
  });
});

/**
 * 更新入口在「自动更新」开启时的可见性（2026-11-23，对齐上游行为）。
 *
 * 缺陷：原实现 `visibleUpdateState = autoUpdateEnabled ? null : updateState`
 * 会在自动更新（默认开启）时把状态整体置空。于是 main 广播 update-available 后，
 * 标题栏绿色入口不渲染、原生菜单被强制成 idle、toast 又是纯文本无动作，
 * 用户三处都找不到可点的东西 —— 正是反馈里的「发现新版本了，然后呢？」。
 *
 * 修复后：入口照常投影。「静默」应体现在不主动弹窗打扰，而不是藏掉状态入口。
 */
describe("更新入口不再被静默模式掩蔽", () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
  });

  it.each([true, false])(
    "autoDownloadAndInstallUpdates=%s 时都投影 update-available（都能看到入口）",
    async (autoEnabled) => {
      const { useAppChromeState } = await import("@/app-shell/useAppChromeState.js");
      const platform = {
        onWindowFullscreenChanged: vi.fn(() => () => {}),
        getAutoUpdatePreferences: vi.fn(async () => ({
          autoDownloadAndInstallUpdates: autoEnabled,
          skippedUpdateVersion: null,
          updateFeedGithubOwner: "",
          updateFeedGithubRepo: "",
        })),
        onSettingsChanged: vi.fn(() => () => {}),
        getUpdateState: vi.fn(async () => ({
          kind: "update-available" as const,
          enabled: true,
          version: "0.2.4",
        })),
        onUpdateStateChanged: vi.fn(() => () => {}),
        onUpdateCheckResult: vi.fn(() => () => {}),
      } as unknown as IPlatformService;

      let seen: string | null | undefined;
      const root = createRoot(installMinimalDom());
      const Harness = () => {
        const { updateState, updateReadyVersion } = useAppChromeState({
          isDesktop: true,
          platform,
          workspaceAbsPath: "/repo/demo",
        });
        seen = updateState?.kind ?? null;
        expect(updateReadyVersion).toBeNull();
        return null;
      };
      try {
        await act(async () => root.render(createElement(Harness)));
        // 关键断言：两种模式下都必须看得见 update-available，入口才会渲染。
        expect(seen).toBe("update-available");
      } finally {
        act(() => root.unmount());
      }
    },
  );
});
