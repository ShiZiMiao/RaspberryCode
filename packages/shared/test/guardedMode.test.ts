import { describe, expect, it } from "vitest";
import {
  getRaspberryCodeAgentAvailableModes,
  getRaspberryCodeAgentModeSelectOptions,
  normalizeAvailableRaspberryCodeMode,
} from "../src/raspberrycode-agent-model-state.js";
import { submissionModeSchema } from "../src/raspberrycode-protocol-v4/submission.js";
import { raspberrycodeSessionModeSchema } from "../src/raspberrycode-protocol-legacy-types.js";
import { executionStateSchema, resolveExecutionState } from "../src/execution-state.js";

describe("guarded wire and mode catalog", () => {
  it("preserves guarded across independent Plan transitions and serialization", () => {
    const current = resolveExecutionState({ mode: "guarded", planEnabled: true });
    expect(executionStateSchema.parse(current)).toEqual({ mode: "guarded", planEnabled: true });
    expect(resolveExecutionState({ planEnabled: false }, current)).toEqual({
      mode: "guarded",
      planEnabled: false,
    });
  });
  it("round trips the opt-in value without changing the default", () => {
    expect(submissionModeSchema.parse("guarded")).toBe("guarded");
    expect(raspberrycodeSessionModeSchema.parse("guarded")).toBe("guarded");
    expect(normalizeAvailableRaspberryCodeMode("guarded")).toBe("guarded");
    const ids = getRaspberryCodeAgentAvailableModes().map((mode) => mode.id);
    expect(ids).toEqual(["build", "guarded", "plan", "yolo"]);
    expect(getRaspberryCodeAgentModeSelectOptions().map((option) => option.value)).toEqual(ids);
    expect(submissionModeSchema.safeParse("unknown").success).toBe(false);
  });
  it("keeps historical edit valid without advertising it as a new choice", () => {
    expect(submissionModeSchema.parse("edit")).toBe("edit");
    expect(raspberrycodeSessionModeSchema.parse("edit")).toBe("edit");
    expect(normalizeAvailableRaspberryCodeMode("edit")).toBe("edit");
    expect(getRaspberryCodeAgentAvailableModes().some((mode) => mode.id === "edit")).toBe(false);
  });
});
