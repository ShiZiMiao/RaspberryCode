import { beforeEach, describe, expect, it, vi } from "vitest";

const buildFromTemplateMock = vi.fn((template) => ({ template }));
const setApplicationMenuMock = vi.fn();
const getApplicationMenuMock = vi.fn(() => ({ getMenuItemById: vi.fn(() => undefined) }));
const envMock = vi.hoisted(() => ({
  value: "test" as "test" | "production",
  isPackaged: false,
  locale: "en-US",
  preferredSystemLanguages: [] as string[],
}));

vi.mock("electron", () => ({
  app: {
    getLocale: vi.fn(() => envMock.locale),
    getPreferredSystemLanguages: vi.fn(() => envMock.preferredSystemLanguages),
    name: "RaspberryCode",
    get isPackaged() {
      return envMock.isPackaged;
    },
  },
  BrowserWindow: vi.fn(),
  Menu: {
    buildFromTemplate: buildFromTemplateMock,
    getApplicationMenu: getApplicationMenuMock,
    setApplicationMenu: setApplicationMenuMock,
  },
}));

// Bugfix: 这个用例只验证菜单模板，不能通过 importActual 拉完整 shared/services/main 依赖。
// 全量 pre-push 并发时真实依赖加载会撞 5s 超时，并让 RASPBERRYCODE_ENV 的模块缓存污染后续断言。
vi.mock("@raspberrycode/shared", () => ({
  DesktopCommandIds: {
    NewTask: "newTask",
    OpenWorkspace: "openWorkspace",
    CloseActiveContext: "closeActiveContext",
    CloseWindow: "closeWindow",
    ToggleFullScreen: "toggleFullScreen",
    ResetZoom: "resetZoom",
    ZoomIn: "zoomIn",
    ZoomOut: "zoomOut",
    ShowAbout: "showAbout",
    OpenChangelog: "openChangelog",
    OpenFeedback: "openFeedback",
    ExportLogs: "exportLogs",
    ToggleDevTools: "toggleDevTools",
    OpenResourceManager: "openResourceManager",
    ToggleRaspberryCodeStdioTapDevProxy: "toggleRaspberryCodeStdioTapDevProxy",
    SetRaspberryCodeEndpointProduction: "setRaspberryCodeEndpointProduction",
    SetRaspberryCodeEndpointTest: "setRaspberryCodeEndpointTest",
    SetRaspberryCodeEndpointCustom: "setRaspberryCodeEndpointCustom",
    ResetRaspberryCodeEndpoint: "resetRaspberryCodeEndpoint",
    ClearAllData: "clearAllData",
  },
  desktopMenuMessageIds: {
    file: "titleBar.menu.file",
    edit: "titleBar.menu.edit",
    view: "titleBar.menu.view",
    window: "titleBar.menu.window",
    help: "titleBar.menu.help",
    fileNewTask: "titleBar.menu.file.newTask",
    fileOpenWorkspace: "titleBar.menu.file.openWorkspace",
    fileCloseWindow: "titleBar.menu.file.closeWindow",
    editUndo: "titleBar.menu.edit.undo",
    editRedo: "titleBar.menu.edit.redo",
    editCut: "titleBar.menu.edit.cut",
    editCopy: "titleBar.menu.edit.copy",
    editPaste: "titleBar.menu.edit.paste",
    editSelectAll: "titleBar.menu.edit.selectAll",
    viewToggleFullScreen: "titleBar.menu.view.toggleFullScreen",
    viewActualSize: "titleBar.menu.view.actualSize",
    viewZoomIn: "titleBar.menu.view.zoomIn",
    viewZoomOut: "titleBar.menu.view.zoomOut",
    windowMinimize: "titleBar.menu.window.minimize",
    windowZoom: "titleBar.menu.window.zoom",
    windowBringAllToFront: "titleBar.menu.window.bringAllToFront",
    appServices: "titleBar.menu.app.services",
    appHide: "titleBar.menu.app.hide",
    appHideOthers: "titleBar.menu.app.hideOthers",
    appShowAll: "titleBar.menu.app.showAll",
    appQuit: "titleBar.menu.app.quit",
    helpAbout: "titleBar.menu.help.about",
    helpWhatsNew: "titleBar.menu.help.whatsNew",
    helpToggleDevTools: "titleBar.menu.help.toggleDevTools",
    helpResourceManager: "titleBar.menu.help.resourceManager",
    helpToggleRaspberryCodeStdioTap: "titleBar.menu.help.toggleRaspberryCodeStdioTap",
    helpRaspberryCodeEndpoint: "titleBar.menu.help.raspberrycodeEndpoint",
    helpRaspberryCodeEndpointProduction: "titleBar.menu.help.raspberrycodeEndpoint.production",
    helpRaspberryCodeEndpointTest: "titleBar.menu.help.raspberrycodeEndpoint.test",
    helpRaspberryCodeEndpointCustom: "titleBar.menu.help.raspberrycodeEndpoint.custom",
    helpRaspberryCodeEndpointReset: "titleBar.menu.help.raspberrycodeEndpoint.reset",
    helpFeedback: "titleBar.menu.help.feedback",
    helpExportLogs: "titleBar.menu.help.exportLogs",
    helpClearAllData: "titleBar.menu.help.clearAllData",
  },
  get RASPBERRYCODE_ENV() {
    return envMock.value;
  },
  // 身份跟随后端环境的旧单轴语义：test → preview，production → production。
  get RASPBERRYCODE_PRODUCT_FLAVOR() {
    return envMock.value === "production" ? "production" : "preview";
  },
  getDesktopMenuMessage: (_locale: string, id: string) => {
    const enLabels: Record<string, string> = {
      "titleBar.menu.help.raspberrycodeEndpoint": "RaspberryCode Endpoint",
      "titleBar.menu.help.raspberrycodeEndpoint.production": "Production (default)",
      "titleBar.menu.help.raspberrycodeEndpoint.test": "Test",
      "titleBar.menu.help.raspberrycodeEndpoint.custom": "Custom...",
      "titleBar.menu.help.raspberrycodeEndpoint.reset": "Reset to Default",
    };
    const zhLabels: Record<string, string> = {
      "titleBar.menu.file": "文件",
      "titleBar.menu.edit": "编辑",
      "titleBar.menu.view": "视图",
      "titleBar.menu.window": "窗口",
      "titleBar.menu.help": "帮助",
      "titleBar.menu.edit.undo": "撤销",
      "titleBar.menu.edit.redo": "重做",
      "titleBar.menu.edit.cut": "剪切",
      "titleBar.menu.edit.copy": "复制",
      "titleBar.menu.edit.paste": "粘贴",
      "titleBar.menu.edit.selectAll": "全选",
      "titleBar.menu.window.minimize": "最小化",
      "titleBar.menu.window.zoom": "缩放",
      "titleBar.menu.window.bringAllToFront": "全部置于前台",
      "titleBar.menu.app.services": "服务",
      "titleBar.menu.app.hide": "隐藏 {appName}",
      "titleBar.menu.app.hideOthers": "隐藏其他",
      "titleBar.menu.app.showAll": "全部显示",
      "titleBar.menu.app.quit": "退出 {appName}",
    };
    return _locale === "zh-CN" ? (zhLabels[id] ?? id) : (enLabels[id] ?? id);
  },
}));

