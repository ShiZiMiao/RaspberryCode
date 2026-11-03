import { describe, expect, it, vi } from "vitest";
import { resolveSessionModelContextWindow } from "../src/raspberrycode-protocol/workspace-model-runtime.js";
import type {
  RaspberryCodeProtocolAgentServerContext,
  RaspberryCodeProtocolSessionRecord,
} from "../src/raspberrycode-protocol/server-types.js";

describe("恢复容量身份边界", () => {
  it("Runtime 当前选择优先，清除恢复候选后不能复活", () => {
    const old = { providerId: "old", modelId: "GLM-5.3" };
    const current = { providerId: "new", modelId: "GLM-5.3-Flash" };
    const getSessionModelSelection = vi.fn<() => typeof current | undefined>(() => current);
    const getModelOption = vi.fn(() => ({ contextWindow: 1_000_000 }));
    const record = {
      app: { runtime: { getSessionModelSelection }, getModelOption },
      restoredModelSelection: old,
    } as unknown as RaspberryCodeProtocolSessionRecord;
    const context = {} as RaspberryCodeProtocolAgentServerContext;
    expect(resolveSessionModelContextWindow(context, record)).toBe(1_000_000);
    expect(getModelOption).toHaveBeenLastCalledWith(current);
    getSessionModelSelection.mockReturnValue(undefined);
    expect(resolveSessionModelContextWindow(context, record)).toBe(1_000_000);
    expect(getModelOption).toHaveBeenLastCalledWith(old);
    delete record.restoredModelSelection;
    getModelOption.mockClear();
    expect(resolveSessionModelContextWindow(context, record)).toBeUndefined();
    expect(getModelOption).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, -1, NaN, Infinity])("无效容量 %s 保持未知", (contextWindow) => {
    const record = {
      app: {
        runtime: { getSessionModelSelection: () => ({ providerId: "p", modelId: "m" }) },
        getModelOption: () => ({ contextWindow }),
      },
    } as unknown as RaspberryCodeProtocolSessionRecord;
    expect(
      resolveSessionModelContextWindow({} as RaspberryCodeProtocolAgentServerContext, record),
    ).toBeUndefined();
  });
});
