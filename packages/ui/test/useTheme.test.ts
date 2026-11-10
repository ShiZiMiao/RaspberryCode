// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, normalizeThemePreference } from "@/useTheme.js";

beforeEach(() => {
  document.head.innerHTML = "";
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-raspberrycode-browser-theme-surface");
  document.documentElement.removeAttribute("style");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeThemePreference", () => {
  it("没有持久化值（首次启动）默认跟随系统", () => {
    expect(normalizeThemePreference(null)).toBe("system");
    expect(normalizeThemePreference(undefined)).toBe("system");
    expect(normalizeThemePreference("")).toBe("system");
  });

  it("保留用户显式选择的主题，含 zai-* 旧代号读兼容", () => {
    expect(normalizeThemePreference("light")).toBe("light");
    expect(normalizeThemePreference("dark")).toBe("dark");
    expect(normalizeThemePreference("system")).toBe("system");
    expect(normalizeThemePreference("zai-light")).toBe("light");
    expect(normalizeThemePreference("zai-dark")).toBe("dark");
  });

  it("无法识别的值也回落到 system，而不是深色", () => {
    expect(normalizeThemePreference("sunset")).toBe("system");
  });
});

describe("applyTheme", () => {
  it.each([
    ["dark", "dark", "#161616"],
    ["light", "light", "#f8f8f8"],
  ] as const)("把 %s 同步到已 opt-in 的浏览器主题表面", (theme, resolvedTheme, background) => {
    document.documentElement.setAttribute("data-raspberrycode-browser-theme-surface", "light");
    document.documentElement.style.setProperty("--color-background", background);
    document.head.innerHTML = `
        <meta name="theme-color" content="#ffffff" />
        <meta name="color-scheme" content="light" />
      `;

    applyTheme(theme);

    expect(document.documentElement.getAttribute("data-raspberrycode-browser-theme-surface")).toBe(
      resolvedTheme,
    );
    expect(document.documentElement.style.colorScheme).toBe(resolvedTheme);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      background,
    );
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe(
      resolvedTheme,
    );
  });

  it("system 模式用浏览器偏好同步同一份 resolved theme", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    document.documentElement.setAttribute("data-raspberrycode-browser-theme-surface", "light");
    document.documentElement.style.setProperty("--color-background", "#161616");

    applyTheme("system");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-raspberrycode-browser-theme-surface")).toBe(
      "dark",
    );
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      "#161616",
    );
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe(
      "dark",
    );
  });

  it("未 opt-in 的 Electron 页面只切换既有主题 class", () => {
    applyTheme("dark");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("");
    expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
    expect(document.querySelector('meta[name="color-scheme"]')).toBeNull();
  });

  it("轻量 DOM shim 未提供浏览器表面能力时仍保留既有 class 切换", () => {
    const toggle = vi.fn();
    vi.stubGlobal("document", {
      documentElement: {
        classList: { toggle },
      },
    });

    expect(() => applyTheme("dark")).not.toThrow();
    expect(toggle).toHaveBeenCalledTimes(3);
  });
});
