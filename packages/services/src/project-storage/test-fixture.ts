import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";
import type { ProjectStorageContract } from "#src/project-storage/contract.js";
import { projectStorage } from "#src/project-storage/index.js";
export const port: ProjectStorageContract = projectStorage;
const resources: Array<{ db: DatabaseSync; directory: string }> = [];
afterEach(async () => {
  for (const { db, directory } of resources.splice(0)) {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
export async function fixture(savedWorkspaces: readonly string[] = []) {
  const directory = await mkdtemp(join(tmpdir(), "raspberrycode-project-migration-"));
  const db = new DatabaseSync(":memory:");
  resources.push({ db, directory });
  // 修复原因（2026-11-15）：上游 v3.17.2 同步（a9fe401e）后，0008~0011 迁移会读
  // `forked_from_task_id` / `host_id` / `root_path` 并触发 initializeLegacyTaskIdentity
  // （写 cli_* 与 handoff_pending）。夹具原先停在 0005 之前的最小列集，导致这些迁移
  // 一跑就 `no such column: forked_from_task_id`（原先 11 个用例因此失败）。
  // 这里补齐「迁移与列表查询会读到的列」；projects / project_roots 仍由 addProjectSchema 建。
  // host_id 保持无默认值：initializeLegacyTaskIdentity 靠 `host_id IS NULL` 判定待补全。
  db.exec(`CREATE TABLE tasks (
    workspace_key TEXT, workspace_path TEXT, workspace_identity TEXT, task_id TEXT,
    title TEXT DEFAULT '', provider TEXT DEFAULT 'glm', title_overridden INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0, unread_at INTEGER,
    task_status TEXT DEFAULT 'completed', created_at INTEGER DEFAULT 1, updated_at INTEGER DEFAULT 2,
    host_id TEXT, root_path TEXT, forked_from_task_id TEXT,
    cli_created_at INTEGER, cli_updated_at INTEGER, cli_title TEXT, cli_deleted INTEGER DEFAULT 0,
    cli_title_source TEXT, cli_last_outcome TEXT, handoff_pending INTEGER DEFAULT 0,
    PRIMARY KEY(workspace_key,task_id));
    CREATE TABLE task_groups(group_id TEXT PRIMARY KEY,title TEXT,color TEXT,created_at INTEGER,updated_at INTEGER);
    CREATE TABLE task_group_members(group_id TEXT,workspace_key TEXT,workspace_path TEXT,workspace_identity TEXT,task_id TEXT,sort_order INTEGER);
    CREATE TABLE task_group_workspace_bootstraps(workspace_key TEXT PRIMARY KEY,group_id TEXT);
    CREATE TABLE task_group_view_node_orders(node_type TEXT,node_key TEXT,sort_order INTEGER);
    CREATE TABLE automations(automation_id TEXT PRIMARY KEY,workspace_key TEXT,workspace_path TEXT);
    CREATE TABLE off_peak_tasks(off_peak_task_id TEXT PRIMARY KEY,workspace_key TEXT,workspace_path TEXT);
    CREATE TABLE untouched(id TEXT PRIMARY KEY,value TEXT);
    INSERT INTO untouched VALUES ('keep','unchanged');`);
  const add = (id: string, path: string, identity?: string) =>
    db
      .prepare(
        "INSERT INTO tasks(workspace_key,workspace_path,workspace_identity,task_id,title) VALUES(?,?,?,?,?)",
      )
      .run(identity ?? path, path, identity ?? null, id, `title ${id}`);
  return {
    db,
    add,
    context: {
      backupDirectories: [directory],
      now: () => 10,
      settings: {
        recentProjects: [],
        lastWorkspaceSession: savedWorkspaces.map((workspacePath) => ({
          kind: "local" as const,
          workspacePath,
        })),
      },
    },
  };
}
