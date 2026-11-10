# Onboarding Migration Flow

## Entry Points

The migration wizard has no welcome view. Every entry opens the first step `Sessions` directly:

- Settings → Data & Stats → Data Sync → `Migrate` (desktop only).
- First run: when the settings-sync detection finds importable content, the wizard opens automatically.
- The occupation onboarding, when the user opts in to migration.

The first step's bottom-left button is `Cancel`; it closes the dialog and marks the first-run prompt as handled. The other steps keep `Back` / `Continue` / `Begin migration` / `Finish`.

The settings sidebar has no separate Onboarding entry. `General` → `Open onboarding` opens the occupation onboarding, not this wizard.

All entries go through the store request `requestOnboardingDialog()`; the dialog is mounted once in `Root.tsx`.

## Current Flow

Onboarding now uses a multi-step wizard:

1. `Sessions`
   - Only selects workspace scope for session migration.
   - Does not start importing.
2. `Agent Settings`
   - Only selects provider / skill / plugin categories.
   - Does not start importing.
3. `Migration`
   - Runs the unified import pipeline.
   - Shows shared progress while running.
   - Reuses the same step to show the final result summary after migration completes.

The current visible step order is:

1. `Sessions`
2. `Skills`
3. `MCP Servers`
4. `Commands`
5. `AGENTS.md`
6. `Migration`

## Session Scan Source

迁移来源为**多选**：用户勾选哪些软件，就只导哪些；一个都不勾即不迁移。

- 引导偏好页：`迁移会话数据` 是三选一的**多选复选组**（Claude Code / Codex / OpenCode），
  勾选集合经 `requestOnboardingDialog("migration", sources)` 带到弹窗，
  再落到扫描 hook（必须在 `clearOnboardingDialogRequest` 之前写入，否则来源被清掉）。
- 引导会话页与设置页「迁移」都用**可切换按钮组**表达来源（`aria-pressed`），
  增删来源会清空候选与勾选并触发一次自动重扫。
- 扫描：每个来源独立查询后合并。`limit` 是「每来源」上限语义，合并后按活跃时间排序，
  避免某个来源把其它来源挤出列表。
- 导入：按 `provider` 分组，逐组串行调用各自接口（Claude / 外部），
  最后把结果合并成一个 `RaspberryCodeImportSessionsResult` 返回。
  provider 从**全量 candidates** 反查而非 `selectedCandidates` —— 引导流程按 workspace
  传 sessionIds 时 `selectedKeys` 可能为空，用后者会让所有会话退化成默认来源。
- 勾选键是 `provider:sessionId`（不同来源的原始 session id 可能相同）。
- `groupWorkspaceCandidates` 会再按勾选的来源集合过滤一次：跨来源 session id 可能重复，
  混进同一批 `sessionIds` 就会导入用户没勾选的软件。
- `scanImportableExternalSessions` 的 `providers` 必须显式给出，缺省返回空数组而不是「两个都扫」。

