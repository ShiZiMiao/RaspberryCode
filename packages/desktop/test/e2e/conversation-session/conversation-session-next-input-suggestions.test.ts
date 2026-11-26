// 下一步输入预测（spec：specs/next-input-suggestions.md）GUI 候选。
// 覆盖：回复结束后出现建议条、添加到对话框（追加）、点击直接发送、设置开关持久化。
import {
  TID_SETTINGS_NEXT_INPUT_PREDICTION_SWITCH,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  TID_V4_NEXT_INPUT_SUGGESTION,
  TID_V4_NEXT_INPUT_SUGGESTION_ADD,
  TID_V4_NEXT_INPUT_SUGGESTIONS,
  testId,
} from "@raspberrycode/shared/test-ids";
import { clearAppData, clickTestIdByDom, readSettings } from "../helpers/desktop-app.js";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4ComposerText,
  waitForV4UserMessageContaining,
} from "#e2e/helpers/v4-conversation";

const FIRST_PROMPT = "E2E_NEXT_INPUT_PROMPT_ONE";
const SECOND_PROMPT = "E2E_NEXT_INPUT_PROMPT_TWO";
const FIRST_REPLY = "NEXT_INPUT_REPLY_ONE";
const SECOND_REPLY = "NEXT_INPUT_REPLY_TWO";
const SUGGESTION_ONE = "E2E_NEXT_INPUT_ONE";

describe("下一步输入预测建议条", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("回复结束后展示建议条，可添加到对话框或直接发送，设置开关持久化", async function () {
    this.timeout(240_000);
    await prepareV4ConversationE2E();

    // 预测需要 ≥2 轮真实用户输入。
    await sendV4Prompt(FIRST_PROMPT);
    await waitForV4AssistantMessageContaining(FIRST_REPLY);
    await sendV4Prompt(SECOND_PROMPT);
    await waitForV4AssistantMessageContaining(SECOND_REPLY);

    const suggestions = await waitForNextInputSuggestions();
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    expect(suggestions[0]).toBe(SUGGESTION_ONE);

    // 多于 1 条时纵向排列：每条独占一行、左对齐。
    if (suggestions.length > 1) {
      const boxes = (await browser.execute(
        (containerTestId, chipTestId) => {
          const container = document.querySelector<HTMLElement>(
            `[data-testid="${containerTestId}"]`,
          );
          if (!container) return [];
          return Array.from(
            container.querySelectorAll<HTMLElement>(`[data-testid^="${chipTestId}-"]`),
          )
            .filter(
              (element) =>
                !element.getAttribute("data-testid")?.startsWith(`${chipTestId}-add-`),
            )
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return { top: Math.round(rect.top), left: Math.round(rect.left) };
            });
        },
        TID_V4_NEXT_INPUT_SUGGESTIONS,
        TID_V4_NEXT_INPUT_SUGGESTION,
      )) as Array<{ top: number; left: number }>;
      expect(boxes.length).toBe(suggestions.length);
      const first = boxes[0];
      if (!first) throw new Error("建议条没有渲染");
      for (let index = 1; index < boxes.length; index += 1) {
        const previous = boxes[index - 1];
        const current = boxes[index];
        if (!previous || !current) throw new Error("建议条布局数据缺失");
        expect(current.top).toBeGreaterThan(previous.top);
        expect(current.left).toBe(first.left);
      }
    }

    // 添加到对话框：追加而不是覆盖。
    await clickTestIdByDom(testId(TID_V4_NEXT_INPUT_SUGGESTION_ADD, "0"), {
      timeout: 15_000,
      timeoutMsg: "建议条没有出现「添加到对话框」按钮",
    });
    await waitForV4ComposerText(SUGGESTION_ONE, "建议没有追加到输入框");

    // 点击建议条直接发送；运行态下建议条消失。
    await clickTestIdByDom(testId(TID_V4_NEXT_INPUT_SUGGESTION, "0"), {
      timeout: 15_000,
      timeoutMsg: "建议条不可点击",
    });
    await waitForV4UserMessageContaining(SUGGESTION_ONE);
    await waitForNextInputSuggestionsGone();

    // 设置开关：默认开启，关闭后持久化为 false，再开启恢复 true。
    await openGeneralSettings();
    expect(await readNextInputPredictionSwitch()).toBe(true);
    await clickTestIdByDom(TID_SETTINGS_NEXT_INPUT_PREDICTION_SWITCH, {
      timeout: 15_000,
      timeoutMsg: "下一步输入预测开关不可点击",
    });
    await browser.waitUntil(
      async () => (await readSettings()).nextInputPredictionEnabled === false,
      { timeout: 15_000, timeoutMsg: "下一步输入预测设置没有持久化为 false" },
    );
    await clickTestIdByDom(TID_SETTINGS_NEXT_INPUT_PREDICTION_SWITCH, {
      timeout: 15_000,
      timeoutMsg: "下一步输入预测开关不可点击",
    });
    await browser.waitUntil(
      async () => (await readSettings()).nextInputPredictionEnabled === true,
      { timeout: 15_000, timeoutMsg: "下一步输入预测设置没有恢复为 true" },
    );
  });
});

