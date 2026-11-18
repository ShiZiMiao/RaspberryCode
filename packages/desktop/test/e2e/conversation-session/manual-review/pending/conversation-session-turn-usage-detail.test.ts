import { clearAppData } from "../../../helpers/desktop-app.js";
import { TID_V4_TURN_USAGE_CHIP, TID_V4_TURN_USAGE_PANEL } from "@raspberrycode/shared/test-ids";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4UserMessageContaining,
} from "#e2e/helpers/v4-conversation";

// ── 数值口径（改断言前务必先读懂）─────────────────────────────────────────
// fixture 在 wire 上给的是 Anthropic 协议：
//   input_tokens = 2071（不含缓存）、cache_read_input_tokens = 565760、output_tokens = 1459
// AI SDK 把 usage.inputTokens 归一成「含缓存的合计」：
//   inputTokens.total = noCache 2071 + cacheWrite 0 + cacheRead 565760 = 567831
// 所以本轮 inputTokens=567831、cacheReadTokens=565760、outputTokens=1459。
//
// 正确合计 = inputTokens + outputTokens = 569290 → 「56.9万」
// 若把缓存读取再叠一次 = 1135050 → 「113万」（最容易犯的口径错误）
const EXPECTED_TOTAL_LABEL = "56.9万";
const WRONG_TOTAL_PREFIX = "113";
// 命中率 = cacheRead / inputTokens = 565760 / 567831 = 99.6%
const EXPECTED_HIT_RATE = "99.6%";
const MARKER = "E2E_TURN_USAGE_DETAIL";
const REPLY_MARKER = "TURN_USAGE_DETAIL_OK";

/**
 * 等到本轮真正结束（停止按钮消失）且助手回复进入时间线。
 *
 * 不能用「时间线包含 marker」当完成条件：用户输入本身含 marker，
 * 刚发出去就匹配成功，后续断言会在 chip 尚未投影时就读。
 */
async function waitForTurnSettledWithReply(): Promise<void> {
  await waitForV4UserMessageContaining(MARKER);
  await waitForV4Pane(
    (snapshot) => !snapshot.canStop && snapshot.timelineText.includes(REPLY_MARKER),
    "首轮回复没有结束或回复正文缺失",
    90000,
  );
}

/**
 * 在 renderer 内直接读本轮（最后一个）用量 chip 的可见文本。
 *
 * 走 execute 而不是 `$().getText()`：chip 文字在 `truncate` 的内层 span 里，
 * WebDriver 的可见性裁剪会让 getText() 返回空串；而且非链式上下文里
 * ChainablePromiseElement 与 WebdriverIO.Element 类型不兼容。execute 读 innerText
 * 与 getV4PaneSnapshot 的 timelineText 同源，最贴近用户实际看到的文字。
 */
