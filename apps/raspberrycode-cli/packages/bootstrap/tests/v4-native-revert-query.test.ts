// L2：revertUserQuery（只回退不重发）。
// 语义要点：
// - 与 editUserQuery(workspaceMode=rewind) 共用文件事务，唯一差异是不启动新一轮；
// - 该轮没有文件改动不是阻断：只截断对话；
// - unsafe / ignored 文件 fail closed：不写文件、不截断对话、ACK blocked 且原样带回 preview；
// - 非最新 real user 行直接拒绝（latestQueryEditOnly）；
// - 成功后绝不调用 sendInput（这是与 edit 的根本区别）。
import { describe, expect, it, vi } from "vitest";
import { RewindStrategy } from "@raspberrycode/contracts";
import type { CommandEnvelope } from "@raspberrycode/shared/raspberrycode-protocol-v4";
import { V4CommandExecutor } from "../src/raspberrycode-protocol-v4/commands/executor.js";
import { V4RevertTargetNotLatestError } from "../src/raspberrycode-protocol-v4/commands/handlers/fork-edit-retry.js";
import type {
  V4CommandCoreHost,
  V4SessionRecordView,
} from "../src/raspberrycode-protocol-v4/commands/types.js";

const EMPTY_PREVIEW = {
  canApply: false,
  ignoredFiles: [],
  safeFiles: [],
  unsafeFiles: [],
};

const SAFE_PREVIEW = {
  canApply: true,
  ignoredFiles: [],
  safeFiles: [{ path: "/w/a.txt", action: "restore" as const, operationCount: 1, toolNames: ["Write"] }],
  unsafeFiles: [],
};

const UNSAFE_PREVIEW = {
  canApply: false,
  ignoredFiles: [],
  safeFiles: [],
  unsafeFiles: [
    {
      path: "/w/b.txt",
      reason: "external_modified" as const,
      operationCount: 1,
      toolNames: ["Write"],
    },
  ],
};

const IGNORED_PREVIEW = {
  canApply: true,
  ignoredFiles: [{ path: "/w/c.txt", reason: "bash_ignored" as const, operationCount: 1, toolNames: ["Bash"] }],
  safeFiles: [{ path: "/w/a.txt", action: "restore" as const, operationCount: 1, toolNames: ["Write"] }],
  unsafeFiles: [],
};

function makeApp(preview: unknown, applied = true) {
  return {
    sessionId: "s1",
    sendInput: vi.fn().mockResolvedValue({ kind: "started_turn" }),
    submitPrompt: vi.fn().mockResolvedValue({}),
    steerTurn: vi.fn().mockResolvedValue({}),
    readTarget: vi.fn().mockResolvedValue(null),
    updateTargetStatus: vi.fn().mockResolvedValue(null),
    runtime: {
      rewindConversationToMessage: vi.fn().mockResolvedValue({
        strategy: RewindStrategy.ActiveChain,
      }),
      previewWorkspaceFileRewind: vi.fn().mockResolvedValue(preview),
      // apply 的 commitAfterApply 是「文件写成功后才提交 branch cut」的闸门，
      // 用例必须真的调用它，否则测不到「回退同时截断对话」。
      applyWorkspaceFileRewind: vi.fn().mockImplementation(async (options) => {
        await options?.commitAfterApply?.();
        return { applied, preview, response: "" };
      }),
      getActiveTurnInfo: () => undefined,
      getActiveForegroundExecutionId: () => undefined,
    },
  };
}

function makeRecord(app: ReturnType<typeof makeApp>): V4SessionRecordView {
  return {
    app: app as unknown as V4SessionRecordView["app"],
    traceContext: { traceId: "trace-1", sessionId: "s1" } as never,
    workspace: { workspacePath: "/w" },
    persistence: "immediate",
  } as V4SessionRecordView;
}

function makeHost(
  record: V4SessionRecordView,
  options: { latest?: boolean; withAnchor?: boolean } = {},
): V4CommandCoreHost {
  const { latest = true, withAnchor = true } = options;
  const host: V4CommandCoreHost = {
    getRecord: (id) => (id === "s1" ? record : undefined),
    isLatestEditableUserRow: () => latest,
    waitForProjectionEventCommit: async () => {},
    getTurnRewindAnchor: () => (withAnchor ? "msg-a" : null),
    getMessageIdsForTurnRow: () => ["msg-user"],
    getTurnIdForRow: () => "turn-7",
  };
  host.resolveRowActionTarget ??= (_sessionId, target, action) => {
    if (action !== "revertUserQuery") {
      return { ok: false, status: "rejected", reasonCode: "guard.actionUnavailable" };
    }
    if (!latest) {
      return { ok: false, status: "rejected", reasonCode: "guard.actionUnavailable" };
    }
    return {
      ok: true,
      action,
      row: { rowId: target.rowId, turnId: "turn-7" } as never,
      messageIds: ["msg-user"],
      editTarget: {
        entityId: target.entityId,
        productTurnId: "turn-7",
        transcriptMessageId: "msg-user",
        coveredByStableCompact: false,
        intent: { kind: "sendText", text: "原始问题" },
      },
    };
  };
  return host;
}

function envelope(payload: unknown): CommandEnvelope {
  return {
    type: "revertUserQuery",
    payload,
    sessionId: "s1",
    commandId: "cmd-1",
    baseRevision: 0,
    baseLogEpoch: "epoch-1",
    clientId: "client-new",
  } as unknown as CommandEnvelope;
}

const TARGET = { rowId: 7, entityId: "entity-7" };

