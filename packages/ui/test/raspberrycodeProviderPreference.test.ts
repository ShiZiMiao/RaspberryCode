import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRaspberryCodeSessionStore } from "../src/store/raspberrycodeSessionStore.js";
import { LAST_SELECTED_AGENT_PROVIDER_STORAGE_KEY } from "../src/lib/raspberrycodeProviderPreference.js";

function createStorageMock(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));

  return {
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe("agent provider preference", () => {
  beforeEach(() => {
    useRaspberryCodeSessionStore.setState((state) => ({
      ...state,
      workspaces: {},
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("startDraft 选择旧 provider 时也会立即归一最近一次选择", () => {
    const storage = createStorageMock();
    vi.stubGlobal("window", { localStorage: storage });

    useRaspberryCodeSessionStore.getState().startDraft("/tmp/workspace-draft", "gemini");

    expect(storage.getItem(LAST_SELECTED_AGENT_PROVIDER_STORAGE_KEY)).toBe("agent");
    expect(
      useRaspberryCodeSessionStore.getState().getWorkspaceState("/tmp/workspace-draft").selectedProvider,
    ).toBe("agent");
  });
});