async function waitForNextInputSuggestions(): Promise<string[]> {
  let latest: string[] = [];
  await browser.waitUntil(
    async () => {
      latest = (await browser.execute(
        (containerTestId, chipTestId) => {
          const container = document.querySelector<HTMLElement>(
            `[data-testid="${containerTestId}"]`,
          );
          if (!container) return [];
          return Array.from(
            container.querySelectorAll<HTMLElement>(`[data-testid^="${chipTestId}-"]`),
          )
            .filter(
              (element) =>
                !element.getAttribute("data-testid")?.startsWith(`${chipTestId}-add-`),
            )
            .map((element) => (element.textContent ?? "").trim());
        },
        TID_V4_NEXT_INPUT_SUGGESTIONS,
        TID_V4_NEXT_INPUT_SUGGESTION,
      )) as string[];
      return latest.length > 0;
    },
    { timeout: 30_000, timeoutMsg: "下一步输入预测建议条没有出现" },
  );
  return latest;
}

async function waitForNextInputSuggestionsGone(): Promise<void> {
  await browser.waitUntil(
    async () =>
      (await browser.execute(
        (containerTestId) =>
          !document.querySelector(`[data-testid="${containerTestId}"]`),
        TID_V4_NEXT_INPUT_SUGGESTIONS,
      )) as boolean,
    { timeout: 10_000, timeoutMsg: "发送建议后建议条没有消失" },
  );
}

async function openGeneralSettings(): Promise<void> {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15_000,
    timeoutMsg: "没有找到设置入口按钮",
  });
  await browser.waitUntil(
    async () =>
      browser.execute(
        (settingsPageTestId) =>
          Boolean(document.querySelector(`[data-testid="${settingsPageTestId}"]`)),
        TID_SETTINGS_PAGE,
      ),
    { timeout: 15_000, timeoutMsg: "设置页没有打开" },
  );
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"), {
    timeout: 15_000,
    timeoutMsg: "设置页没有常规分区入口",
  });
  await browser.waitUntil(async () => (await readNextInputPredictionSwitch()) !== null, {
    timeout: 15_000,
    timeoutMsg: "常规设置没有下一步输入预测开关",
  });
}

function readNextInputPredictionSwitch(): Promise<boolean | null> {
  return browser.execute((switchTestId) => {
    const control = document.querySelector<HTMLElement>(`[data-testid="${switchTestId}"]`);
    if (!control) return null;
    return (
      control.getAttribute("aria-checked") === "true" ||
      control.getAttribute("data-state") === "checked"
    );
  }, TID_SETTINGS_NEXT_INPUT_PREDICTION_SWITCH);
}
