/**
 * 客户端 GitHub 自更新服务单测（spec：specs/client-github-self-update.md 验收 1-9）。
 * 覆盖：feed 解析、跳过版本、release notes 映射、手动检查短路、状态机事件、退出安装时序。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "1.0.0" },
}));

// vi.mock 工厂会被提升到文件顶部，假实现必须内联在工厂里，不能引用外层声明。
vi.mock("electron-updater", () => {
  class FakeCancellationToken {
    cancelled = false;
    cancel() {
      this.cancelled = true;
    }
  }
  // 复刻真实模块的导出形态：electron-updater 是 CJS，autoUpdater 通过
  // Object.defineProperty + getter 惰性求值，**没有 default 导出实例**。
  // 早前 mock 直接给 `default: fakeSingleton`，掩盖了生产代码用默认导入取值后
  // 拿到命名空间对象、updater.on(...) 抛 TypeError 打断启动链的 bug。
  const fakeAutoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
    on: vi.fn(),
  };
  const namespace: Record<string, unknown> = { CancellationToken: FakeCancellationToken };
  Object.defineProperty(namespace, "autoUpdater", {
    enumerable: true,
    get: () => fakeAutoUpdater,
  });
  // 故意不提供 default：与真实 ESM 互操作结果一致（默认导入得到包装对象，非实例）。
  return namespace;
});

import {
  buildReleaseNotesPayload,
  cancelUpdateDownload,
  checkForUpdateManually,
  deriveManualCheckResultFromState,
  disposeAutoUpdateService,
  downloadAvailableUpdate,
  getAutoUpdatePreferences,
  getUpdateState,
  initAutoUpdateService,
  isAutoUpdateMode,
  isVersionSkipped,
  quitAndInstallUpdate,
  resolveGithubFeedOptions,
  setAutoDownloadAndInstallUpdates,
  setUpdateFeedGithub,
  skipAvailableUpdateVersion,
  type AutoUpdaterLike,
  type GithubFeedOptions,
  __setBundledAutoUpdaterResolverForTest,
} from "../src/main/autoUpdate/index.js";
import type { AppSettings, UpdateStatePayload } from "@raspberrycode/shared";

function createFakeUpdater() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const updater: AutoUpdaterLike & {
    emit: (event: string, ...args: unknown[]) => void;
    checkForUpdates: ReturnType<typeof vi.fn>;
    downloadUpdate: ReturnType<typeof vi.fn>;
    quitAndInstall: ReturnType<typeof vi.fn>;
    setFeedURL: ReturnType<typeof vi.fn>;
  } = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
    on(event: string, listener: (...args: unknown[]) => void) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return updater;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
  };
  return updater;
}

function createSettingService(initial: AppSettings = {}) {
  const settings: AppSettings = { ...initial };
  return {
    settings,
    service: {
      get: vi.fn(async () => ({ ...settings })),
      update: vi.fn(async (patch: Partial<AppSettings>) => {
        Object.assign(settings, patch);
      }),
    },
  };
}

const fakeInfo = {
  version: "2.0.0",
  releaseName: "v2.0.0",
  releaseNotes: "## 变更\n- 修复若干",
  releaseDate: "2026-11-01T00:00:00.000Z",
  files: [],
  path: "",
  sha512: "",
};

/** 等待微任务链（状态机内的 async 偏好读取）收口。 */
async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("resolveGithubFeedOptions", () => {
  it("空值回退默认仓库，只消费正式 release，差量恒走单 Range", () => {
    expect(resolveGithubFeedOptions(undefined, undefined)).toEqual({
      provider: "github",
      owner: "ShiZiMiao",
      repo: "RaspberryCode",
      releaseType: "release",
      useMultipleRangeRequest: false,
    });
    expect(resolveGithubFeedOptions("  ", "")).toEqual({
      provider: "github",
      owner: "ShiZiMiao",
      repo: "RaspberryCode",
      releaseType: "release",
      useMultipleRangeRequest: false,
    });
  });

  it("自定义 owner/repo 去空白后生效", () => {
    expect(resolveGithubFeedOptions(" foo ", "bar")).toEqual({
      provider: "github",
      owner: "foo",
      repo: "bar",
      releaseType: "release",
      useMultipleRangeRequest: false,
    });
  });
});

describe("isVersionSkipped", () => {
  it("只读 stable 通道的跳过记录并忽略空白差异", () => {
    expect(isVersionSkipped("2.0.0", {})).toBe(false);
    expect(
      isVersionSkipped("2.0.0", { skippedElectronUpdateVersions: { stable: "2.0.0 " } }),
    ).toBe(true);
    expect(
      isVersionSkipped("2.0.0", { skippedElectronUpdateVersions: { preview: "2.0.0" } }),
    ).toBe(false);
  });
});

