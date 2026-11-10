// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IBroadcastService } from "@raspberrycode/services";
import { createRaspberryCodeStore } from "@/store/index.js";

function createBroadcastService(): IBroadcastService {
  return {
    send: vi.fn(async () => {}),
    acquireClaim: async () => ({ status: "unavailable" }),
    commitClaim: async () => {},
    releaseClaim: async () => {},
    tryClaim: async () => false,
    onMessage: () => ({ dispose: () => {} }),
  };
}

describe("store 主题默认值", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })),
    );
  });

  it("首次启动没有持久化值时主题跟随系统", () => {
    const store = createRaspberryCodeStore(createBroadcastService());
    expect(store.getState().theme).toBe("system");
  });

  it("保留用户已保存的主题选择", () => {
    localStorage.setItem("raspberrycode-theme", "light");
    const store = createRaspberryCodeStore(createBroadcastService());
    expect(store.getState().theme).toBe("light");
  });

  it("切换主题后持久化，且不再回落成默认值", () => {
    const store = createRaspberryCodeStore(createBroadcastService());
    store.getState().setTheme("dark");
    expect(localStorage.getItem("raspberrycode-theme")).toBe("dark");
    expect(store.getState().theme).toBe("dark");
  });
});
