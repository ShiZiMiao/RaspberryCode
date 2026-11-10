import { DatabaseSync } from "node:sqlite";
import { stat } from "node:fs/promises";
import { deriveSessionTitle } from "#src/session/sessionTitle.js";
import { isObjectRecord, readTrimmedString } from "#src/session/claude-native/jsonLineRecord.js";

/**
 * OpenCode 的会话存储（opencode.db，默认 ~/.local/share/opencode/opencode.db）。
 *
 * 与本仓其它来源不同，它不是 jsonl 而是 SQLite：
 * - `session` 表：id / project_id / directory / title / time_created / time_updated；
 * - `message` 表：id / session_id / data(JSON)，data 里带 role 与 time；
 * - `part` 表：id / message_id / data(JSON)，data.type === "text" 才是可见正文。
 *
 * 只读连接 + busy_timeout：与运行中的 OpenCode 并发时不要抢锁。
 * WAL 中未 checkpoint 的行对只读连接同样可见，因此不需要等待写入方。
 */
export const OPENCODE_DB_FILENAME = "opencode.db";

export interface OpencodeSessionRow {
  id: string;
  directory: string;
  title?: string;
  timeCreated?: number;
  timeUpdated?: number;
}

export interface OpencodeVisibleMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

function toTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) return Math.trunc(value);
    if (value > 1_000_000_000) return Math.trunc(value * 1000);
    return undefined;
  }
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseJsonColumn(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isObjectRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function openReadOnly(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  // 与运行中的 OpenCode 并发时短暂等待而不是立即 BUSY。
  db.exec("PRAGMA busy_timeout = 2000");
  return db;
}

function hasTable(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?) AS has")
    .get(name) as { has?: number } | undefined;
  return Boolean(row?.has);
}

/** 列出可导入会话；表结构缺失或库不存在时返回空数组而不是抛错。 */
export async function listOpencodeSessions(dbPath: string): Promise<OpencodeSessionRow[]> {
  if (!(await pathExists(dbPath))) return [];
  const db = openReadOnly(dbPath);
  try {
    if (!hasTable(db, "session")) return [];
    const rows = db
      .prepare(
        "SELECT id, directory, title, time_created, time_updated FROM session WHERE parent_id IS NULL",
      )
      .all() as Array<Record<string, unknown>>;

    return rows.flatMap((row) => {
      const id = readTrimmedString(row.id);
      const directory = readTrimmedString(row.directory);
      // directory 是会话实际工作目录；缺失时无法归属 workspace，直接跳过而不是猜。
      if (!id || !directory) return [];
      const title = readTrimmedString(row.title);
      const timeCreated = toTimestampMs(row.time_created);
      const timeUpdated = toTimestampMs(row.time_updated);
      return [
        {
          id,
          directory,
          ...(title ? { title } : {}),
          ...(timeCreated ? { timeCreated } : {}),
          ...(timeUpdated ? { timeUpdated } : {}),
        },
      ];
    });
  } finally {
    db.close();
  }
}

/**
 * 读取单个会话的可见消息。
 *
 * OpenCode 把一条 assistant 回复拆成多个 part；这里按 message 聚合文本，
 * 保持「一条 message 一条导入消息」的形状，避免导入后对话被碎片化。
 */
export async function readOpencodeSessionMessages(
  dbPath: string,
  sessionId: string,
): Promise<OpencodeVisibleMessage[]> {
  if (!(await pathExists(dbPath))) return [];
  const db = openReadOnly(dbPath);
  try {
    if (!hasTable(db, "message") || !hasTable(db, "part")) return [];

    const messages = db
      .prepare("SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created ASC")
      .all(sessionId) as Array<Record<string, unknown>>;

    const partsByMessage = new Map<string, string[]>();
    const parts = db
      .prepare("SELECT message_id, data FROM part WHERE session_id = ? ORDER BY time_created ASC")
      .all(sessionId) as Array<Record<string, unknown>>;

    for (const part of parts) {
      const messageId = readTrimmedString(part.message_id);
      if (!messageId) continue;
      const data = parseJsonColumn(part.data);
      if (!data || data.type !== "text") continue;
      const text = readTrimmedString(data.text);
      if (!text) continue;
      const bucket = partsByMessage.get(messageId);
      if (bucket) bucket.push(text);
      else partsByMessage.set(messageId, [text]);
    }

    const result: OpencodeVisibleMessage[] = [];
    for (const row of messages) {
      const messageId = readTrimmedString(row.id);
      if (!messageId) continue;
      const data = parseJsonColumn(row.data);
      if (!data) continue;
      const role = readTrimmedString(data.role);
      if (role !== "user" && role !== "assistant") continue;
      const content = partsByMessage.get(messageId)?.join("\n\n").trim();
      if (!content) continue;
      const time = isObjectRecord(data.time) ? data.time : undefined;
      const timestamp = toTimestampMs(time?.created) ?? toTimestampMs(time?.completed);
      result.push({
        role,
        content,
        ...(timestamp ? { timestamp } : {}),
      });
    }

    return result;
  } finally {
    db.close();
  }
}

export function previewOpencodeSessionTitle(
  messages: readonly OpencodeVisibleMessage[],
  fallbackTitle: string | undefined,
): string | undefined {
  const explicit = fallbackTitle?.trim();
  if (explicit) return explicit;
  const firstUser = messages.find((message) => message.role === "user");
  return firstUser ? deriveSessionTitle(firstUser.content, []) : undefined;
}
