import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TID_COMPOSER_WORKSPACE_TRIGGER,
  TID_TASK_NEW_BUTTON,
  TID_V4_COMPOSER_INPUT,
} from "@raspberrycode/shared/test-ids";
import {
  DEFAULT_CONVERSATION_WORKSPACE,
  clearAppData,
  getE2EAppDataPaths,
  restorePreviousWorkspaceOnStartup,
  seedSettings,
  switchToWorkspaceRendererWindow,
  waitForTestIdByDom,
  waitForWorkspaceApp,
} from "../helpers/desktop-app.js";
import { reloadElectronSessionPreservingBrowserProfile } from "../helpers/e2e-electron-reload.js";
import { dismissOccupationOnboarding } from "../helpers/occupation-onboarding.js";
import { getV4PaneSnapshot, waitForV4ComposerText, waitForV4Pane } from "../helpers/v4-conversation.js";

/**
 * 冷启动固定首页（spec：docs/superpowers/specs/2026-11-24-cold-start-home-design.md）。
 *
 * 验收边界只有两条，必须同时成立才算需求达成：
 *   1. 默认（开关开）冷启动 = 首页草稿 + 项目选择器显示「选择项目」，即便上次停在具体项目；
 *   2. 关闭开关后冷启动恢复上次激活的项目（旧行为可回退）。
 * 单测只覆盖了 Main 的 bootstrap 决策与 Renderer 的恢复收敛，
 * 这里的价值是「真实进程重启 + 真实界面」证明两条路径的用户可见结果。
 */
