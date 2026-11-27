import { TID_CHAT_MODEL_SELECT_TRIGGER, TID_V4_MODEL_CONFIG } from "@raspberrycode/shared/test-ids";

const COMBINED_TRIGGER_SELECTOR = `[data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"][data-composer-combined-model]`;
const MODEL_CONFIG_SELECTOR = `[data-testid="${TID_V4_MODEL_CONFIG}"]`;

/** 合并入口与开关由真实点击驱动，滑杆由键盘驱动，不用 DOM 值覆盖伪造 React 状态。 */
export async function selectCombinedComposerThoughtLevel(value: string): Promise<boolean> {
  // 工作区切换或 agent 冷启动会让旧 composer 卸载，刚打开的菜单随之消失。
  // 这不是“模型没有思考档位”：等新 composer 的配置锚点出现后重开一次菜单即可。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const trigger = $(COMBINED_TRIGGER_SELECTOR);
    if (!(await trigger.isExisting())) return false;
    await trigger.waitForClickable({ timeout: 30000 });
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    // 配置锚点随 composer 挂载，是“当前 pane 已可操作”的稳定信号；先等它再读档位，
    // 避免在 pane 切换的空窗期把整个 composer 的卸载误判成控件缺失。
    const configAnchor = $(MODEL_CONFIG_SELECTOR);
    try {
      await configAnchor.waitForExist({ timeout: 30000 });
    } catch (error) {
      // 失败时带上当前 DOM 摘要：工作区切换后 composer 未挂载时，仅报“元素不存在”无法定位。
      const diagnostics = await browser.execute(() => ({
        url: window.location.href,
        text: document.body?.innerText?.slice(0, 800) ?? "",
        testIds: Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
          .slice(0, 80)
          .map((element) => element.dataset.testid ?? ""),
      }));
      throw new Error(`v4-model-config 未出现: ${JSON.stringify(diagnostics)}`, { cause: error });
    }
    const slider = $('[data-testid="composer-thought-slider"]');
    const toggle = $('[data-testid="composer-thought-switch"]');
    if (await toggle.isExisting()) {
      const on = await toggle.getAttribute("data-on-value");
      const off = await toggle.getAttribute("data-off-value");
      if (value !== on && value !== off) throw new Error(`思考开关不支持档位 ${value}`);
      const checked = String(value === on);
      if ((await toggle.getAttribute("aria-checked")) !== checked) await toggle.click();
      await browser.waitUntil(
        async () => (await $(MODEL_CONFIG_SELECTOR).getAttribute("data-thought")) === value,
        {
          timeout: 15000,
        },
      );
      await browser.keys("Escape");
      return true;
    }
    if (!(await slider.isExisting())) {
      // 仅 Off 的模型没有可调控件；只能接受当前真实投影，不能伪造一次选择。
      const current = await configAnchor.getAttribute("data-thought");
      if (current === value) {
        await browser.keys("Escape");
        return true;
      }
      // 菜单可能因 pane 切换被卸载；第一次失败时关闭残留菜单，在新 composer 上重试。
      if (attempt === 0) {
        await browser.keys("Escape");
        continue;
      }
      throw new Error(`当前模型没有可调思考档位: ${value} (current=${current})`);
    }
    await slider.waitForExist({ timeout: 15000 });
    const levels = JSON.parse((await slider.getAttribute("data-levels")) ?? "[]") as string[];
    const index = levels.indexOf(value);
    if (index < 0) throw new Error(`合并菜单不支持思考档位 ${value}: ${levels.join(",")}`);
    if (Number(await slider.getValue()) !== index) {
      if ((await slider.getAttribute("aria-disabled")) === "true")
        throw new Error(`思考滑杆不可调整: ${value}`);
      await browser.execute(() =>
        document.querySelector<HTMLInputElement>('[data-testid="composer-thought-slider"]')?.focus(),
      );
      const waitForLevel = async (expected: number) => {
        // 已有会话提交档位会关闭菜单；断言配置投影，下一步再打开。
        await browser.waitUntil(
          async () =>
            (await $(MODEL_CONFIG_SELECTOR).getAttribute("data-thought")) === levels[expected],
          { timeout: 15000 },
        );
        await trigger.waitForClickable({ timeout: 30000 });
      };
      await browser.keys(index === levels.length - 1 ? "End" : "Home");
      await waitForLevel(index === levels.length - 1 ? index : 0);
      if (index !== levels.length - 1) {
        for (let step = 0; step < index; step++) {
          if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
          await browser.execute(() =>
            document
              .querySelector<HTMLInputElement>('[data-testid="composer-thought-slider"]')
              ?.focus(),
          );
          await browser.keys("ArrowRight");
          await waitForLevel(step + 1);
        }
      }
    }
    await browser.keys("Escape");
    return true;
  }
  return false;
}
