import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ProjectRepository } from "#src/project-storage/project-repository.js";
import { addProjectSchema } from "#src/project-storage/schema.js";
import { TASK_INDEX_SCHEMA } from "#src/session/tasksDatabase/schema-v1.js";

/**
 * 占位行回收。
 *
 * 背景：`createTask` / `forkTask` 在 CLI 首发前先插一行归属占位，等 `applyCliFacts`
 * 回写 CLI 事实。握手中断（创建失败、取消、进程重启）时占位行会永远停在
 * `cli_created_at IS NULL`。列表按 `cli_created_at IS NOT NULL` 过滤，所以它们不可见、
 * 不影响功能，但会无限累积（实测本机积了 72 条）。
 *
 * 这里守住两条边界：该回收的要回收，仍在握手中的新行一条都不能碰。
 */

const HOST = "local";

function createRepository(): { db: DatabaseSync; repository: ProjectRepository } {
  const db = new DatabaseSync(":memory:");
  // tasks 基表由 0001 迁移建；addProjectSchema 只在既有表上补项目归属列。
  db.exec(TASK_INDEX_SCHEMA);
  addProjectSchema(db);
  // placeholder_at 走独立迁移 0011（不能放进 TASK_PROJECT_COLUMNS，否则会改动
  // 已应用迁移 0005 的 checksum）。这里手动补上，与真实升级后状态一致。
  db.exec("ALTER TABLE tasks ADD COLUMN placeholder_at INTEGER");
  return { db, repository: new ProjectRepository(db, HOST) };
}

function insertTask(
  db: DatabaseSync,
  input: {
    taskId: string;
    /** 占位建立时间；null 模拟旧版本留下的无时间戳占位行。 */
    placeholderAt: number | null;
    cliCreatedAt: number | null;
    title?: string;
    deleted?: boolean;
  },
): void {
  db.prepare(
    `INSERT INTO tasks(
      workspace_key, workspace_path, workspace_identity, task_id, title,
      created_at, updated_at, host_id, root_path, cli_created_at, cli_updated_at,
      cli_title, deleted, archived, pinned, handoff_pending, placeholder_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?)`,
  ).run(
    "/repo",
    "/repo",
    null,
    input.taskId,
    input.title ?? "",
    input.cliCreatedAt ?? 0,
    input.cliCreatedAt ?? 0,
    HOST,
    "/repo",
    input.cliCreatedAt,
    input.cliCreatedAt,
    input.cliCreatedAt === null ? null : (input.title ?? ""),
    input.deleted ? 1 : 0,
    input.placeholderAt,
  );
}

function readTaskIds(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT task_id FROM tasks ORDER BY task_id").all() as {
    task_id: string;
  }[];
  return rows.map((row) => row.task_id);
}

describe("ProjectRepository.pruneOrphanPlaceholders", () => {
  it("回收超过保留期、仍无 CLI 事实的占位行", () => {
    const { db, repository } = createRepository();
    const now = 1_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    insertTask(db, { taskId: "old-orphan", placeholderAt: now - day * 3, cliCreatedAt: null });

    const pruned = repository.pruneOrphanPlaceholders(now - day);

    expect(pruned).toBe(1);
    expect(readTaskIds(db)).toEqual([]);
  });

  it("保留仍在保留期内的占位行：CLI 可能还没回写，删了会让刚建的任务凭空消失", () => {
    const { db, repository } = createRepository();
    const now = 1_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    insertTask(db, { taskId: "fresh-orphan", placeholderAt: now - 60_000, cliCreatedAt: null });

    const pruned = repository.pruneOrphanPlaceholders(now - day);

    expect(pruned).toBe(0);
    expect(readTaskIds(db)).toEqual(["fresh-orphan"]);
  });

  it("保留已有 CLI 事实的正常任务，无论多旧", () => {
    const { db, repository } = createRepository();
    const now = 1_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    insertTask(db, {
      taskId: "real-task",
      placeholderAt: null,
      cliCreatedAt: now - day * 30,
      title: "真实会话",
    });

    const pruned = repository.pruneOrphanPlaceholders(now - day);

    expect(pruned).toBe(0);
    expect(readTaskIds(db)).toEqual(["real-task"]);
  });

  it("回收 placeholder_at 为 NULL 的历史占位行：旧版本没记占位时间，这类行必然没有 CLI 事实", () => {
    const { db, repository } = createRepository();
    const now = 1_000_000_000;
    insertTask(db, { taskId: "legacy-orphan", placeholderAt: null, cliCreatedAt: null });

    const pruned = repository.pruneOrphanPlaceholders(now);

    expect(pruned).toBe(1);
    expect(readTaskIds(db)).toEqual([]);
  });

  it("不回收已软删的行，避免与删除流程的状态竞争", () => {
    const { db, repository } = createRepository();
    const now = 1_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    insertTask(db, {
      taskId: "deleted-placeholder",
      placeholderAt: now - day * 3,
      cliCreatedAt: null,
      deleted: true,
    });

    const pruned = repository.pruneOrphanPlaceholders(now - day);

    expect(pruned).toBe(0);
    expect(readTaskIds(db)).toEqual(["deleted-placeholder"]);
  });

  it("只处理本 Host 的行", () => {
    const { db, repository } = createRepository();
    const now = 1_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    insertTask(db, { taskId: "local-orphan", placeholderAt: now - day * 3, cliCreatedAt: null });
    db.prepare(
      `INSERT INTO tasks(
        workspace_key, workspace_path, workspace_identity, task_id, title,
        created_at, updated_at, host_id, root_path, cli_created_at, cli_updated_at,
        cli_title, deleted, archived, pinned, handoff_pending, placeholder_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?)`,
    ).run(
      "/remote",
      "/remote",
      "ssh://host/repo",
      "remote-orphan",
      "",
      0,
      0,
      "ssh-host",
      "/remote",
      null,
      null,
      null,
      0,
      now - day * 3,
    );

    const pruned = repository.pruneOrphanPlaceholders(now - day);

    expect(pruned).toBe(1);
    expect(readTaskIds(db)).toEqual(["remote-orphan"]);
  });
});
