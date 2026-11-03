import { describe, expect, it } from "vitest";
import type { RaspberryCodeSessionSettingsState } from "@raspberrycode/shared";
import {
  getRaspberryCodeAgentAvailableModes,
  normalizeAvailableRaspberryCodeMode,
  settingsToConfigOptions,
} from "../src/raspberrycode-agent/raspberrycodeConfigOptions.js";

function settingsWithMode(
  mode: RaspberryCodeSessionSettingsState["mode"]["current"],
): RaspberryCodeSessionSettingsState {
  return {
    model: {
      current: { providerId: "agent", modelId: "glm-5" },
      available: [],
    },
    thoughtLevel: {
      enabled: false,
      available: [],
    },
    mode: { current: mode },
  };
}

describe("raspberrycodeConfigOptions", () => {
  it("keeps persisted edit while the shared menu replaces it with guarded", () => {
    const options = settingsToConfigOptions(settingsWithMode("edit"));
    const modeOption = options.find((option) => option.category === "mode");

    expect(modeOption?.currentValue).toBe("edit");
    expect(modeOption?.options?.map((option) => option.value)).toEqual([
      "build",
      "guarded",
      "plan",
      "yolo",
    ]);
    expect(getRaspberryCodeAgentAvailableModes().map((mode) => mode.id)).toEqual([
      "build",
      "guarded",
      "plan",
      "yolo",
    ]);
    expect(normalizeAvailableRaspberryCodeMode("edit")).toBe("edit");
  });
});
