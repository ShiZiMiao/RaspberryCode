import { describe, expect, it } from "vitest";
import { SESSION_MIGRATION_SOURCES } from "@/hooks/useClaudeSessionMigration.js";

/**
 * 来源分派是纯约定：Claude 走既有接口，Codex / OpenCode 走通用外部会话接口。
 * 这里锁定「来源清单」这个易被改错的事实；真正的解析与读取行为由
 * services 侧 codexSessionParser / opencodeSessionReader 测试覆盖。
 */
describe("session migration sources", () => {
  it("三个来源都暴露在 UI 选项里，顺序稳定", () => {
    expect(SESSION_MIGRATION_SOURCES).toEqual(["claude", "codex", "opencode"]);
  });

  it("hook 导出来源清单与迁移入口", async () => {
    const mod = await import("@/hooks/useClaudeSessionMigration.js");
    expect(Object.keys(mod)).toContain("SESSION_MIGRATION_SOURCES");
    expect(Object.keys(mod)).toContain("useClaudeSessionMigration");
    expect(Object.keys(mod)).toContain("UNLIMITED_SCAN_LIMIT_INPUT");
  });
});