function readUsageChipText(): Promise<string | null> {
  return browser.execute((testId: string) => {
    const chips = document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`);
    const chip = chips[chips.length - 1];
    return chip ? chip.innerText.replace(/\u00a0/g, " ") : null;
  }, TID_V4_TURN_USAGE_CHIP);
}

function readPanelExists(testId: string): boolean {
  return document.querySelectorAll(`[data-testid="${testId}"]`).length > 0;
}

/**
 * 把指针移到 chip 上并读回面板文本。
 *
 * 面板是 Radix HoverCard：内容 Portal 到 body，只在 open 时挂载。必须投递完整的
 * pointer 序列（pointerover→pointerenter→mouseover），单次 moveTo 触发不了。
 * 先派发原生事件把目标钉在 chip 本身（不依赖坐标命中），再补真实 pointer 移动；
 * 面板是否出现由 waitUntil 断言，不用固定等待。
 */
async function hoverUsageChipAndReadPanel(): Promise<string> {
  const box = await browser.execute((testId: string) => {
    const chips = document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`);
    const chip = chips[chips.length - 1];
    if (!chip) return null;
    chip.scrollIntoView({ block: "center" });
    const rect = chip.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    for (const type of ["pointerover", "pointerenter", "mouseover", "mousemove"]) {
      const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      chip.dispatchEvent(
        new Ctor(type, {
          bubbles: type !== "pointerenter" && type !== "mouseenter",
          cancelable: true,
          clientX: centerX,
          clientY: centerY,
          pointerType: "mouse",
        }),
      );
    }
    return { x: Math.round(centerX), y: Math.round(centerY) };
  }, TID_V4_TURN_USAGE_CHIP);

  if (!box) throw new Error("时间线里没有找到轮尾用量 chip");
  await browser
    .action("pointer")
    .move({ x: box.x, y: box.y })
    .pause(200)
    .move({ x: box.x + 1, y: box.y + 1 })
    .perform();

  await browser.waitUntil(
    async () => (await browser.execute(readPanelExists, TID_V4_TURN_USAGE_PANEL)) === true,
    {
      timeout: 10000,
      timeoutMsg: "hover 用量 chip 后明细面板没有出现",
    },
  );

  const panelText = await browser.execute((testId: string) => {
    const panels = document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`);
    const panel = panels[panels.length - 1];
    return panel ? panel.innerText.replace(/\u00a0/g, " ") : null;
  }, TID_V4_TURN_USAGE_PANEL);
  if (panelText === null) throw new Error("明细面板已消失，读不到文本");
  return panelText;
}

/** 读取 hover 后可见的 tooltip 文本列表（Radix Tooltip 同样是 Portal）。 */
function readTooltipTexts(): Promise<string[]> {
  return browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')].map((tip) =>
      tip.innerText.replace(/\u00a0/g, " ").trim(),
    ),
  );
}

describe("轮尾用量与重新生成 E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("chip 只报用量合计，缓存命中率与提供方只在明细面板出现", async function () {
    this.timeout(150000);
    await prepareV4ConversationE2E();

    await sendV4Prompt(`${MARKER} 请只回复固定标记。`);
    await waitForTurnSettledWithReply();

    // ① chip 合计 = inputTokens + outputTokens（缓存读取是 input 侧明细，不能再叠）。
    const chipText = await readUsageChipText();
    expect(chipText).not.toBeNull();
    expect(chipText!).toContain("用量");
    expect(chipText!).toContain(EXPECTED_TOTAL_LABEL);
    // 双重叠加会把总量翻倍到 113 万，这是本断言真正要拦住的口径错误。
    expect(chipText!).not.toContain(WRONG_TOTAL_PREFIX);

    // ② 命中率属于面板，塞进动作行会把同排图标挤掉。
    expect(chipText!).not.toContain(EXPECTED_HIT_RATE);
    expect(chipText!).not.toContain("缓存命中");

    // ③ 面板：提供方/模型、缓存命中、未缓存输入、缓存读取、输出五行齐全。
    const panelText = await hoverUsageChipAndReadPanel();
    expect(panelText).toContain("本轮用量");
    expect(panelText).toContain("提供方 / 模型");
    expect(panelText).toContain("缓存命中");
    expect(panelText).toContain(EXPECTED_HIT_RATE);
    expect(panelText).toContain("未缓存输入");
    expect(panelText).toContain("缓存读取");
    expect(panelText).toContain("输出");

    // ④ 提供方必须显示成用户认得的名字，不能露出自动生成的 providerId。
    expect(panelText).not.toMatch(/new-provider|provider-[0-9a-f]{8}/i);

    // ⑤ 未缓存输入 = inputTokens - cacheRead = 2071，不能是负数、也不能是整份 567831。
    expect(panelText).toContain("2071");
    expect(panelText).not.toContain("-2071");
  });

  it("重新生成入口出现在最新 assistant 行，tooltip 提示会重新生成产物", async function () {
    this.timeout(150000);
    await prepareV4ConversationE2E();

    await sendV4Prompt(`${MARKER} 请只回复固定标记。`);
    await waitForTurnSettledWithReply();

    // retry 只在「全时间线最后一条 assistant + 该轮有真实用户输入」时出现，
    // 且必须带 canRetry 能力位，否则点了会被服务端拒绝。
    const retry = await browser.execute(() => {
      const buttons = [...document.querySelectorAll<HTMLElement>('[data-testid^="v4-retry-"]')];
      const button = buttons[buttons.length - 1];
      if (!button) return null;
      button.scrollIntoView({ block: "center" });
      const rect = button.getBoundingClientRect();
      return {
        count: buttons.length,
        ariaLabel: button.getAttribute("aria-label"),
        disabled: (button as HTMLButtonElement).disabled,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    });
    expect(retry).not.toBeNull();
    expect(retry!.count).toBe(1);
    expect(retry!.ariaLabel).toBe("重新生成");
    expect(retry!.disabled).toBe(false);

    // tooltip 文案必须说清「会重新生成产物」，否则用户不知道代价。
    await browser
      .action("pointer")
      .move({ x: retry!.x, y: retry!.y })
      .pause(200)
      .move({ x: retry!.x + 1, y: retry!.y + 1 })
      .perform();

    await browser.waitUntil(
      async () => {
        const tips = await readTooltipTexts();
        return tips.some((text) => text.includes("重新生成") && text.includes("谨慎"));
      },
      {
        timeout: 10000,
        timeoutMsg: "重新生成按钮 hover 后没有出现「会重新生成会话和产物」的确认提示",
      },
    );
  });
});
