import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listOpencodeSessions,
  previewOpencodeSessionTitle,
  readOpencodeSessionMessages,
} from "../src/session/claude-native/opencodeSessionReader.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * 按 OpenCode 的真实 DDL 构造最小库：session / message / part 三张表 + data 列存 JSON。
 * 本机 OpenCode 库为空，无法取样真实行，所以这里用与其 schema 完全一致的夹具验证读取逻辑。
 */
function createOpencodeDb(options: {
  sessions: Array<{
    id: string;
    directory: string;
    title: string;
    created: number;
    updated: number;
  }>;
  messages: Array<{
    id: string;
    sessionId: string;
    role: string;
    created: number;
    parts: string[];
  }>;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "raspberrycode-opencode-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE project (id text PRIMARY KEY, worktree text NOT NULL);
    CREATE TABLE session (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      parent_id text,
      directory text NOT NULL,
      title text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL
    );
    CREATE TABLE message (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      data text NOT NULL
    );
    CREATE TABLE part (
      id text PRIMARY KEY,
      message_id text NOT NULL,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      data text NOT NULL
    );
  `);
  const insertSession = db.prepare(
    "INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated) VALUES (?, 'p1', NULL, ?, ?, ?, ?)",
  );
  for (const session of options.sessions) {
    insertSession.run(
      session.id,
      session.directory,
      session.title,
      session.created,
      session.updated,
    );
  }
  const insertMessage = db.prepare(
    "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
  );
  const insertPart = db.prepare(
    "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
  );
  for (const message of options.messages) {
    insertMessage.run(
      message.id,
      message.sessionId,
      message.created,
      JSON.stringify({ role: message.role, time: { created: message.created } }),
    );
    message.parts.forEach((text, index) => {
      insertPart.run(
        `${message.id}-part-${index}`,
        message.id,
        message.sessionId,
        message.created + index,
        JSON.stringify({ type: "text", text }),
      );
    });
  }
  db.close();
  return dbPath;
}

describe("opencodeSessionReader", () => {
  it("库文件不存在时返回空而不是抛错", async () => {
    const missing = join(tmpdir(), "definitely-missing-opencode.db");
    expect(await listOpencodeSessions(missing)).toEqual([]);
    expect(await readOpencodeSessionMessages(missing, "any")).toEqual([]);
  });

  it("缺少 session 表时返回空而不是抛错", async () => {
    const dir = mkdtempSync(join(tmpdir(), "raspberrycode-opencode-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "opencode.db");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE unrelated (id text)");
    db.close();

    expect(await listOpencodeSessions(dbPath)).toEqual([]);
  });

  it("列出会话并保留 directory / title / 时间", async () => {
    const dbPath = createOpencodeDb({
      sessions: [
        {
          id: "ses_a",
          directory: "D:/projects/demo",
          title: "磁盘占用分析",
          created: 1_700_000_000_000,
          updated: 1_700_000_500_000,
        },
      ],
      messages: [],
    });

    expect(await listOpencodeSessions(dbPath)).toEqual([
      {
        id: "ses_a",
        directory: "D:/projects/demo",
        title: "磁盘占用分析",
        timeCreated: 1_700_000_000_000,
        timeUpdated: 1_700_000_500_000,
      },
    ]);
  });

  it("按 message 聚合 text part，忽略非文本 part", async () => {
    const dbPath = createOpencodeDb({
      sessions: [{ id: "ses_a", directory: "D:/demo", title: "t", created: 1, updated: 2 }],
      messages: [
        {
          id: "m1",
          sessionId: "ses_a",
          role: "user",
          created: 1_700_000_000_000,
          parts: ["帮我看看磁盘"],
        },
        {
          id: "m2",
          sessionId: "ses_a",
          role: "assistant",
          created: 1_700_000_100_000,
          parts: ["先看目录", "再看大文件"],
        },
      ],
    });
    // 混入一个非 text part 验证过滤
    const db = new DatabaseSync(dbPath);
    db.prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "m2-tool",
      "m2",
      "ses_a",
      1_700_000_200_000,
      JSON.stringify({ type: "tool", name: "bash" }),
    );
    db.close();

    const messages = await readOpencodeSessionMessages(dbPath, "ses_a");
    expect(messages).toEqual([
      { role: "user", content: "帮我看看磁盘", timestamp: 1_700_000_000_000 },
      { role: "assistant", content: "先看目录\n\n再看大文件", timestamp: 1_700_000_100_000 },
    ]);
  });

  it("只返回指定会话的消息", async () => {
    const dbPath = createOpencodeDb({
      sessions: [
        { id: "ses_a", directory: "D:/a", title: "a", created: 1, updated: 2 },
        { id: "ses_b", directory: "D:/b", title: "b", created: 3, updated: 4 },
      ],
      messages: [
        { id: "m1", sessionId: "ses_a", role: "user", created: 10, parts: ["A 的问题"] },
        { id: "m2", sessionId: "ses_b", role: "user", created: 20, parts: ["B 的问题"] },
      ],
    });

    const messages = await readOpencodeSessionMessages(dbPath, "ses_b");
    expect(messages.map((message) => message.content)).toEqual(["B 的问题"]);
  });

  it("标题优先取库里的 title，缺失时回退首条用户消息", () => {
    expect(previewOpencodeSessionTitle([], "库里的标题")).toBe("库里的标题");
    expect(
      previewOpencodeSessionTitle([{ role: "user", content: "首条提问" }], undefined),
    ).toBeTruthy();
  });
});