vi.mock("../src/main/desktopCommandHandlers.js", () => ({
  HELP_TOGGLE_DEV_TOOLS_MENU_ID: "help.toggle-dev-tools",
  HELP_TOGGLE_RASPBERRYCODE_STDIO_TAP_MENU_ID: "help.toggle-raspberrycode-stdio-tap",
  PERF_START_MENU_ID: "help.performance.start-recording",
  PERF_STOP_MENU_ID: "help.performance.stop-recording",
}));

vi.mock("@raspberrycode/services/node", () => ({
  readRaspberryCodeStdioTapDevState: vi.fn(() => ({ enabled: false, visible: false })),
}));

describe("desktopApplicationMenu endpoint submenu", () => {
  beforeEach(() => {
    vi.resetModules();
    envMock.value = "test";
    envMock.isPackaged = false;
    envMock.locale = "en-US";
    envMock.preferredSystemLanguages = [];
    buildFromTemplateMock.mockClear();
    setApplicationMenuMock.mockClear();
    getApplicationMenuMock.mockClear();
  });

  it("system default 优先按 macOS 首选系统语言解析", async () => {
    envMock.locale = "en-US";
    envMock.preferredSystemLanguages = ["zh-Hans-CN", "en-CN"];
    const { resolveSystemApplicationLocale } =
      await import("../src/main/desktopApplicationMenu.js");

    expect(resolveSystemApplicationLocale()).toBe("zh-CN");
  });




  it("开发运行形态也隐藏已下线的压测开关", async () => {
    envMock.value = "production";
    envMock.isPackaged = false;
    const { rebuildApplicationMenu } = await import("../src/main/desktopApplicationMenu.js");

    rebuildApplicationMenu({
      currentApplicationLocale: "en-US",
      raspberrycodeEndpointSelection: "production",
      executeDesktopCommand: vi.fn(),
    });

    const template = buildFromTemplateMock.mock
      .calls[0]?.[0] as Electron.MenuItemConstructorOptions[];
    // Bugfix: 批量会话压测下线后，即使是本地开发运行形态也不能继续保留 Help 菜单入口。
    expect(findMenuItem(template, "Bulk Session Stress Test")).toBeUndefined();
  });

  it("Cmd/Ctrl+W 先转发关闭当前上下文而不是直接使用 close role", async () => {
    const executeDesktopCommand = vi.fn();
    const { rebuildApplicationMenu } = await import("../src/main/desktopApplicationMenu.js");

    rebuildApplicationMenu({
      currentApplicationLocale: "en-US",
      raspberrycodeEndpointSelection: "production",
      executeDesktopCommand,
    });

    const template = buildFromTemplateMock.mock
      .calls[0]?.[0] as Electron.MenuItemConstructorOptions[];
    const closeItem = findMenuItem(template, "titleBar.menu.file.closeWindow");
    expect(closeItem?.role).toBeUndefined();
    expect(closeItem?.accelerator).toBe("CmdOrCtrl+W");

    closeItem?.click?.({} as Electron.MenuItem, undefined, undefined);

    expect(executeDesktopCommand).toHaveBeenCalledWith("closeActiveContext");
  });

  it("中文界面显式本地化 Edit 和 Window 系统菜单", async () => {
    const { rebuildApplicationMenu } = await import("../src/main/desktopApplicationMenu.js");

    rebuildApplicationMenu({
      currentApplicationLocale: "zh-CN",
      raspberrycodeEndpointSelection: "production",
      executeDesktopCommand: vi.fn(),
    });

    const template = buildFromTemplateMock.mock
      .calls[0]?.[0] as Electron.MenuItemConstructorOptions[];
    const topLevelLabels = template.map((item) => item.label);
    expect(topLevelLabels).toEqual(
      expect.arrayContaining(["文件", "编辑", "视图", "窗口", "帮助"]),
    );
    expect(topLevelLabels).not.toEqual(expect.arrayContaining(["Edit", "Window"]));
    expect(findMenuItem(template, "撤销")?.role).toBe("undo");
    expect(findMenuItem(template, "粘贴")?.role).toBe("paste");
    expect(findMenuItem(template, "最小化")?.role).toBe("minimize");
    if (process.platform === "darwin") {
      expect(findMenuItem(template, "隐藏 RaspberryCode")?.role).toBe("hide");
    }
  });

  it("View 菜单把系统缩放快捷键转发到受控桌面命令", async () => {
    const executeDesktopCommand = vi.fn();
    const { rebuildApplicationMenu } = await import("../src/main/desktopApplicationMenu.js");

    rebuildApplicationMenu({
      currentApplicationLocale: "en-US",
      raspberrycodeEndpointSelection: "production",
      executeDesktopCommand,
      currentZoomLevel: 1,
    });

    const template = buildFromTemplateMock.mock
      .calls[0]?.[0] as Electron.MenuItemConstructorOptions[];
    const actualSizeItem = findMenuItem(template, "titleBar.menu.view.actualSize");
    const zoomInItems = findMenuItems(template, "titleBar.menu.view.zoomIn");
    const zoomInItem = zoomInItems.find((item) => item.visible !== false);
    const zoomInFallbackItem = zoomInItems.find((item) => item.visible === false);
    const zoomOutItem = findMenuItem(template, "titleBar.menu.view.zoomOut");

    expect(actualSizeItem?.role).toBeUndefined();
    expect(zoomInItem?.role).toBeUndefined();
    expect(zoomOutItem?.role).toBeUndefined();
    expect(actualSizeItem?.accelerator).toBe("CmdOrCtrl+0");
    expect(zoomInItem?.accelerator).toBe("CmdOrCtrl+Plus");
    expect(zoomInFallbackItem?.accelerator).toBe("CmdOrCtrl+=");
    expect(zoomOutItem?.accelerator).toBe("CmdOrCtrl+-");
    const viewSubmenu = findMenuItem(template, "titleBar.menu.view")?.submenu;
    const visibleZoomLabels = Array.isArray(viewSubmenu)
      ? viewSubmenu
          .filter((item) => item.visible !== false)
          .map((item) => item.label)
          .filter((label) =>
            [
              "titleBar.menu.view.zoomIn",
              "titleBar.menu.view.zoomOut",
              "titleBar.menu.view.actualSize",
            ].includes(String(label)),
          )
      : [];
    expect(visibleZoomLabels).toEqual([
      "titleBar.menu.view.zoomIn",
      "titleBar.menu.view.zoomOut",
      "titleBar.menu.view.actualSize",
    ]);
    expect(actualSizeItem?.enabled).toBe(true);
    expect(zoomInItem?.enabled).toBe(true);
    expect(zoomInFallbackItem?.enabled).toBe(true);
    expect(zoomOutItem?.enabled).toBe(true);

    zoomInItem?.click?.({} as Electron.MenuItem, undefined, undefined);
    zoomInFallbackItem?.click?.({} as Electron.MenuItem, undefined, undefined);
    zoomOutItem?.click?.({} as Electron.MenuItem, undefined, undefined);
    actualSizeItem?.click?.({} as Electron.MenuItem, undefined, undefined);

    expect(executeDesktopCommand).toHaveBeenNthCalledWith(1, "zoomIn");
    expect(executeDesktopCommand).toHaveBeenNthCalledWith(2, "zoomIn");
    expect(executeDesktopCommand).toHaveBeenNthCalledWith(3, "zoomOut");
    expect(executeDesktopCommand).toHaveBeenNthCalledWith(4, "resetZoom");
  });

  it("View 菜单按当前缩放档位禁用边界命令", async () => {
    const executeDesktopCommand = vi.fn();
    const { rebuildApplicationMenu } = await import("../src/main/desktopApplicationMenu.js");

    rebuildApplicationMenu({
      currentApplicationLocale: "en-US",
      raspberrycodeEndpointSelection: "production",
      executeDesktopCommand,
      currentZoomLevel: 0,
    });
    let template = getLastBuildFromTemplateCall();
    expect(findMenuItem(template, "titleBar.menu.view.actualSize")?.enabled).toBe(false);
    expect(findMenuItems(template, "titleBar.menu.view.zoomIn")).toEqual(
      expect.arrayContaining([expect.objectContaining({ enabled: true })]),
    );
    expect(findMenuItem(template, "titleBar.menu.view.zoomOut")?.enabled).toBe(true);

    rebuildApplicationMenu({
      currentApplicationLocale: "en-US",
      raspberrycodeEndpointSelection: "production",
      executeDesktopCommand,
      currentZoomLevel: 5,
    });
    template = getLastBuildFromTemplateCall();
    expect(findMenuItem(template, "titleBar.menu.view.actualSize")?.enabled).toBe(true);
    expect(findMenuItems(template, "titleBar.menu.view.zoomIn")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accelerator: "CmdOrCtrl+Plus", enabled: false }),
        expect.objectContaining({ accelerator: "CmdOrCtrl+=", enabled: false }),
      ]),
    );
    expect(findMenuItem(template, "titleBar.menu.view.zoomOut")?.enabled).toBe(true);

    rebuildApplicationMenu({
      currentApplicationLocale: "en-US",
      raspberrycodeEndpointSelection: "production",
      executeDesktopCommand,
      currentZoomLevel: -3,
    });
    template = getLastBuildFromTemplateCall();
    expect(findMenuItem(template, "titleBar.menu.view.actualSize")?.enabled).toBe(true);
    expect(findMenuItems(template, "titleBar.menu.view.zoomIn")).toEqual(
      expect.arrayContaining([expect.objectContaining({ enabled: true })]),
    );
    expect(findMenuItem(template, "titleBar.menu.view.zoomOut")?.enabled).toBe(false);
  });
});

