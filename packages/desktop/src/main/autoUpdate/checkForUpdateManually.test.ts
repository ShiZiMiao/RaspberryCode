/**
 * 手动「检查更新」结果映射回归测试。
 *
 * 缺陷背景（2026-11-16 UI 验收发现）：网络不通时用户点设置页「检查更新」，
 * 界面既无成功 toast 也无失败 toast，看起来像按钮没生效。
 *
 * 根因：`runCheck` 捕获错误后把 state 归位到 `idle`，而 `checkForUpdateManually`
 * 只看 state 就返回 `up-to-date`——把「检查失败」误报成「已是最新」。
 * 更糟的是这条 up-to-date 路径在实测里连 toast 都没出现，用户完全得不到反馈。
 *
 * spec 产品规则 6 要求六种结果 toast 都必须出现，其中包含「检查失败」，
 * 因此这里锁定两条断言：
 * 1. 检查抛错 → 必须是 `{ kind: "error" }`，绝不能是 `up-to-date`；
 * 2. 确实没有新版本 → 仍必须是 `up-to-date`（不能矫枉过正成 error）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setCheckTimeoutForTesting,
  checkForUpdateManually,
  initAutoUpdateService,
} from "./index.js";
import type { AutoUpdaterLike, SettingServiceLike } from "./contract.js";

/** 只实现状态机用到的端口；事件注册全部 no-op。 */
function createFakeUpdater(overrides: Partial<AutoUpdaterLike> = {}): AutoUpdaterLike {
  const updater: AutoUpdaterLike = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowDowngrade: true,
    setFeedURL: () => {},
    checkForUpdates: async () => undefined,
    downloadUpdate: async () => undefined,
    quitAndInstall: () => {},
    on: () => undefined,
    ...overrides,
  };
  return updater;
}

function createFakeSettingService(): SettingServiceLike {
  return {
    get: async () => ({}) as never,
    update: async () => undefined,
  };
}

describe("checkForUpdateManually 结果映射", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("检查抛出网络错误时返回 error，不得误报为「已是最新」", async () => {
    const updater = createFakeUpdater({
      checkForUpdates: async () => {
        throw new Error("net::ERR_CONNECTION_RESET");
      },
    });
    initAutoUpdateService({
      settingService: createFakeSettingService(),
      updater,
      isPackaged: true,
      currentVersion: "0.2.3",
    });

    const result = await checkForUpdateManually();

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("ERR_CONNECTION_RESET");
    }
  });

  it("确实没有新版本时仍返回 up-to-date（不能矫枉过正）", async () => {
    const updater = createFakeUpdater({
      checkForUpdates: async () => undefined,
    });
    initAutoUpdateService({
      settingService: createFakeSettingService(),
      updater,
      isPackaged: true,
      currentVersion: "0.2.3",
    });

    const result = await checkForUpdateManually();

    expect(result.kind).toBe("up-to-date");
    if (result.kind === "up-to-date") {
      expect(result.currentVersion).toBe("0.2.3");
    }
  });

  it("上一次检查失败后，新一次成功检查不得残留旧失败原因", async () => {
    const failing = createFakeUpdater({
      checkForUpdates: async () => {
        throw new Error("net::ERR_CONNECTION_RESET");
      },
    });
    initAutoUpdateService({
      settingService: createFakeSettingService(),
      updater: failing,
      isPackaged: true,
      currentVersion: "0.2.3",
    });
    const failed = await checkForUpdateManually();
    expect(failed.kind).toBe("error");

    // 换一个能正常返回的更新器重新初始化，模拟网络恢复后的下一次检查。
    // 失败记录若未被清空，这里会被误判成 error。
    initAutoUpdateService({
      settingService: createFakeSettingService(),
      updater: createFakeUpdater(),
      isPackaged: true,
      currentVersion: "0.2.3",
    });
    const recovered = await checkForUpdateManually();

    expect(recovered.kind).toBe("up-to-date");
  });

  it("更新器未初始化时返回 error，不得报「已是最新」", async () => {
    // isPackaged=false 让更新器保持未初始化（开发态语义由 dev-skipped 覆盖，
    // 这里直接验证 updater 为空时不会走到 up-to-date）。
    initAutoUpdateService({
      settingService: createFakeSettingService(),
      isPackaged: false,
      currentVersion: "0.2.3",
    });

    const result = await checkForUpdateManually();

    expect(result.kind).not.toBe("up-to-date");
  });

  it("checkForUpdates 永久挂起时不得无限等待（超时后必须给出结果）", async () => {
    // 实测场景：direct 路线走系统代理、GitHub 不可达时 electron-updater 的
    // promise 不会 reject，没有超时兜底按钮会永久停在「检查中…」。
    const updater = createFakeUpdater({
      checkForUpdates: () => new Promise(() => {}),
    });
    initAutoUpdateService({
      settingService: createFakeSettingService(),
      updater,
      isPackaged: true,
      currentVersion: "0.2.3",
    });

    // 用注入的短超时走真实计时，避免 fake timers 与内部 await 链的兼容问题。
    __setCheckTimeoutForTesting(30);
    try {
      const result = await checkForUpdateManually();
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.message).toContain("timed out");
      }
    } finally {
      __setCheckTimeoutForTesting(null);
    }
  });
});