| 来源 | 读取位置 | 扫描入口 |
| --- | --- | --- |
| Claude Code | `{HOME}/.claude/projects/**/*.jsonl` | `scanImportableClaudeSessions` |
| Codex | `{HOME}/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `scanImportableExternalSessions({providers:["codex"]})` |
| OpenCode | `{HOME}/.local/share/opencode/opencode.db`（SQLite，只读） | `scanImportableExternalSessions({providers:["opencode"]})` |

三个来源都额外尝试 `os.homedir()` / `HOME` / `RASPBERRYCODE_DATA_BASE_DIR` 作为 HOME 候选；
OpenCode 还尝试 `XDG_DATA_HOME` 与 `{HOME}/.opencode`。

导入后的任务统一带 `provider: "claude"`（沿用既有索引约定）与各自的 `migrationSource`：
`claudeCode` / `codexCli` / `openCode`。任务列表按 `migration_source` 识别迁移来源。
会话事实丢失时，三种来源都会按各自 `migrationSource` 重建 protocol session 再恢复。

### Codex 与 OpenCode 的格式差异

- **Codex**（`codexSessionParser.ts`）：`session_meta` 行给 `cwd` 与 session id；
  对话只在 `response_item` + `payload.type === "message"` 里。`developer` / `system` 角色是
  Codex 注入的提示词，必须丢弃；更隐蔽的是 **`<environment_context>` 等环境信息以 `user` 角色注入**，
  仅按 role 过滤会把整段 XML 当成用户提问和会话标题，因此按标签整体剥离后再判断是否还有正文。
- **OpenCode**（`opencodeSessionReader.ts`）：SQLite 三表 `session` / `message` / `part`，
  `message.data` 与 `part.data` 都是 JSON；只有 `part.data.type === "text"` 进入正文，
  同一 message 的多个 text part 按序合并成一条消息，避免导入后对话被碎片化。
  库文件缺失或表结构不存在时返回空数组而不是抛错。

## Claude → RaspberryCode Session Import

Claude Code 原生 `.jsonl` 与 RaspberryCode 协议 snapshot **不是同一格式**，导入时会在 services 层做归一化：

1. `claudeNativeSessionImportParser.ts` 读取 jsonl，过滤 sidechain / synthetic assistant，把多段 assistant 聚合成「用户一轮 + 助手一轮」的 `RaspberryCodePersistedMessage[]`。
2. `session/create` 支持 `importedHistory`，导入服务会创建真实 RaspberryCode Protocol session，并把归一后的历史消息写入 raspberrycode-cli session store。导入后的 `taskId` 就是真实 `sessionId`，因此后续 `sendPrompt`、`setModel`、`setMode` 都继续命中同一个 runtime。
3. `buildImportedClaudeTaskFile.ts` 仍会生成迁移备份 snapshot；生成前会按属性路径清洗来源端运行态字段，默认过滤 `meta.mode`、`meta.model`、`meta.provider`、`messages[].model`，避免 Claude Code 的模型/模式/provider 污染 RaspberryCode 当前 workspace 的运行时选择。
4. `persistImportedClaudeTask.ts` 写入 `~/.raspberrycode/v2/sessions/{workspaceHash}/{taskId}.json`（legacy snapshot 备份），并同步 sqlite task index + `workspace_task_list_changed` 广播。新导入路径的列表元数据来自真实 RaspberryCode session，同时保留 `migrationSource: "claudeCode"`。
5. 原生 jsonl 副本复制到 `~/.raspberrycode/v2/agent-config/claude/{workspaceHash}/projects/...`，供后续 Claude 续聊链路使用。

打开迁移后的任务时，优先按真实 RaspberryCode session 恢复；只有旧数据没有对应 protocol session 时，才 fallback 到 **legacy session JSON** 只读历史恢复。

## Claude User Memory → RaspberryCode Default AGENTS

- The `AGENTS.md` step checks the Claude user memory file at `{HOME}/.claude/CLAUDE.md`.
- If the source file exists, the step can copy that file to `{HOME}/.raspberrycode/AGENTS.md`.
- `~/.raspberrycode/AGENTS.md` is the user-level default instruction file. The runtime reads it when present and merges it before the workspace `AGENTS.md` resolved from the current working directory up to the project root.
- This migration is explicit and selected by the user in the wizard. It is not part of the generic skills / commands / MCP import selector because it intentionally overwrites one well-known default instruction file instead of importing only missing resources.
- Before the wizard enters the final `Migration` step, selecting this copy action must open a confirmation dialog. The copy action may replace an existing `{HOME}/.raspberrycode/AGENTS.md`, so the dialog must clearly say that the default AGENTS configuration will be overwritten.
- The service layer performs the copy against the user's home directory. `workspacePath` / `workspaceIdentity` are only carried for logging / request correlation and must not be used as the target filesystem path.
- Remote and mobile remote-control paths must not introduce a separate runtime for this copy action. The action stays behind the existing host-process settings-sync service boundary.

## Implementation Notes

- `packages/ui/src/onboarding/OnboardingDialog.tsx`
  - Owns the wizard state and unified execution flow.
- `packages/ui/src/onboarding/useOnboardingAgentsFileMigration.ts`
  - Loads the Claude user memory migration status and executes the confirmed copy action.
- `packages/ui/src/onboarding/OnboardingDialogParts.tsx`
  - Owns shared wizard chrome such as sidebar, header, and footer.
- `packages/ui/src/onboarding/OnboardingFlowParts.tsx`
  - Owns per-step content rendering.
- `packages/services/src/settings-sync/settingsSyncService.ts`
  - Owns the filesystem operation that copies `{HOME}/.claude/CLAUDE.md` to `{HOME}/.raspberrycode/AGENTS.md`.
- `apps/raspberrycode-cli/packages/adapters/src/context/index.ts`
  - Resolves `{HOME}/.raspberrycode/AGENTS.md` and workspace `AGENTS.md`, then merges both when both exist.

## UX Rules

- 首启检查和手动打开共用同一个向导，但异步结果只属于发起它的那次请求。手动打开、关闭、切换工作区（含 identity）或卸载都会使旧请求失效；旧成功和旧失败都不得再开关窗口、重置选择或覆盖迁移结果。
- 手动打开接管仍在进行的首启检查，并自行完成检测与 loading 收尾。不能仅保留 `open` 而留下永久 loading，也不能在 React 状态 updater 中发起检测。
- 没有手动接管时，已处理的首启提示和空检测结果仍保持关闭；首启提示的持久化含义不变。开始导入后，迟到的检测不得覆盖导入进度或结果。

- Selection steps never trigger import immediately.
- Import only starts after entering `Migration`.
- The `AGENTS.md` step is also a selection step. It must not copy files until the user starts migration and confirms the overwrite dialog.
- The `Migration` step owns both the running state and the completed result state.
- The settings page reopens the wizard from Data Sync → `Migrate`, always at the `Sessions` step.