describe("buildReleaseNotesPayload", () => {
  it("字符串 releaseNotes 直取，标题缺省回退版本号", () => {
    const payload = buildReleaseNotesPayload({
      version: "2.0.0",
      releaseName: null,
      releaseNotes: "notes",
      releaseDate: "2026-11-01",
    });
    expect(payload).toEqual({
      version: "2.0.0",
      title: "v2.0.0",
      markdown: "notes",
      releaseDate: "2026-11-01",
    });
  });

  it("数组 releaseNotes 拼接，无日期省略字段", () => {
    const payload = buildReleaseNotesPayload({
      version: "2.0.0",
      releaseName: "title",
      releaseNotes: [{ note: "a" }, { note: "b" }],
    });
    expect(payload.markdown).toBe("a\n\nb");
    expect(payload.releaseDate).toBeUndefined();
  });
});

describe("deriveManualCheckResultFromState", () => {
  it("已下载→ready；下载中→already-downloading；已发现→available；其余需真实检查", () => {
    expect(
      deriveManualCheckResultFromState({ kind: "update-downloaded", enabled: true, version: "2.0.0" }),
    ).toEqual({ kind: "ready", version: "2.0.0" });
    expect(
      deriveManualCheckResultFromState({
        kind: "download-progress",
        enabled: true,
        progress: 42,
        version: "2.0.0",
      }),
    ).toEqual({ kind: "already-downloading", version: "2.0.0", progress: "42%" });
    expect(
      deriveManualCheckResultFromState({ kind: "update-available", enabled: true, version: "2.0.0" }),
    ).toEqual({ kind: "available", version: "2.0.0" });
    expect(deriveManualCheckResultFromState({ kind: "idle", enabled: true })).toBeNull();
  });
});

