import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TID_CONFIRM_DIALOG_CONFIRM, TID_TASK_ITEM, testId } from "@raspberrycode/shared/test-ids";
import { clearAppData, clickTestIdByDom } from "../../../helpers/desktop-app.js";
import {
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";
import { ensureUpstreamProviderForE2E } from "../../../helpers/upstream-provider.js";

const CASE_TIMEOUT_MS = 150_000;
const PROMPT_MARKER = "E2E_TASK_DELETE_CONTEXT_MENU";
const REPLY_MARKER = "TASK_DELETE_CONTEXT_MENU_OK";
const DELETE_LABELS = ["Delete task", "删除任务"];
const artifactDir = resolve(
  process.env.RASPBERRYCODE_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/task-delete-context-menu",
);

describe("TSL40：任务右键菜单删除任务", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("右键删除先确认再移除任务行，写 deleted 标记且保留 CLI 会话", async function () {
    this.timeout(CASE_TIMEOUT_MS);

    await prepareV4ConversationE2E();
    await ensureUpstreamProviderForE2E();
    await sendV4Prompt(`${PROMPT_MARKER}: Reply with exactly "${REPLY_MARKER}".`);
    await waitForV4TimelineContaining(REPLY_MARKER, 60_000);
    await waitForV4Pane(
      (snapshot) =>
        Boolean(snapshot.sessionId && snapshot.sessionId !== "draft") && !snapshot.canStop,
      "删除任务 case 的前置任务没有完成",
      60_000,
    );
    const taskId = (await getV4PaneSnapshot()).sessionId;
    if (!taskId || taskId === "draft") {
      throw new Error(`删除任务 case 缺少 taskId: ${String(taskId)}`);
    }

    await waitForTaskRow(taskId, true, "侧栏没有出现待删除的任务行");
    expect(readTaskIndexDeleted(taskId)).toBe(0);
    expect(readCliSessionState(taskId).count).toBe(1);

    await mkdir(artifactDir, { recursive: true });
    await dumpGeometry("BEFORE-DELETE");
    await openTaskContextMenu(taskId);
    await browser.saveScreenshot(join(artifactDir, "task-context-menu-delete.png"));

    // 取消路径：确认框出现后按 Escape，任务行和持久化事实都必须原样保留。
    await clickTaskMenuItem(DELETE_LABELS);
    await waitForDeleteConfirmDialog();
    await browser.saveScreenshot(join(artifactDir, "task-delete-confirm-dialog.png"));
    await browser.keys("Escape");
    await $("[role='dialog']").waitForExist({ reverse: true, timeout: 10_000 });
    await waitForTaskRow(taskId, true, "取消删除后任务行从列表消失了");
    expect(readTaskIndexDeleted(taskId)).toBe(0);

    // 确认路径：真正执行删除。
    await openTaskContextMenu(taskId);
    await clickTaskMenuItem(DELETE_LABELS);
    await waitForDeleteConfirmDialog();
    await clickTestIdByDom(TID_CONFIRM_DIALOG_CONFIRM, {
      timeout: 15_000,
      timeoutMsg: "删除确认框的确认按钮没有出现",
    });

    await waitForTaskRow(taskId, false, "确认删除后任务行仍留在任务列表");
    await dumpGeometry("AFTER-DELETE");
    await browser.pause(1200);
    await dumpGeometry("AFTER-DELETE-SETTLED");
    // 删除事实由 tasks-index 持久化；CLI 会话与正文必须保留（不物理清理）。
    // 回归护栏：删除任务曾导致布局整体下推、输入区被裁出视口。
    // 根因是 renderer 在同一 #root 上重复 createRoot，多个整高 root 与错误兜底卡片叠加。
    // 这里以"根节点只有一个整高子节点且贴合视口顶部"作为布局不变量，防止再次复发。
    const layout = await readRootLayout();
    expect(layout.rootChildCount).toBe(1);
    expect(layout.errorCardCount).toBe(0);
    expect(layout.frameOffsetY).toBe(0);
    expect(layout.frameHeight).toBe(layout.viewportHeight);
    // 草稿首页必须保持「问候语 + 输入框」整组居中：两者紧邻（不能隔着半屏），
    // 整组中心落在视口中部。8e4ca64a 把 dock 移出滚动容器后曾破坏该不变量，
    // 表现为输入框被推到底、与问候语脱开。
    expect(layout.greetingToComposerGap).toBe(72);
    expect(layout.groupCenterRatio).toBeGreaterThan(0.38);
    expect(layout.groupCenterRatio).toBeLessThan(0.46);

    await browser.waitUntil(() => readTaskIndexDeleted(taskId) === 1, {
      timeout: 30_000,
      timeoutMsg: "删除后 tasks-index 没有写入 deleted 标记",
    });
    expect(readCliSessionState(taskId).count).toBe(1);
  });
});