function getLastBuildFromTemplateCall(): Electron.MenuItemConstructorOptions[] {
  return (buildFromTemplateMock.mock.calls[buildFromTemplateMock.mock.calls.length - 1]?.[0] ??
    []) as Electron.MenuItemConstructorOptions[];
}

function findMenuItems(
  items: Electron.MenuItemConstructorOptions[] | undefined,
  label?: string,
  id?: string,
): Electron.MenuItemConstructorOptions[] {
  const matches: Electron.MenuItemConstructorOptions[] = [];
  for (const item of items ?? []) {
    if ((label !== undefined && item.label === label) || (id !== undefined && item.id === id)) {
      matches.push(item);
    }
    const submenu = Array.isArray(item.submenu) ? item.submenu : undefined;
    matches.push(...findMenuItems(submenu, label, id));
  }
  return matches;
}

function findMenuItem(
  items: Electron.MenuItemConstructorOptions[] | undefined,
  label?: string,
  id?: string,
): Electron.MenuItemConstructorOptions | undefined {
  for (const item of items ?? []) {
    if ((label !== undefined && item.label === label) || (id !== undefined && item.id === id)) {
      return item;
    }
    const submenu = Array.isArray(item.submenu) ? item.submenu : undefined;
    const found = findMenuItem(submenu, label, id);
    if (found) {
      return found;
    }
  }
  return undefined;
}
