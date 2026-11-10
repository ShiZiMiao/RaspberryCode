import type {
  RaspberryCodePersistedMessage,
  RaspberryCodeTaskMigrationSource,
  RaspberryCodeTaskPersistStatus,
} from "@raspberrycode/shared";

/** 导入来源身份：外部原生 CLI（Claude Code / Codex / OpenCode），与 agent runtime 的 RaspberryCodeProvider 无关。 */
export type ClaudeNativeImportSourceProvider = "claude" | "codex" | "opencode";

export interface ClaudeNativeImportedSessionSource {
  provider: ClaudeNativeImportSourceProvider;
  sessionId: string;
  workspacePath: string;
  sourcePath: string;
  createdAt: number;
  updatedAt: number;
  title?: string;
  model?: string;
  status?: RaspberryCodeTaskPersistStatus;
  migrationSource?: RaspberryCodeTaskMigrationSource;
  messages: RaspberryCodePersistedMessage[];
}

