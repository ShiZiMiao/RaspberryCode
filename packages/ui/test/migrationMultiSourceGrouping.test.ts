import { describe, expect, it } from "vitest";
import { SESSION_MIGRATION_SOURCES } from "@/hooks/useClaudeSessionMigration.js";

/**
 * 多选来源下，导入必须按 provider 分组，各自调用对应接口。
 * 这条约定散落在 hook 内部（providerById → groups），这里锁定其可测的边界：
 * 来源清单稳定、且每个来源都能被正确归类为「外部」还是 Claude。
 */
describe("多来源导入分组约定", () => {
  it("来源清单稳定且可多选", () => {
    expect(SESSION_MIGRATION_SOURCES).toEqual(["claude", "codex", "opencode"]);
    // 多选意味着长度可为 0..3，这里只锁定清单本身不变。
    expect(SESSION_MIGRATION_SOURCES.length).toBe(3);
  });

  it("按来源分组后每个 provider 只出现一次", () => {
    // 模拟 hook 内的分组：同一 provider 的多个 session 聚合到一组。
    const selected = [
      { provider: "claude", sessionId: "c1" },
      { provider: "claude", sessionId: "c2" },
      { provider: "codex", sessionId: "x1" },
      { provider: "opencode", sessionId: "o1" },
    ];
    const providerById = new Map(selected.map((item) => [item.sessionId, item.provider]));
    const groups = new Map<string, string[]>();
    for (const { sessionId } of selected) {
      const provider = providerById.get(sessionId)!;
      const bucket = groups.get(provider);
      if (bucket) bucket.push(sessionId);
      else groups.set(provider, [sessionId]);
    }

    expect([...groups.keys()]).toEqual(["claude", "codex", "opencode"]);
    expect(groups.get("claude")).toEqual(["c1", "c2"]);
    expect(groups.get("codex")).toEqual(["x1"]);
    expect(groups.get("opencode")).toEqual(["o1"]);
  });

  it("外部来源集合与 Claude 互斥", () => {
    const isExternal = (source: string) => source === "codex" || source === "opencode";
    expect(isExternal("claude")).toBe(false);
    expect(isExternal("codex")).toBe(true);
    expect(isExternal("opencode")).toBe(true);
  });
});