describe("autoUpdateService 状态机", () => {
  const broadcasts: UpdateStatePayload[] = [];
  let fakeUpdater: ReturnType<typeof createFakeUpdater>;
  let fakeSettings: ReturnType<typeof createSettingService>;

  beforeEach(() => {
    broadcasts.length = 0;
    fakeUpdater = createFakeUpdater();
    fakeSettings = createSettingService({});
    initAutoUpdateService({
      settingService: fakeSettings.service,
      updater: fakeUpdater,
      isPackaged: true,
      currentVersion: "1.0.0",
      silentCheckDelayMs: 600_000,
      broadcastState: (state) => broadcasts.push(state),
    });
  });

  afterEach(() => {
    disposeAutoUpdateService();
  });

  it("开发态：不初始化更新器，手动检查返回 dev-skipped", async () => {
    initAutoUpdateService({
      settingService: fakeSettings.service,
      updater: fakeUpdater,
      isPackaged: false,
      silentCheckDelayMs: 600_000,
      broadcastState: (state) => broadcasts.push(state),
    });
    expect(getUpdateState()).toEqual({ kind: "idle", enabled: false });
    expect(await checkForUpdateManually()).toEqual({ kind: "dev-skipped" });
    expect(fakeUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("update-available 携带 release notes；跳过版本按无更新处理", async () => {
    fakeUpdater.emit("update-available", fakeInfo);
    expect(getUpdateState()).toMatchObject({ kind: "update-available", version: "2.0.0" });

    await skipAvailableUpdateVersion("2.0.0");
    expect(getUpdateState()).toEqual({ kind: "idle", enabled: true });
    expect(fakeSettings.settings.skippedElectronUpdateVersions?.stable).toBe("2.0.0");

    // 再次检查命中跳过版本 → 回到 idle，不给入口
    fakeUpdater.emit("update-available", fakeInfo);
    await flushAsync();
    expect(getUpdateState()).toEqual({ kind: "idle", enabled: true });
  });

  it("自动下载偏好开启时发现更新即下载", async () => {
    await setAutoDownloadAndInstallUpdates(true);
    expect(fakeUpdater.autoInstallOnAppQuit).toBe(true);
    fakeUpdater.emit("update-available", fakeInfo);
    await flushAsync();
    expect(fakeUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("下载进度/完成驱动状态广播；取消下载回到 update-available", async () => {
    fakeUpdater.emit("update-available", fakeInfo);
    downloadAvailableUpdate("test");
    expect(fakeUpdater.downloadUpdate).toHaveBeenCalledTimes(1);

    fakeUpdater.emit("download-progress", {
      total: 1000,
      transferred: 420,
      percent: 42.4,
      bytesPerSecond: 1,
    });
    expect(getUpdateState()).toMatchObject({
      kind: "download-progress",
      progress: 42,
      totalBytes: 1000,
      transferredBytes: 420,
    });

    cancelUpdateDownload();
    fakeUpdater.emit("error", Object.assign(new Error("cancelled"), { name: "CancellationError" }));
    expect(getUpdateState()).toMatchObject({ kind: "update-available", version: "2.0.0" });
  });

  it("update-downloaded 后短路手动检查为 ready；未就绪时退出安装抛错", async () => {
    await expect(quitAndInstallUpdate()).rejects.toThrow(/not ready/);

    fakeUpdater.emit("update-downloaded", { ...fakeInfo, path: "C:/tmp/update.exe" });
    expect(getUpdateState()).toMatchObject({ kind: "update-downloaded", version: "2.0.0" });
    expect(await checkForUpdateManually()).toEqual({ kind: "ready", version: "2.0.0" });
  });

  it("退出安装先退出准备后交安装器；准备失败不得启动安装器", async () => {
    fakeUpdater.emit("update-downloaded", { ...fakeInfo, path: "C:/tmp/update.exe" });

    // 准备失败：安装器不得启动，错误上抛
    let prepareCalls = 0;
    initAutoUpdateService({
      settingService: fakeSettings.service,
      updater: fakeUpdater,
      isPackaged: true,
      currentVersion: "1.0.0",
      silentCheckDelayMs: 600_000,
      broadcastState: (state) => broadcasts.push(state),
      onBeforeQuitAndInstall: async () => {
        prepareCalls += 1;
        throw new Error("prepare failed");
      },
    });
    fakeUpdater.emit("update-downloaded", { ...fakeInfo, path: "C:/tmp/update.exe" });
    await expect(quitAndInstallUpdate()).rejects.toThrow("prepare failed");
    expect(prepareCalls).toBe(1);
    expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled();

    // 准备成功：顺序为 先准备后安装
    const order: string[] = [];
    initAutoUpdateService({
      settingService: fakeSettings.service,
      updater: fakeUpdater,
      isPackaged: true,
      currentVersion: "1.0.0",
      silentCheckDelayMs: 600_000,
      broadcastState: (state) => broadcasts.push(state),
      onBeforeQuitAndInstall: async () => {
        order.push("prepare");
      },
    });
    fakeUpdater.emit("update-downloaded", { ...fakeInfo, path: "C:/tmp/update.exe" });
    await quitAndInstallUpdate();
    expect(order).toEqual(["prepare"]);
    expect(fakeUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("「自动更新」开关驱动静默模式缓存与退出安装开关", async () => {
    // 假 settings 未写该字段 → 与 schema 默认不同（真实 settingService 会解析出默认 true），
    // 服务侧按 === true 判定，缓存同步刷新。
    expect(isAutoUpdateMode()).toBe(false);
    await setAutoDownloadAndInstallUpdates(true);
    expect(isAutoUpdateMode()).toBe(true);
    expect(fakeUpdater.autoInstallOnAppQuit).toBe(true);

    // 外部经设置服务改写偏好后，readPreferences 会刷新缓存（菜单投影依赖）。
    fakeSettings.settings.autoDownloadAndInstallUpdates = false;
    await getAutoUpdatePreferences();
    expect(isAutoUpdateMode()).toBe(false);
  });

  it("生产缺省注入 electron-updater 单例（bugfix：缺省不再误走禁用分支）", async () => {
    // createRequire 的 CJS 通路无法被 vi.mock 拦截，真实模块在无 electron 环境下会崩；
    // 通过测试钩子替换缺省解析器，覆盖"未显式注入 updater"这条生产分支。
    const restoreResolver = __setBundledAutoUpdaterResolverForTest(() => fakeUpdater);
    try {
      initAutoUpdateService({
        settingService: fakeSettings.service,
        isPackaged: true,
        currentVersion: "1.0.0",
        silentCheckDelayMs: 600_000,
        broadcastState: (state) => broadcasts.push(state),
      });
      expect(getUpdateState()).toEqual({ kind: "idle", enabled: true });
      expect(await checkForUpdateManually()).toEqual({
        kind: "up-to-date",
        currentVersion: "1.0.0",
      });
    } finally {
      restoreResolver();
    }
  });

  it("手动检查无更新返回 up-to-date；feed 与偏好读写走设置", async () => {
    fakeUpdater.checkForUpdates.mockImplementation(async () => {
      fakeUpdater.emit("update-not-available", fakeInfo);
    });
    expect(await checkForUpdateManually()).toEqual({ kind: "up-to-date", currentVersion: "1.0.0" });

    await setUpdateFeedGithub({ owner: " foo ", repo: "bar" });
    expect(fakeSettings.settings.updateFeedGithubOwner).toBe("foo");
    expect(fakeSettings.settings.updateFeedGithubRepo).toBe("bar");

    const preferences = await getAutoUpdatePreferences();
    expect(preferences).toMatchObject({
      autoDownloadAndInstallUpdates: false,
      skippedUpdateVersion: null,
      updateFeedGithubOwner: "foo",
      updateFeedGithubRepo: "bar",
    });

    // 下次检查应用新的 feed
    fakeUpdater.checkForUpdates.mockImplementation(async () => {
      fakeUpdater.emit("update-not-available", fakeInfo);
    });
    await checkForUpdateManually();
    expect(fakeUpdater.setFeedURL).toHaveBeenLastCalledWith({
      provider: "github",
      owner: "foo",
      repo: "bar",
      releaseType: "release",
      useMultipleRangeRequest: false,
    } satisfies GithubFeedOptions);
  });
});