async function dumpGeometry(label: string) {
  const dump = await browser.execute(() => {
    const describe = (el: Element | null, name: string) => {
      if (!el) return { name, missing: true };
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return {
        name,
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        position: s.position,
        display: s.display,
        overflow: s.overflow,
        transform: s.transform,
        className: String((el as HTMLElement).className ?? "").slice(0, 160),
      };
    };
    return {
      viewport: { innerHeight: window.innerHeight, innerWidth: window.innerWidth },
      html: {
        scrollTop: document.documentElement.scrollTop,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
        overflow: window.getComputedStyle(document.documentElement).overflow,
      },
      body: {
        scrollTop: document.body.scrollTop,
        scrollHeight: document.body.scrollHeight,
        clientHeight: document.body.clientHeight,
        overflow: window.getComputedStyle(document.body).overflow,
        paddingTop: window.getComputedStyle(document.body).paddingTop,
        marginTop: window.getComputedStyle(document.body).marginTop,
      },
      bodyChildren: Array.from(document.body.children).map((el, index) =>
        describe(el, `body>${index}:${el.tagName.toLowerCase()}`),
      ),
      windowFrame: describe(document.querySelector("[data-desktop-window-frame]"), "window-frame"),
      workspaceShell: describe(document.querySelector("[data-workspace-shell]"), "workspace-shell"),
      sidebar: describe(document.querySelector("[data-workspace-sidebar-panel]"), "sidebar"),
      timeline: describe(document.querySelector("[data-v4-timeline-scroll]"), "timeline"),
      root: describe(document.querySelector("#root"), "root"),
      draftEmpty: describe(document.querySelector("[data-testid='chat-empty']"), "draft-empty"),
      greeting: describe(document.querySelector("[data-v4-draft-greeting='true']"), "greeting"),
      composers: Array.from(document.querySelectorAll<HTMLElement>("[contenteditable='true']")).map(
        (el) => {
          const r = el.getBoundingClientRect();
          return { y: Math.round(r.y), h: Math.round(r.height) };
        },
      ),
      visualViewport: window.visualViewport
        ? {
            h: Math.round(window.visualViewport.height),
            scale: window.visualViewport.scale,
            offsetTop: Math.round(window.visualViewport.offsetTop),
          }
        : null,
      activeElement: {
        tag: document.activeElement?.tagName.toLowerCase() ?? null,
        className: String((document.activeElement as HTMLElement | null)?.className ?? "").slice(
          0,
          120,
        ),
      },
    };
  });
  console.log(`[GEOMETRY ${label}] ${JSON.stringify(dump)}`);
}

async function waitForTaskRow(taskId: string, expected: boolean, timeoutMsg: string) {
  await browser.waitUntil(
    () =>
      browser
        .execute(
          (taskItemTestId) => Boolean(document.querySelector(`[data-testid="${taskItemTestId}"]`)),
          testId(TID_TASK_ITEM, taskId),
        )
        .then((exists) => exists === expected),
    { timeout: 30_000, timeoutMsg },
  );
}

