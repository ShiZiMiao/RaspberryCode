import { describe, expect, it, vi } from "vitest";
import {
  buildContextUsageBreakdownEntry,
  parseContextUsageBreakdownEntryData,
  persistContextUsageBreakdown,
  readPersistedContextUsageBreakdown,
} from "../../src/runtime/context-usage-breakdown/context-usage-breakdown.js";
import type { AgentRuntimeInternal } from "../../src/runtime/internal.js";

const SESSION_ID = "sess_test" as never;

function fakeRuntime(store?: {
  saveSessionEntry?: (input: unknown) => Promise<void>;
  sessionEntries?: (input: unknown) => Promise<unknown[]>;
}): AgentRuntimeInternal {
  return {
    logger: { warn: vi.fn() },
    sessionId: SESSION_ID,
    sessionStore: store,
  } as unknown as AgentRuntimeInternal;
}

describe("context usage breakdown entry", () => {
  it("writes a single overwriting entry keyed by session, without touching session activity time", () => {
    const entry = buildContextUsageBreakdownEntry(
      SESSION_ID,
      [
        { source: "system_tool_schemas", chars: 608 },
        { source: "messages", chars: 38 },
      ],
      { used: 21286, size: 1024768 },
    );

    // 固定 id：同一会话只保留最近一次构成，不累积历史。
    expect(entry.id).toBe(`${SESSION_ID}:runtime-context-usage-breakdown`);
    expect(entry.type).toBe("runtime/context_usage_breakdown");
    // 上下文构成快照不是用户/工具活动，不能把任务时间伪装成「刚刚」。
    expect(entry.touchSession).toBe(false);
    expect(entry.data).toEqual({
      version: 1,
      breakdown: [
        { source: "system_tool_schemas", chars: 608 },
        { source: "messages", chars: 38 },
      ],
      used: 21286,
      size: 1024768,
    });
  });

  it("round-trips through the parser used by cold restore", () => {
    const entry = buildContextUsageBreakdownEntry(
      SESSION_ID,
      [{ source: "skills", chars: 42 }],
      { used: 100, size: 200 },
    );

    expect(parseContextUsageBreakdownEntryData(entry.data)).toEqual({
      breakdown: [{ source: "skills", chars: 42 }],
      used: 100,
      size: 200,
    });
  });

  it("drops unknown sources and non-positive chars instead of failing the whole restore", () => {
    // 更高版本写入的新 source 或坏数据不能让冷恢复整块失败，只忽略那一条。
    expect(
      parseContextUsageBreakdownEntryData({
        version: 1,
        breakdown: [
          { source: "skills", chars: 10 },
          { source: "brand_new_source", chars: 99 },
          { source: "messages", chars: 0 },
          { source: "messages", chars: -5 },
          { source: "messages", chars: "nope" },
        ],
      }),
    ).toEqual({ breakdown: [{ source: "skills", chars: 10 }] });
  });

  it("returns undefined (not an empty list) when the entry is unusable", () => {
    // 空数组会被上层误当成「确实没有明细」，undefined 才表示「这份数据读不出来」。
    expect(parseContextUsageBreakdownEntryData(null)).toBeUndefined();
    expect(parseContextUsageBreakdownEntryData({})).toBeUndefined();
    expect(parseContextUsageBreakdownEntryData({ breakdown: [] })).toBeUndefined();
    expect(
      parseContextUsageBreakdownEntryData({ breakdown: [{ source: "messages", chars: 0 }] }),
    ).toBeUndefined();
  });

  it("skips the write when there is nothing to persist", async () => {
    const saveSessionEntry = vi.fn(async () => {});
    await persistContextUsageBreakdown(fakeRuntime({ saveSessionEntry }), []);
    expect(saveSessionEntry).not.toHaveBeenCalled();
  });

  it("does not let a failed write break the model request", async () => {
    const warn = vi.fn();
    const runtime = fakeRuntime({
      saveSessionEntry: async () => {
        throw new Error("database is locked");
      },
    });
    (runtime as unknown as { logger: { warn: typeof warn } }).logger = { warn };

    await expect(
      persistContextUsageBreakdown(runtime, [{ source: "messages", chars: 1 }]),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("reads back the latest entry", async () => {
    const sessionEntries = vi.fn(async () => [
      { data: { version: 1, breakdown: [{ source: "skills", chars: 1 }] } },
      { data: { version: 1, breakdown: [{ source: "messages", chars: 7 }] } },
    ]);

    expect(await readPersistedContextUsageBreakdown(fakeRuntime({ sessionEntries }))).toEqual({
      breakdown: [{ source: "messages", chars: 7 }],
    });
    expect(sessionEntries).toHaveBeenCalledWith({
      sessionID: SESSION_ID,
      type: "runtime/context_usage_breakdown",
    });
  });

  it("returns undefined and stays quiet when no store is available", async () => {
    await expect(readPersistedContextUsageBreakdown(fakeRuntime())).resolves.toBeUndefined();
  });

  it("does not let a failed read break session restore", async () => {
    const warn = vi.fn();
    const runtime = fakeRuntime({
      sessionEntries: async () => {
        throw new Error("sqlite busy");
      },
    });
    (runtime as unknown as { logger: { warn: typeof warn } }).logger = { warn };

    await expect(readPersistedContextUsageBreakdown(runtime)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
