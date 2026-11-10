import { describe, expect, it } from "vitest";
import { groupWorkspaceCandidates } from "@/onboarding/useOnboardingMigration.js";

function candidate(
  provider: "claude" | "codex" | "opencode",
  sessionId: string,
  workspacePath: string,
) {
  return {
    provider,
    sessionId,
    workspacePath,
    sourcePath: `/src/${sessionId}`,
    updatedAt: 1,
  };
}

/**
 * 回归重点：导入只取用户勾选的那些来源。
 * 早先的实现把所有 candidate 不分来源塞进同一批 sessionIds，
 * 会变成「把用户没选的软件也一起导进去」。
 */
describe("groupWorkspaceCandidates 按来源集合收敛", () => {
  it("多选时只取勾选的来源", () => {
    const groups = groupWorkspaceCandidates(
      ["/work/a"],
      [
        candidate("claude", "c1", "/work/a"),
        candidate("codex", "x1", "/work/a"),
        candidate("opencode", "o1", "/work/a"),
      ],
      ["claude", "codex"],
    );

    expect(groups).toHaveLength(1);
    // claude + codex 都在，opencode 未被勾选必须排除。
    expect(groups[0]?.sessionIds.sort()).toEqual(["c1", "x1"]);
  });

  it("只勾一个来源时不会带出其它来源", () => {
    const groups = groupWorkspaceCandidates(
      ["/work/a"],
      [
        candidate("claude", "c1", "/work/a"),
        candidate("codex", "x1", "/work/a"),
        candidate("opencode", "o1", "/work/a"),
      ],
      ["codex"],
    );
    expect(groups[0]?.sessionIds).toEqual(["x1"]);
  });

  it("三个来源全选时全部纳入", () => {
    const groups = groupWorkspaceCandidates(
      ["/work/a"],
      [
        candidate("claude", "c1", "/work/a"),
        candidate("codex", "x1", "/work/a"),
        candidate("opencode", "o1", "/work/a"),
      ],
      ["claude", "codex", "opencode"],
    );
    expect(groups[0]?.sessionIds.sort()).toEqual(["c1", "o1", "x1"]);
  });

  it("一个来源都没勾选时不产生任何分组", () => {
    const groups = groupWorkspaceCandidates(
      ["/work/a"],
      [candidate("claude", "c1", "/work/a"), candidate("codex", "x1", "/work/a")],
      [],
    );
    expect(groups).toEqual([]);
  });

  it("选中来源在该 workspace 没有会话时不产生空分组", () => {
    const groups = groupWorkspaceCandidates(
      ["/work/a"],
      [candidate("claude", "c1", "/work/a")],
      ["opencode"],
    );
    expect(groups).toEqual([]);
  });

  it("跨 workspace 各自按来源集合收敛", () => {
    const groups = groupWorkspaceCandidates(
      ["/work/a", "/work/b"],
      [
        candidate("codex", "x1", "/work/a"),
        candidate("claude", "c1", "/work/a"),
        candidate("codex", "x2", "/work/b"),
        candidate("opencode", "o2", "/work/b"),
      ],
      ["codex"],
    );

    expect(groups.map((group) => group.sessionIds)).toEqual([["x1"], ["x2"]]);
  });

  it("同 id 不同来源时不会互相污染", () => {
    // 不同软件可能产生相同 session id，按来源过滤后只保留勾选来源那一条。
    const groups = groupWorkspaceCandidates(
      ["/work/a"],
      [candidate("claude", "same-id", "/work/a"), candidate("codex", "same-id", "/work/a")],
      ["claude"],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sessionIds).toEqual(["same-id"]);
  });
});