describe("cold start home E2E", () => {
  const { homeDir } = getE2EAppDataPaths();
  const projectPath = join(homeDir, "E2E_COLD_START_HOME_PROJECT");
  const caseMarker = "E2E_COLD_START_HOME";

  after(async () => {
    // 清理失败不能盖掉用例本身的断言结果：import 完 App 后目录可能仍被 Host/Agent 子进程持有，
    // Windows 上 rmdir 会抛 EBUSY。这里只做尽力清理，不影响 pass/fail 判定。
    await browser.electron.restoreAllMocks().catch(() => undefined);
    await clearAppData().catch(() => undefined);
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  /**
   * 首页场景专用的启动就绪判定。
   *
   * 直接复用 waitForWorkspaceApp(DEFAULT_CONVERSATION_WORKSPACE)：
   * probeWorkspaceAppState 里已经内置了 conversation workspace 分支
   * （路径以 /.raspberrycode/workspace/default 结尾时改用 composer 项目选择器判定），
   * 并会在遇到「选择 UI 模式」引导页时按 Escape 跳过。
   *
   * 不能传 DEFAULT_WORKSPACE：那是 E2E 预置的 RaspberryCodeProject，
   * 首页模式压根不会激活它，会等满 30s 后误报成产品缺陷。
   */
  async function waitForColdStartHomeReady() {
    await waitForWorkspaceApp(DEFAULT_CONVERSATION_WORKSPACE, 90_000);
  }

  /** 读取 tab store 的激活项，判定是否落在 conversation 首页。 */
  async function readActiveWorkspace() {
    return browser.execute(() => {
      const e2eWindow = window as Window & {
        __raspberrycodeTabStoreE2E?: {
          getState(): {
            activeWorkspacePath: string | null;
            tabs: Array<{
              kind: string;
              workspacePath?: string;
              workspacePurpose?: string;
            }>;
          };
        };
        __raspberrycodeSessionStoreE2E?: {
          getState(): {
            getWorkspaceState(path: string): {
              activeTaskId: string | null;
              draftProjectId?: string | null;
            };
          };
        };
      };
      const state = e2eWindow.__raspberrycodeTabStoreE2E?.getState();
      const activePath = state?.activeWorkspacePath ?? null;
      const activeTab = state?.tabs.find(
        (tab) => tab.kind === "workspace" && tab.workspacePath === activePath,
      );
      const workspace = activePath
        ? e2eWindow.__raspberrycodeSessionStoreE2E?.getState().getWorkspaceState(activePath)
        : undefined;
      return {
        activePath,
        activePurpose: activeTab?.workspacePurpose ?? null,
        activeTaskId: workspace?.activeTaskId ?? null,
        draftProjectId: workspace?.draftProjectId ?? null,
        workspacePaths: (state?.tabs ?? [])
          .filter((tab) => tab.kind === "workspace" && tab.workspacePath)
          .map((tab) => tab.workspacePath!),
      };
    });
  }

  it("CSH01: 默认开启时冷启动进入首页草稿，不选中任何项目", async function () {
    this.timeout(240_000);
    await mkdir(projectPath, { recursive: true });

    // 前置：让 lastActiveWorkspace 指向一个真实存在的项目——这才是「上次在项目里」的原始场景。
    // 这里必须显式删掉 startupShowHome 而不是只「不写」：同一 spec 内 CSH02 会写入 false，
    // 只靠不写会读到残留值，那验证的就不是 schema 默认值了。
    await reloadElectronSessionPreservingBrowserProfile(browser, {
      afterElectronProcessExit: async () => {
        const seeded = await seedSettings({
          lastActiveWorkspace: {
            kind: "local",
            workspacePath: projectPath,
            workspacePurpose: "project",
          },
          lastWorkspaceSession: [
            { kind: "local", workspacePath: projectPath, workspacePurpose: "project" },
          ],
          lastActiveTabIndex: 0,
        });
        // 移除该键，让冷启动走「设置里没有这个字段」的真实首次路径。
        const { startupShowHome: _omitted, ...withoutFlag } = seeded as typeof seeded & {
          startupShowHome?: boolean;
        };
        void _omitted;
        await writeFile(
          join(getE2EAppDataPaths().appDataDir, "setting.json"),
          JSON.stringify(withoutFlag),
          "utf-8",
        );
      },
    });

    // reload 之后才是真正的冷启动时刻：此时才切窗口/关引导，与 CSH02 的时序保持一致。
    await waitForColdStartHomeReady();

    // 断言 1：激活的是 conversation backing workspace，而不是上次的项目。
    await browser.waitUntil(
      async () => (await readActiveWorkspace()).activePath !== null,
      { timeout: 60_000, interval: 500, timeoutMsg: `${caseMarker}: 冷启动后 tab store 一直为空` },
    );
    const active = await readActiveWorkspace();
    expect(active.activePath).toBe(DEFAULT_CONVERSATION_WORKSPACE);
    expect(active.activePurpose).toBe("conversation");
    // 不选中任何项目：草稿没有项目归属，也没有活动任务。
    expect(active.draftProjectId).toBeNull();
    expect(active.activeTaskId).toBeNull();
    // 历史入口必须保留：上次的项目仍在 tab/侧栏数据源里，只是不再被激活。
    expect(active.workspacePaths).toContain(projectPath);

    // 断言 2：界面确实是首页草稿 —— 草稿 pane + 项目选择器显示「选择项目」。
    await waitForV4Pane((pane) => pane.sessionId === "draft", `${caseMarker}: 没有进入首页草稿`);
    expect((await getV4PaneSnapshot()).rowCount).toBe(0);

    const trigger = $(`[data-testid="${TID_COMPOSER_WORKSPACE_TRIGGER}"]`);
    await trigger.waitForDisplayed();
    // 文案由 i18n 决定：中文「选择项目」/ 英文 "Select project"。
    await browser.waitUntil(
      async () => /选择项目|Select project/i.test(await trigger.getText()),
      { timeout: 15_000, timeoutMsg: `${caseMarker}: 项目选择器没有显示「选择项目」` },
    );

    // 断言 3：输入框真的可用（首页不是只渲染了个空壳）。
    const editor = $(`[data-testid="${TID_V4_COMPOSER_INPUT}"]`);
    await editor.waitForDisplayed();
    await editor.click();
    await browser.keys("E2E_COLD_START_HOME");
    await waitForV4ComposerText("E2E_COLD_START_HOME", `${caseMarker}: 首页输入框不可用`);
  });

  it("CSH02: 关闭开关后冷启动恢复上次激活的项目", async function () {
    this.timeout(240_000);
    // CSH01 结束在首页；这里只需切到主 renderer 且侧栏可用（不要求进首页）。
    await switchToWorkspaceRendererWindow(`__cold_start_home_off__${Date.now()}`, 90_000);
    await dismissOccupationOnboarding();
    await browser
      .waitUntil(
        async () =>
          (await browser.execute(
            () => Boolean(document.querySelector('[data-testid="onboarding-page"]')),
          )) === false,
        { interval: 250, timeout: 30_000, timeoutMsg: `${caseMarker}: 引导页没有被关闭` },
      )
      .catch(() => undefined);
    await waitForTestIdByDom(TID_TASK_NEW_BUTTON, {
      timeout: 90_000,
      timeoutMsg: `${caseMarker}: 侧栏没有就绪`,
    });
    await mkdir(projectPath, { recursive: true });

    // 与 CSH01 完全相同的持久化前置，唯一差别是显式关闭首页开关。
    await reloadElectronSessionPreservingBrowserProfile(browser, {
      afterElectronProcessExit: async () => {
        await seedSettings({
          ...restorePreviousWorkspaceOnStartup(),
          lastActiveWorkspace: {
            kind: "local",
            workspacePath: projectPath,
            workspacePurpose: "project",
          },
          lastWorkspaceSession: [
            { kind: "local", workspacePath: projectPath, workspacePurpose: "project" },
          ],
          lastActiveTabIndex: 0,
        });
      },
    });

    await browser.waitUntil(
      async () => (await readActiveWorkspace()).activePath !== null,
      { timeout: 60_000, interval: 500, timeoutMsg: `${caseMarker}: 冷启动后 tab store 一直为空` },
    );
    const active = await readActiveWorkspace();
    // 旧行为可回退：激活项回到上次项目，而不是 conversation 首页。
    expect(active.activePath).toBe(projectPath);
    expect(active.activePurpose).not.toBe("conversation");
  });
});