describe("v4 原生 revertUserQuery", () => {
  it("正路径：文件恢复 + 截断对话，且绝不重发", async () => {
    const app = makeApp(SAFE_PREVIEW);
    const info = vi.fn();
    const host = makeHost(makeRecord(app), { latest: true });
    host.logger = { info };

    const result = await new V4CommandExecutor(host).execute(envelope({ target: TARGET }));

    expect(result).toEqual({
      type: "revertUserQuery",
      disposition: "reverted",
      sessionId: "s1",
    });
    // 关键断言：回退不产生新输入。
    expect(app.sendInput).not.toHaveBeenCalled();
    expect(app.runtime.applyWorkspaceFileRewind).toHaveBeenCalledTimes(1);
    expect(app.runtime.rewindConversationToMessage).toHaveBeenCalledWith(
      expect.objectContaining({ targetMessageId: "msg-user" }),
    );
    expect(info).toHaveBeenCalledWith(
      "v4 revertUserQuery completed",
      expect.objectContaining({
        event: "conversation.command.revert_user_query.completed",
        restoredFileCount: 1,
        status: "completed",
      }),
    );
  });

  it("该轮没有文件改动：只截断对话，回退仍然成功", async () => {
    const app = makeApp(EMPTY_PREVIEW);
    const host = makeHost(makeRecord(app));

    const result = await new V4CommandExecutor(host).execute(envelope({ target: TARGET }));

    expect(result).toEqual({
      type: "revertUserQuery",
      disposition: "reverted",
      sessionId: "s1",
    });
    // 没有文件工作量时不该进入文件事务（省掉一次无意义的写盘与 commit gate）。
    expect(app.runtime.applyWorkspaceFileRewind).not.toHaveBeenCalled();
    expect(app.runtime.rewindConversationToMessage).toHaveBeenCalledTimes(1);
    expect(app.sendInput).not.toHaveBeenCalled();
  });

  it("unsafe 文件：blocked 且不写文件、不截断对话、不重发", async () => {
    const app = makeApp(UNSAFE_PREVIEW);
    const host = makeHost(makeRecord(app));

    const result = await new V4CommandExecutor(host).execute(envelope({ target: TARGET }));

    expect(result).toEqual(
      expect.objectContaining({
        type: "revertUserQuery",
        disposition: "blocked",
        reasonCode: "guard.workspaceRewindUnsafeFiles",
        preview: UNSAFE_PREVIEW,
      }),
    );
    // fail closed：两个破坏性步骤都不得发生。
    expect(app.runtime.applyWorkspaceFileRewind).not.toHaveBeenCalled();
    expect(app.runtime.rewindConversationToMessage).not.toHaveBeenCalled();
    expect(app.sendInput).not.toHaveBeenCalled();
  });

  it("bash 产生的文件改动（ignored）：blocked，因为无法证明完整回滚", async () => {
    const app = makeApp(IGNORED_PREVIEW);
    const host = makeHost(makeRecord(app));

    const result = await new V4CommandExecutor(host).execute(envelope({ target: TARGET }));

    expect(result).toEqual(
      expect.objectContaining({
        disposition: "blocked",
        reasonCode: "guard.workspaceRewindIgnoredFiles",
      }),
    );
    expect(app.runtime.applyWorkspaceFileRewind).not.toHaveBeenCalled();
    expect(app.runtime.rewindConversationToMessage).not.toHaveBeenCalled();
  });

  it("文件写入阶段返回 applied=false：blocked，对话不截断", async () => {
    const app = makeApp(SAFE_PREVIEW, false);
    const host = makeHost(makeRecord(app));

    const result = await new V4CommandExecutor(host).execute(envelope({ target: TARGET }));

    expect(result).toEqual(
      expect.objectContaining({
        disposition: "blocked",
        reasonCode: "guard.workspaceRewindApplyConflict",
      }),
    );
  });

  it("非最新 real user 行：latestQueryEditOnly 拒绝，且不触碰任何状态", async () => {
    const app = makeApp(SAFE_PREVIEW);
    const host = makeHost(makeRecord(app), { latest: false });

    await expect(
      new V4CommandExecutor(host).execute(envelope({ target: TARGET })),
    ).rejects.toBeInstanceOf(V4RevertTargetNotLatestError);
    expect(app.runtime.applyWorkspaceFileRewind).not.toHaveBeenCalled();
    expect(app.runtime.rewindConversationToMessage).not.toHaveBeenCalled();
  });

  it("投影翻译不到 rewind 锚点：拒绝，不退化为静默回退", async () => {
    const app = makeApp(SAFE_PREVIEW);
    const host = makeHost(makeRecord(app), { withAnchor: false });
    // 锚点缺失时 resolver 必须整体拒绝，否则会拿错目标截断对话。
    host.resolveRowActionTarget = () => ({
      ok: false,
      status: "rejected",
      reasonCode: "guard.actionUnavailable",
    });

    await expect(
      new V4CommandExecutor(host).execute(envelope({ target: TARGET })),
    ).rejects.toBeInstanceOf(V4RevertTargetNotLatestError);
    expect(app.runtime.rewindConversationToMessage).not.toHaveBeenCalled();
  });

  it("rewind 未走 ActiveChain：抛错且不重发（旧分支不能被当成成功）", async () => {
    const app = makeApp(SAFE_PREVIEW);
    app.runtime.rewindConversationToMessage.mockResolvedValue({
      strategy: RewindStrategy.FileOnly,
    });
    const host = makeHost(makeRecord(app));

    await expect(
      new V4CommandExecutor(host).execute(envelope({ target: TARGET })),
    ).rejects.toThrow(/conversation rewind unavailable/);
    expect(app.sendInput).not.toHaveBeenCalled();
  });
});