async function openTaskContextMenu(taskId: string) {
  const opened = await browser.execute(
    (taskItemTestId) => {
      const row = document.querySelector<HTMLElement>(`[data-testid="${taskItemTestId}"]`);
      if (!row) {
        return false;
      }
      // 右键菜单由 Radix 监听真实 contextmenu 事件；坐标取行中心，避免落到行内按钮上。
      const rect = row.getBoundingClientRect();
      row.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }),
      );
      return true;
    },
    testId(TID_TASK_ITEM, taskId),
  );
  expect(opened).toBe(true);

  await browser.waitUntil(
    () =>
      browser.execute(
        (labels) =>
          Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).some((item) =>
            labels.includes((item.textContent ?? "").trim()),
          ),
        DELETE_LABELS,
      ),
    { timeout: 15_000, timeoutMsg: "任务右键菜单没有出现“删除任务”" },
  );
}

async function clickTaskMenuItem(labels: string[]) {
  const clicked = await browser.execute((candidates) => {
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (node) => candidates.includes((node.textContent ?? "").trim()),
    );
    item?.click();
    return Boolean(item);
  }, labels);
  expect(clicked).toBe(true);
}

async function waitForDeleteConfirmDialog() {
  await browser.waitUntil(
    async () => {
      const dialog = await $("[role='dialog']");
      if (!(await dialog.isExisting())) {
        return false;
      }
      const text = await dialog.getText();
      return ["Delete this task?", "删除这个任务？"].some((title) => text.includes(title));
    },
    { timeout: 15_000, timeoutMsg: "点击删除后没有出现删除确认框" },
  );
}

function readTaskIndexDeleted(taskId: string): number {
  const database = new DatabaseSync(join(homedir(), ".raspberrycode", "v2", "tasks-index.sqlite"), {
    readOnly: true,
  });
  try {
    const row = database.prepare("select deleted from tasks where task_id = ?").get(taskId) as
      | { deleted?: number | null }
      | undefined;
    return row?.deleted ?? 0;
  } finally {
    database.close();
  }
}

function readCliSessionState(taskId: string): { count: number } {
  // 删除只写列表 membership，CLI 会话必须仍在；被物理清理时这里会变成 0。
  const database = new DatabaseSync(join(homedir(), ".raspberrycode", "cli", "db", "db.sqlite"), {
    readOnly: true,
  });
  try {
    return database.prepare("select count(*) as count from session where id = ?").get(taskId) as {
      count: number;
    };
  } finally {
    database.close();
  }
}

async function readRootLayout(): Promise<{
  rootChildCount: number;
  errorCardCount: number;
  frameOffsetY: number;
  frameHeight: number;
  viewportHeight: number;
  greetingToComposerGap: number | null;
  groupCenterRatio: number | null;
}> {
  return browser.execute(() => {
    const root = document.querySelector("#root");
    const frame = document.querySelector("[data-desktop-window-frame]");
    const rect = frame?.getBoundingClientRect();
    const greeting = document.querySelector("[data-v4-draft-greeting='true']");
    const composerCard = document
      .querySelector("[contenteditable='true']")
      ?.closest(".rounded-2xl");
    const greetingRect = greeting?.getBoundingClientRect();
    const composerRect = composerCard?.getBoundingClientRect();
    return {
      rootChildCount: root ? root.children.length : -1,
      // 错误边界的兜底卡片使用 destructive 边框；出现即说明子树渲染失败。
      errorCardCount: root ? root.querySelectorAll(".border-destructive\\/20").length : -1,
      frameOffsetY: rect ? Math.round(rect.y) : -1,
      frameHeight: rect ? Math.round(rect.height) : -1,
      viewportHeight: window.innerHeight,
      greetingToComposerGap:
        greetingRect && composerRect ? Math.round(composerRect.y - greetingRect.bottom) : null,
      groupCenterRatio:
        greetingRect && composerRect
          ? +(((greetingRect.y + composerRect.bottom) / 2) / window.innerHeight).toFixed(3)
          : null,
    };
  }) as Promise<{
    rootChildCount: number;
    errorCardCount: number;
    frameOffsetY: number;
    frameHeight: number;
    viewportHeight: number;
    greetingToComposerGap: number | null;
    groupCenterRatio: number | null;
  }>;
}
