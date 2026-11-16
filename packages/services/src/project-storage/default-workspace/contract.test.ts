import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fixture, port } from "#src/project-storage/test-fixture.js";
import {
  reconcileLegacy,
  REMOTE_TASK_OWNERSHIP_MIGRATION,
} from "#src/project-storage/legacy-tasks.js";
import { migrateProjects } from "#src/project-storage/migrate-projects.js";
import { SESSION_CREATION_COMMANDS_SQL } from "#src/project-storage/schema.js";
import { REMOTE_ENTRY_DELETED_CACHE_SQL } from "#src/project-storage/schema.js";

/**
 * 把指定迁移记为「已应用」到 schema_migration 账本。
 *
 * 修复原因（2026-11-15）：本文件若干用例模拟「已迁移过的旧库」，需要前置账本与真实
 * 旧库一致。checksum 必须与 runner 同算法（sha256(sql.trim())），否则 runner 会把它
 * 当成被篡改的迁移而拒绝继续。
 */
function markApplied(
  db: DatabaseSync,
  rows: ReadonlyArray<readonly [id: string, sql: string, appVersion: string]>,
): void {
  const insert = db.prepare(
    "INSERT OR REPLACE INTO schema_migration(id,checksum,app_version,applied_at) VALUES(?,?,?,?)",
  );
  for (const [id, sql, appVersion] of rows) {
    insert.run(id, createHash("sha256").update(sql.trim()).digest("hex"), appVersion, 10);
  }
}

describe("系统 default 项目纠偏", () => {
  it.each(["renamed", "multi-root", "newer"])("preserves a %s user project", async (scenario) => {
    const path = "/Users/test/.raspberrycode/workspace/default";
    const { db, add, context } = await fixture([path]);
    add("kept", path);
    migrateProjects(db, context);
    reconcileLegacy(db);
    db.exec(`CREATE TABLE schema_migration(id TEXT PRIMARY KEY,checksum TEXT,app_version TEXT,applied_at INTEGER);
      INSERT INTO schema_migration VALUES('0005_projects','ac00a61c7c45a5ceb3814b1487901372c5580eb6eb8d31bde5bcdfbd1ed0f0da','3.12.0',10);`);
    const projectId = db.prepare("SELECT project_id FROM tasks").get()!.project_id!;
    if (scenario === "renamed")
      db.exec("UPDATE projects SET name='My project',name_overridden=1,updated_at=11");
    if (scenario === "multi-root")
      db.prepare("INSERT INTO project_roots VALUES(?,'/extra',1,0)").run(projectId);
    if (scenario === "newer") db.exec("UPDATE projects SET created_at=11,updated_at=11");
    await port.migrate(db, context);
    expect(db.prepare("SELECT project_id FROM tasks").get()!.project_id).toBe(projectId);
    expect(db.prepare("SELECT deleted FROM projects").get()!.deleted).toBe(0);
  });
  it.each(["/Users/test/.raspberrycode/workspace/default", "C:\\Users\\test\\.raspberrycode\\workspace\\default"])(
    "repairs an already migrated %s without changing task facts or other tables",
    async (path) => {
      const { db, add, context } = await fixture([path, "/repos/default"]);
      add("normal", path);
      add("archived", path);
      add("ordinary-default", "/repos/default");
      db.exec("UPDATE tasks SET archived=1,pinned=1,unread_at=7 WHERE task_id='archived'");
      // 真实旧迁移结果：purpose 缺失，系统目录被自动创建为项目。
      migrateProjects(db, context);
      reconcileLegacy(db);
      db.exec(`CREATE TABLE schema_migration(id TEXT PRIMARY KEY,checksum TEXT,app_version TEXT,applied_at INTEGER);
        INSERT INTO schema_migration VALUES('0005_projects','ac00a61c7c45a5ceb3814b1487901372c5580eb6eb8d31bde5bcdfbd1ed0f0da','3.12.0',10);`);
      // 修复原因（2026-11-15）：本用例模拟「已迁移过的旧库」，断言后续只补跑 0006/0007。
      // 原账本只记 0005，但 0008~0011 早已发布、在真实旧库中已应用（0011 是本轮新增）。
      // 夹具补齐这些迁移需要的列后，它们不再因缺列中断而会真实补跑，导致断言多出四项。
      // 这里按真实旧库状态把 0008~0011 记为已应用（checksum 用与 runner 相同的算法：
      // sha256(migration.sql.trim())），不动 0006/0007 —— 那正是本用例要验证的补跑项。
      markApplied(
        db,
        [
          ["0008_remote_entry_deleted_cache", REMOTE_ENTRY_DELETED_CACHE_SQL, "3.16.3"],
          ["0009_session_creation_commands", SESSION_CREATION_COMMANDS_SQL, "3.16.3"],
          ["0010_remote_task_ownership", REMOTE_TASK_OWNERSHIP_MIGRATION, "3.17.2"],
          ["0011_task_placeholder_at", "-- add tasks.placeholder_at INTEGER (idempotent)", "3.18.0"],
        ],
      );
      const originalId = db
        .prepare("SELECT project_id FROM tasks WHERE task_id='normal'")
        .get()!.project_id;
      // 同目录的手建项目不能仅按名称或路径被清理。
      db.prepare(
        "INSERT INTO projects VALUES('manual','local','Manual default',1,5,0,NULL,0,NULL,11,11)",
      ).run();
      db.prepare("INSERT INTO project_roots VALUES('manual',?,0,1)").run(path);
      const tables = db
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name<>'schema_migration'")
        .all();
      const hash = (name: string) =>
        createHash("sha256")
          .update(JSON.stringify(db.prepare(`SELECT * FROM ${name}`).all()))
          .digest("hex");
      const before = new Map(tables.map(({ name }) => [String(name), hash(String(name))]));
      const facts = () =>
        db
          .prepare("SELECT * FROM tasks ORDER BY task_id")
          .all()
          .map(({ project_id: _project, ...task }) => task);
      const taskFacts = facts();
      expect((await port.migrate(db, context)).applied).toEqual([
        "0006_default_workspace_tasks",
        "0007_initial_workspace_order",
      ]);
      expect(
        db.prepare("SELECT project_id FROM tasks WHERE task_id IN ('normal','archived')").all(),
      ).toEqual([{ project_id: null }, { project_id: null }]);
      expect(
        db.prepare("SELECT deleted FROM projects WHERE project_id=?").get(originalId!),
      ).toEqual({ deleted: 1 });
      expect(db.prepare("SELECT deleted FROM projects WHERE project_id='manual'").get()).toEqual({
        deleted: 0,
      });
      expect(
        db.prepare("SELECT project_id FROM tasks WHERE task_id='ordinary-default'").get()!
          .project_id,
      ).not.toBeNull();
      expect(facts()).toEqual(taskFacts);
      for (const [name, value] of before)
        if (!["tasks", "projects"].includes(name)) expect(hash(name)).toBe(value);
      expect((await port.migrate(db, context)).applied).toEqual([]);
      expect(facts()).toEqual(taskFacts);
    },
  );
});
