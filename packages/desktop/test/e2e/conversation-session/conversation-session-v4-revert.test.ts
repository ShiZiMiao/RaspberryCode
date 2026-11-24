// PV4-31/PV4-32：user 行「回退」入口（revertUserQuery）。
// 语义核心（与 editUserQuery 的差异）：回退后**不重发** —— 文件回到发送前、
// 旧回复消失、消息文本回到输入框且保持可编辑，上游请求数不增加。
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clearAppData, DEFAULT_WORKSPACE } from "../helpers/desktop-app.js";
import { countUpstreamRequestsContaining } from "../helpers/conversation-session-network.js";
import {
  approveV4Permission,
  cancelV4Revert,
  clickLatestV4Revert,
  confirmV4Revert,
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  readV4ComposerText,
  sendV4Prompt,
  switchV4Mode,
  waitForLatestV4CommandAck,
  waitForV4PermissionDialog,
  waitForV4Revert,
  waitForV4RevertConfirmDialog,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const CASE_ROOT = join(DEFAULT_WORKSPACE, "v4-revert-e2e");
const FILE_RELATIVE_PATH = "v4-revert-e2e/revert.txt";
const FILE_PATH = join(DEFAULT_WORKSPACE, FILE_RELATIVE_PATH);

describe("PV4-31/PV4-32 user message revert", () => {
  afterEach(async () => {
    await rm(CASE_ROOT, { force: true, recursive: true });
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("PV4-31 回退：文件恢复 + 对话截断 + 文本回填输入框，且不自动发送", async function () {
    this.timeout(180000);
    await prepareRevertCase();
    // 用例标记：断言「回退没有触发新的上游请求」时按它计数。
    const marker = "E2E_V4_REVERT_WITH_FILE";

    await sendV4Prompt(`${marker} 请更新 revert.txt`);
    await approvePendingFileWriteIfRequired();
    await waitForV4TimelineContaining("V4_REVERT_WITH_FILE_REPLY", 90000);
    await waitForFileContent(FILE_PATH, "revert-after\n");
    const sessionIdBefore = (await getV4PaneSnapshot()).sessionId;
    const requestsBeforeRevert = await waitForStableUpstreamCount(marker);

    await waitForV4Revert();
    const rowId = await clickLatestV4Revert();
    expect(rowId).toBeTruthy();
    await confirmV4Revert();

    const revertAck = await waitForLatestV4CommandAck("revertUserQuery", 60000);
    expect(revertAck.status).toBe("accepted");

    // 1) 文件回到发送前。
    await waitForFileContent(FILE_PATH, "revert-before\n");
    // 2) 旧回复与这条 user 消息都从时间线消失。
    await browser.waitUntil(
      async () => {
        const snapshot = await getV4PaneSnapshot();
        return !snapshot.timelineText.includes("V4_REVERT_WITH_FILE_REPLY");
      },
      { timeout: 60000, timeoutMsg: "回退后旧 assistant 回复仍在时间线里" },
    );
    // 3) 文本回到输入框，且可编辑（未自动发送）。
    await browser.waitUntil(
      async () => (await readV4ComposerText()).includes(marker),
      { timeout: 30000, timeoutMsg: "回退后输入框没有回填原消息文本" },
    );
    // 4) 会话没有因为回退而换 id，也没有自动发出新请求。
    expect((await getV4PaneSnapshot()).sessionId).toBe(sessionIdBefore);
    expect(await waitForStableUpstreamCount(marker)).toBe(requestsBeforeRevert);
  });

  it("PV4-32 无文件改动：只回退对话，输入框回填且不重发", async function () {
    this.timeout(180000);
    await prepareRevertCase();
    const marker = "E2E_V4_REVERT_NO_FILE";

    // 纯对话请求：明确不写文件。
    // 回复 marker 不能写进 prompt —— 时间线断言会命中 prompt 自身文本，
    // 回退即使成功也会被判成「旧回复仍在」（实测踩过）。
    await sendV4Prompt(`${marker} 请只回复指定内容，不要修改任何文件`);
    await waitForV4TimelineContaining("V4_REVERT_NO_FILE_REPLY", 90000);
    const requestsBeforeRevert = await waitForStableUpstreamCount(marker);

    await waitForV4Revert();
    await clickLatestV4Revert();
    await confirmV4Revert();

    const revertAck = await waitForLatestV4CommandAck("revertUserQuery", 60000);
    expect(revertAck.status).toBe("accepted");

    await browser.waitUntil(
      async () => {
        const snapshot = await getV4PaneSnapshot();
        return !snapshot.timelineText.includes("V4_REVERT_NO_FILE_REPLY");
      },
      { timeout: 60000, timeoutMsg: "无文件场景回退后旧回复仍在时间线里" },
    );
    await browser.waitUntil(
      async () => (await readV4ComposerText()).includes(marker),
      { timeout: 30000, timeoutMsg: "无文件场景回退后输入框没有回填原消息文本" },
    );
    expect(await waitForStableUpstreamCount(marker)).toBe(requestsBeforeRevert);
  });

  it("PV4-33 取消确认弹窗：任何状态都不改变", async function () {
    this.timeout(180000);
    await prepareRevertCase();
    const marker = "E2E_V4_REVERT_CANCEL";

    await sendV4Prompt(`${marker} 请更新 revert.txt`);
    await approvePendingFileWriteIfRequired();
    await waitForV4TimelineContaining("V4_REVERT_CANCEL_REPLY", 90000);
    await waitForFileContent(FILE_PATH, "revert-after\n");

    await waitForV4Revert();
    await clickLatestV4Revert();
    await waitForV4RevertConfirmDialog();
    await cancelV4Revert();

    // 取消后弹窗关闭、文件与时间线都保持原样。
    await browser.waitUntil(
      async () =>
        browser.execute(
          (dialogTestId) =>
            !document.querySelector(`[data-testid="${dialogTestId}"]`),
          "v4-revert-confirm-dialog",
        ),
      { timeout: 15000, timeoutMsg: "取消后回退确认弹窗没有关闭" },
    );
    expect(await readFile(FILE_PATH, "utf8")).toBe("revert-after\n");
    expect((await getV4PaneSnapshot()).timelineText).toContain("V4_REVERT_CANCEL_REPLY");
  });
});

async function prepareRevertCase() {
  await rm(CASE_ROOT, { force: true, recursive: true });
  await mkdir(CASE_ROOT, { recursive: true });
  await writeFile(FILE_PATH, "revert-before\n", "utf8");
  await prepareV4ConversationE2E();
  await switchV4Mode("yolo");
}

/**
 * 读一个「已经稳定」的上游请求计数。
 *
 * 两个陷阱必须同时避开：
 * 1. 抓包产物是异步落盘的，读到 0 不代表「没有请求」，只代表「还没写出来」。
 *    所以先等计数达到最小期望值（发送请求至少已落盘），再判稳定。
 * 2. 落盘过程中计数会递增，单次读数不可信；要连续两次相同才当基线。
 *
 * 少任何一条，「回退没有触发新请求」都会因为基线取成 0、回退后读到那次发送而误报。
 */
async function waitForStableUpstreamCount(marker: string, minimum = 1): Promise<number> {
  let previous = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await countUpstreamRequestsContaining(marker);
    if (current >= minimum && current === previous) return current;
    previous = current;
    await browser.pause(500);
  }
  throw new Error(`上游请求计数在超时内没有稳定: marker=${marker} last=${previous}`);
}

async function waitForFileContent(filePath: string, expected: string) {
  await browser.waitUntil(
    async () => (await readFile(filePath, "utf8").catch(() => "")) === expected,
    { timeout: 60000, timeoutMsg: `${filePath} 没有收敛到期望内容` },
  );
}

async function approvePendingFileWriteIfRequired() {
  try {
    await waitForV4PermissionDialog(15000);
    expect(await approveV4Permission()).toBe(true);
  } catch {
    // yolo 模式会直接执行；不同 permission registry 状态下也可能显式请求一次授权。
  }
}
