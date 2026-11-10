import { access } from "node:fs/promises";
import { constants } from "node:fs";
import type {
  RaspberryCodeImportSessionsResult,
  RaspberryCodeTaskMeta,
} from "@raspberrycode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { buildImportedClaudeTaskFile } from "#src/session/claude-native/buildImportedClaudeTaskFile.js";
import type { ClaudeNativeImportedSessionSource } from "#src/session/claude-native/claudeNativeImportedSessionTypes.js";
import {
  externalSessionImportRepo,
  type ExternalImportableSession,
} from "#src/session/claude-native/externalSessionImportRepo.js";
import {
  buildSearchableTextFromMessages,
  writeImportedClaudeTaskSnapshot,
} from "#src/session/claude-native/persistImportedClaudeTask.js";
import type { TaskIndexRepo } from "#src/session/taskIndexRepo.js";

const logger = createServiceLogger("external-session-import");

/**
 * Codex / OpenCode 会话导入。
 *
 * 复用 Claude 导入的落盘与索引链路（同一 snapshot 形状、同一 taskIndex 更新），
 * 差异只在两处：来源解析（各自 repo）与 migrationSource 值。
 * 这样任务列表、续聊与搜索行为与 Claude 导入完全一致，不新增第二套写入路径。
 */
function toImportedSource(session: ExternalImportableSession): ClaudeNativeImportedSessionSource {
  return {
    // provider 字段在 Claude 侧语义是「外部来源 provider」，这里沿用同一字段承载新来源。
    provider: "claude",
    sessionId: session.sessionId,
    workspacePath: session.workspacePath,
    sourcePath: session.sourcePath,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.title ? { title: session.title } : {}),
    ...(session.model ? { model: session.model } : {}),
    ...(session.provider === "codex"
      ? { migrationSource: "codexCli" as const }
      : { migrationSource: "openCode" as const }),
    messages: session.messages.map((message, index) => ({
      role: message.role,
      content: message.content,
      // timestamp 是 snapshot 的必填字段；来源缺失时按会话起始时间递增，
      // 保证顺序稳定且不产生 1970 的时间标签。
      timestamp: message.timestamp ?? session.createdAt + index,
    })),
  };
}

async function workspacePathExists(workspacePath: string): Promise<boolean> {
  try {
    await access(workspacePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function importExternalNativeSessions(params: {
  taskIndexRepo: TaskIndexRepo;
  provider: "codex" | "opencode";
  workspacePath?: string;
  workspaceIdentity?: string;
  sessionIds: string[];
  createImportedSession: (
    source: ClaudeNativeImportedSessionSource,
  ) => Promise<RaspberryCodeTaskMeta>;
  onTaskImported: (meta: RaspberryCodeTaskMeta) => void;
}): Promise<RaspberryCodeImportSessionsResult> {
  const sessionIds = [...new Set(params.sessionIds.map((id) => id.trim()).filter(Boolean))];
  const result: RaspberryCodeImportSessionsResult = { imported: [], skipped: [], failed: [] };
  const providerLabel = params.provider === "codex" ? "codex" : "opencode";

  for (const sessionId of sessionIds) {
    try {
      const session = await externalSessionImportRepo.parseSession({
        provider: params.provider,
        sessionId,
        ...(params.workspacePath ? { workspacePath: params.workspacePath } : {}),
      });
      if (!session) {
        result.skipped.push({
          provider: providerLabel,
          sessionId,
          reason: "session_not_found_or_workspace_mismatch",
          ...(params.workspacePath ? { workspacePath: params.workspacePath } : {}),
        });
        continue;
      }
      if (!(await workspacePathExists(session.workspacePath))) {
        result.skipped.push({
          provider: providerLabel,
          sessionId,
          reason: "workspace_path_missing",
          workspacePath: session.workspacePath,
        });
        continue;
      }

      const importedSource = toImportedSource(session);
      const created = await params.createImportedSession(importedSource);
      const sessionFile = buildImportedClaudeTaskFile(importedSource, undefined, created.taskId);
      const targetWorkspaceIdentity = params.workspacePath ? params.workspaceIdentity : undefined;
      await writeImportedClaudeTaskSnapshot({
        sessionFile: {
          ...sessionFile,
          meta: {
            ...sessionFile.meta,
            ...(targetWorkspaceIdentity ? { workspaceIdentity: targetWorkspaceIdentity } : {}),
          },
        },
      });
      const meta = await params.taskIndexRepo.updateTaskPresentation({
        ...created,
        presentation: { migrationSource: importedSource.migrationSource! },
        searchableText: buildSearchableTextFromMessages(sessionFile.messages),
      });
      if (!meta) throw new Error("CLI import did not persist session facts");
      await params.taskIndexRepo.updateTaskState({ ...created, patch: { archived: false } });
      params.onTaskImported(meta);

      result.imported.push({
        provider: providerLabel,
        sessionId,
        taskId: meta.taskId,
        workspacePath: meta.workspacePath,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(undefined, `导入 ${providerLabel} session 失败 session=${sessionId}`, error);
      result.failed.push({ provider: providerLabel, sessionId, reason });
    }
  }

  logger.info(
    undefined,
    `${providerLabel} session 导入完成 imported=${result.imported.length} skipped=${result.skipped.length} failed=${result.failed.length}`,
  );
  return result;
}
