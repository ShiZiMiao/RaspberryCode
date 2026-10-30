// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  buildContextUsageBreakdownSegments,
  formatContextCacheHitRateLabel,
  formatContextUsageSummary,
  formatContextUsageTokenCount,
  refreshContextUsageOnOpen,
} from "../src/chat-input-toolbar/contextUsage.js";

// Coding Plan/Start Plan 用量面板已随订阅体系移除；本文件只保留 Context 计量辅助与触发器行为。

describe("context usage access refresh", () => {
  it("只在 Context 打开时触发后台刷新", () => {
    const onAccess = vi.fn();

    refreshContextUsageOnOpen(false, onAccess);
    refreshContextUsageOnOpen(true, onAccess);

    expect(onAccess).toHaveBeenCalledTimes(1);
  });
});

describe("buildContextUsageBreakdownSegments", () => {
  it("aggregates valid chars by source and sorts largest first", () => {
    expect(
      buildContextUsageBreakdownSegments([
        { source: "messages", chars: 700 },
        { source: "system_tool_schemas", chars: 200 },
        { source: "messages", chars: 100 },
        { source: "skills", chars: 0 },
      ]),
    ).toEqual([
      { source: "messages", chars: 800, percent: 0.8 },
      { source: "system_tool_schemas", chars: 200, percent: 0.2 },
    ]);
  });

  it("returns an empty list when no positive chars are available", () => {
    expect(
      buildContextUsageBreakdownSegments([
        { source: "messages", chars: 0 },
        { source: "skills", chars: -1 },
      ]),
    ).toEqual([]);
  });
});

describe("formatContextUsageTokenCount", () => {
  it("uses uppercase compact suffixes for English context usage", () => {
    expect(formatContextUsageTokenCount(399_900, "en-US")).toBe("399.9K");
    expect(formatContextUsageTokenCount(200_000, "en-US")).toBe("200K");
    expect(formatContextUsageTokenCount(1_250_000, "en-US")).toBe("1.3M");
  });

  it("uses localized compact units for Chinese context usage", () => {
    expect(formatContextUsageTokenCount(399_900, "zh-CN")).toBe("40万");
    expect(formatContextUsageTokenCount(200_000, "zh-CN")).toBe("20万");
    expect(formatContextUsageTokenCount(120_000_000, "zh-CN")).toBe("1.2亿");
  });
});

describe("formatContextUsageSummary", () => {
  it("combines compact token values and usage percentage", () => {
    expect(
      formatContextUsageSummary({
        locale: "en-US",
        percent: 1,
        size: 200_000,
        used: 399_900,
      }),
    ).toBe("399.9K/200K (100%)");
  });
});

describe("formatContextCacheHitRateLabel", () => {
  it("keeps the production threshold for low cache hit rates", () => {
    expect(formatContextCacheHitRateLabel(0.048, "en-US")).toBeNull();
  });

  it("formats low cache hit rates when development diagnostics are enabled", () => {
    expect(
      formatContextCacheHitRateLabel(0.048, "en-US", {
        showBelowThreshold: true,
      }),
    ).toBe("4.8%");
  });

  it("does not invent a cache hit rate when the provider omits it", () => {
    expect(
      formatContextCacheHitRateLabel(null, "en-US", {
        showBelowThreshold: true,
      }),
    ).toBeNull();
  });
});

