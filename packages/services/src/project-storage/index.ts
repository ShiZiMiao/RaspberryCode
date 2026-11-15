import type { DatabaseSync } from "node:sqlite";
import { ProjectRepository } from "#src/project-storage/project-repository.js";
import { sqliteMigrations } from "@raspberrycode/shared/sqlite-migrations";
import type { ProjectStorageContract } from "#src/project-storage/contract.js";
import type { ProjectDataRepositoryContract } from "#src/project-storage/purge/contract.js";
import {
  reconcileLegacy,
  admitTaskIdentity,
  repairRemoteTaskOwnership,
  REMOTE_TASK_OWNERSHIP_MIGRATION,
} from "#src/project-storage/legacy-tasks.js";
import { migrateProjects } from "#src/project-storage/migrate-projects.js";
import {
  INITIAL_WORKSPACE_ORDER_SQL,
  migrateInitialWorkspaceOrder,
} from "#src/project-storage/migration-order/migration.js";
import {
  DEFAULT_WORKSPACE_CANDIDATES_SQL,
  migrateDefaultWorkspaceTasks,
} from "#src/project-storage/default-workspace/migration.js";
import {
  PROJECT_MIGRATION_TABLES,
  PROJECT_SCHEMA_SQL,
  REMOTE_ENTRY_DELETED_CACHE_SQL,
  SESSION_CREATION_COMMANDS_SQL,
  TASK_PROJECT_COLUMNS,
} from "#src/project-storage/schema.js";

export type {
  ProjectMigrationContext,
  ProjectStorageContract,
} from "#src/project-storage/contract.js";
export type { ProjectDataRepositoryContract } from "#src/project-storage/purge/contract.js";

/** 彻底删除项目数据的行操作；与 repository() 同一 Host 范围（规格见 purge/contract.ts）。 */
export function createProjectDataRepository(
  db: DatabaseSync,
  hostId?: string,
): ProjectDataRepositoryContract {
  return new ProjectRepository(db, hostId);
}
export const projectStorage: ProjectStorageContract = {
  migrate: async (db, context) => {
    let firstProjectMigration = false;
    const result = await sqliteMigrations.migrate(
      db,
      [
        {
          id: "0005_projects",
          previousIds: ["0001_projects"],
          appVersion: "3.12.0",
          touchedTables: PROJECT_MIGRATION_TABLES,
          sql: `${PROJECT_SCHEMA_SQL}\n-- tasks columns: ${JSON.stringify(TASK_PROJECT_COLUMNS)}\n-- v3 workspace/group first assignment and CLI intent handoff`,
          apply: (database) => {
            migrateProjects(database, context);
            firstProjectMigration = true;
          },
        },
        {
          id: "0006_default_workspace_tasks",
          appVersion: "3.12.0",
          touchedTables: ["tasks", "projects"],
          sql: `${DEFAULT_WORKSPACE_CANDIDATES_SQL}\n-- v1 clear project ownership and soft-delete the unedited system container; preserve task facts`,
          apply: (database) => migrateDefaultWorkspaceTasks(database, context),
        },
        {
          id: "0007_initial_workspace_order",
          appVersion: "3.16.2",
          touchedTables: ["projects", "remote_project_entries"],
          sql: `${INITIAL_WORKSPACE_ORDER_SQL}\n-- seed mixed order only when 0005 runs in this transaction`,
          apply: (database) => {
            database.exec(INITIAL_WORKSPACE_ORDER_SQL);
            if (firstProjectMigration) migrateInitialWorkspaceOrder(database, context);
          },
        },
        {
          id: "0008_remote_entry_deleted_cache",
          appVersion: "3.16.3",
          touchedTables: ["remote_project_entries"],
          sql: REMOTE_ENTRY_DELETED_CACHE_SQL,
        },
        {
          id: "0009_session_creation_commands",
          appVersion: "3.16.3",
          touchedTables: ["session_creation_commands"],
          sql: SESSION_CREATION_COMMANDS_SQL,
        },
        {
          id: "0010_remote_task_ownership",
          appVersion: "3.17.2",
          touchedTables: ["tasks"],
          sql: REMOTE_TASK_OWNERSHIP_MIGRATION,
          apply: repairRemoteTaskOwnership,
        },
        {
          // 占位行回收需要「占位建立时刻」。该列由 addProjectSchema 的 ensureColumns 声明，
          // 但那条路径只在一次性迁移 0005 里跑；已有安装不会再进 0005，新列就永远加不上。
          // 单独开一条幂等迁移，让 upgrade 与全新安装都能拿到这一列。
          id: "0011_task_placeholder_at",
          appVersion: "3.18.0",
          touchedTables: ["tasks"],
          // 记录用途：实际执行走下面的 apply（幂等，列已存在时跳过）。
          sql: "-- add tasks.placeholder_at INTEGER (idempotent)",
          apply: (database) => {
            const columns = database.prepare("PRAGMA table_info(tasks)").all() as {
              name?: string;
            }[];
            if (!columns.some((column) => column.name === "placeholder_at")) {
              database.exec("ALTER TABLE tasks ADD COLUMN placeholder_at INTEGER");
            }
          },
        },
      ],
      {
        database: "tasks_index",
        backupDirectories: context.backupDirectories,
        now: context.now,
        onBackupSkipped: () => context.warn?.("项目迁移备份因可写卷空间不足跳过"),
      },
    );
    reconcileLegacy(db, context.hostId);
    return result;
  },
  admitTaskIdentity,
  repository: (db, hostId) => new ProjectRepository(db, hostId),
};
