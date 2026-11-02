// @vitest-environment jsdom
import { createElement, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelConfigSelect, type ModelSelectGroup } from "@/ModelConfigSelect.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
const items = [{ key: "m", value: "shared/model", name: "GLM-5.3" }];
const groups: ModelSelectGroup[] = [
  {
    key: "agent",
    label: "GLM",
    labelBadge: "API",
    items: [{ ...items[0]!, value: "glm/model" }],
  },
  { key: "one", label: "Qwen", labelBadge: "API", items },
  { key: "two", label: "Kimi", labelBadge: "API", items },
  {
    key: "api",
    label: "DeepSeek",
    labelBadge: "API",
    items: [{ key: "api", value: "api/model", name: "API model" }],
  },
];
function Harness({ pending = false, error = null }: { pending?: boolean; error?: string | null }) {
  const [selected, setSelected] = useState("agent");
  const [model, setModel] = useState("glm/model");
  return createElement(
    ZCodeIntlProvider,
    { locale: "en-US" },
    createElement(
      TooltipProvider,
      null,
      createElement(ModelConfigSelect, {
        modelGroups: groups,
        normalizedValue: model,
        triggerLabel: "GLM-5.3",
        tooltipTitle: "GLM-5.3",
        lockReasonMessage: "",
        isItemLocked: () => false,
        onValueChange: setModel,
        open: true,
        onOpenChange: () => {},
        focusSelectorOnClose: null,
        composerOptions: {
          providerLabel: "Provider",
          modelsLabel: "Models",
          effortLabel: "Effort",
          selectModelLabel: "Select model",
          levels: [
            { value: "low", label: "Low" },
            { value: "high", label: "High" },
          ],
          value: "low",
          onValueChange: () => {},
          providerMenu: {
            groups,
            selectedKey: selected,
            pending,
            error,
            onSelect: (g) => {
              setSelected(g.key);
              setModel(g.items[0]!.value);
            },
          },
        },
      }),
    ),
  );
}
beforeEach(() => {
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(cleanup);
describe("Composer direct provider menu", () => {
  it("保持主菜单一行供应商，直接选择第二个供应商时勾选不落到同模型的第一个供应商", async () => {
    render(createElement(Harness));
    expect(screen.queryByTestId("composer-connection-trigger")).toBeNull();
    fireEvent.keyDown(screen.getByTestId("composer-provider-trigger"), { key: "ArrowRight" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Kimi API" }));
    await waitFor(() =>
      expect(screen.getByTestId("composer-provider-trigger").textContent).toContain("Kimi"),
    );
    fireEvent.keyDown(screen.getByTestId("composer-provider-trigger"), { key: "ArrowRight" });
    expect(
      (await screen.findByRole("menuitemradio", { name: "Kimi API" })).getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    expect(
      screen.getByRole("menuitemradio", { name: "Qwen API" }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(screen.getByRole("menuitemradio", { name: "DeepSeek API" })).toBeTruthy();
  });
  it.each([false, true])(
    "切换 loading 有明确反馈且不替换原名称，失败结束后可重试（窄屏=%s）",
    async (narrow) => {
      window.matchMedia = vi.fn().mockReturnValue({
        matches: narrow,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      const { rerender } = render(createElement(Harness, { pending: true }));
      const trigger = screen.getByTestId("composer-provider-trigger");
      expect(trigger.getAttribute("aria-disabled")).toBe("true");
      expect(trigger.getAttribute("aria-busy")).toBe("true");
      expect(trigger.textContent).toContain("GLM");
      expect(screen.getByRole("status", { name: "Loading..." })).toBeTruthy();
      expect(screen.getByRole("slider").getAttribute("aria-disabled")).toBe("true");
      rerender(createElement(Harness, { error: "Switch failed; retry" }));
      expect(screen.queryByRole("status", { name: "Loading..." })).toBeNull();
      if (narrow) expect(screen.getByTestId("composer-provider-back")).toBeTruthy();
      else {
        expect(screen.getByTestId("composer-provider-trigger")).toBe(trigger);
        expect(trigger.getAttribute("aria-disabled")).not.toBe("true");
      }
      expect((await screen.findByRole("alert")).textContent).toContain("retry");
      expect(
        screen.getByRole("alert").parentElement?.querySelector("[data-composer-provider-list]"),
      ).toBeTruthy();
    },
  );
  it("窄屏使用现有返回导航，选供应商后回到模型页", async () => {
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    render(createElement(Harness));
    fireEvent.click(screen.getByTestId("composer-provider-trigger"));
    expect(screen.getByTestId("composer-provider-back")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Qwen API" }));
    await waitFor(() =>
      expect(screen.getByTestId("composer-provider-trigger").textContent).toContain("Qwen"),
    );
    expect(screen.queryByTestId("composer-provider-back")).toBeNull();
    expect(screen.getByRole("slider")).toBeTruthy();
  });
});

it("连接 loading 期间固定原菜单展示，完成后一次采用新目录", () => {
  const content = (pending: boolean, target: boolean) =>
    createElement(
      ZCodeIntlProvider,
      { locale: "en-US" },
      createElement(
        TooltipProvider,
        null,
        createElement(ModelConfigSelect, {
          modelGroups: target ? [groups[3]!] : groups,
          normalizedValue: target ? "api/model" : "glm/model",
          triggerLabel: target ? "API model" : "GLM-5.3",
          lockReasonMessage: "",
          isItemLocked: () => false,
          onValueChange: () => {},
          open: true,
          onOpenChange: () => {},
          composerOptions: {
            providerLabel: "Provider",
            modelsLabel: "Models",
            effortLabel: "Effort",
            selectModelLabel: "Select model",
            levels: target
              ? []
              : [
                  { value: "low", label: "Low" },
                  { value: "high", label: "High" },
                ],
            value: target ? "" : "low",
            onValueChange: () => {},
            providerMenu: {
              groups: target ? [groups[3]!] : groups,
              selectedKey: target ? "api" : "agent",
              pending,
              error: null,
              onSelect: () => {},
            },
          },
        }),
      ),
    );
  const ui = render(content(false, false));
  expect(screen.getByTestId("composer-thought-slider").getAttribute("aria-valuetext")).toBe("Low");
  ui.rerender(content(true, true));
  expect(screen.getByTestId("composer-thought-slider").getAttribute("aria-valuetext")).toBe("Low");
  expect(screen.getByTestId("composer-provider-trigger").textContent).toContain("GLM");
  ui.rerender(content(false, true));
  expect(screen.queryByTestId("composer-thought-slider")).toBeNull();
  expect(screen.getByTestId("composer-provider-trigger").textContent).toContain("DeepSeek");
});
