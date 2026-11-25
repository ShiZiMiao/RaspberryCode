# 冷启动固定进入首页（不选中任何项目）

## 背景

当前冷启动的激活目标来自持久化的 `lastActiveWorkspace`：`resolveStartupRemoteWorkspaceSessions`
只恢复该单条目并把它设为 active tab（`packages/ui/src/root/remoteWorkspaceSessionPersistence.ts`）。
因此用户上次停在哪个项目、哪个任务，下次启动就回到那里；只有当**完全没有任何可恢复条目**时，
才会落到 conversation backing workspace（首页草稿态）。

用户需求：启动后始终显示首页（品牌 Logo + 时间问候 + 空 Composer），且项目选择器显示
`选择项目`（未选中任何项目）。这是一个显式的产品行为变更，覆盖
[2026-04-01-first-run-default-project-design.md](./2026-04-01-first-run-default-project-design.md)
与 [2026-07-10-non-project-conversation-workspace-design.md](./2026-07-10-non-project-conversation-workspace-design.md)
里"有可恢复 workspace session 就恢复 active"的默认语义。

## 产品规则

1. **冷启动固定首页**：Desktop 冷启动（非 renderer reload）一律激活 conversation backing
   workspace，`workspacePurpose=conversation`，`draftProjectId` 为空，不选中任何项目。
2. **只影响冷启动**：同一 renderer 的 `location.reload()`（如主题/语言触发的重载）仍按现状
   保留当前 panes 与任务现场，不强制回首页。判据复用 `isRendererReloadNavigation()`。
3. **显式入口优先**：以下路径属于用户显式指定目标，不受本规则影响，维持既有行为：
   - open-workspace / deeplink / 系统右键「用 RaspberryCode 打开」→ `createOpenWorkspaceStartupBootstrap`
   - 托盘或 Dock 触发的第二个窗口（`restoreSession=false`）
   - 任务通知点击、跨窗口 focus tab
4. **不删除历史列表**：首页不激活任何项目，但左侧栏项目/任务列表的读取逻辑不变；
   用户点选项目或任务仍照常打开。禁止把"启动首页"实现成清除 `lastActiveWorkspace`，
   否则用户失去"上次在做什么"的可追溯入口。
5. **可配置，默认开启**：新增设置项 `startupShowHome`（默认 `true`）。
   关闭后回到改动前的行为（恢复 `lastActiveWorkspace`）。

## 状态与所有权

| 事实 | 唯一所有者 | 说明 |
| --- | --- | --- |
| `startupShowHome` | `AppSettings`（`packages/shared`） | 完整 schema 与 patch schema 都要声明；只由设置服务写入 |
| 冷启动是否走首页 | Main 进程 `resolveStartupWindowBootstrap` | 读设置后产出 bootstrap，不缓存判据 |
| 激活哪个 workspace | Renderer `restorePersistedRemoteWorkspaceSessions` | 消费 bootstrap 的 `initialWorkspacePath`，不再自行按 `lastActiveWorkspace` 抢焦点 |
| conversation backing path | `fileService.ensureConversationWorkspace()` | 幂等；Main 与 Renderer 共用同一解析结果 |

明确不做的事：

- 不在 Renderer 侧二次读取 `startupShowHome` 覆盖 Main 决策（避免两条写入/判定路径）。
- 不清空、不重写 `lastActiveWorkspace`、`lastWorkspaceSession`、`lastActiveTaskByWorkspace`。
- 不改变 `workspacePurpose` 语义与 `workspaceKey` 归一化规则。

## 数据流

```text
Main: app ready
  -> readStartupSettings(settingsFile)          // 已存在，含新字段
  -> resolveStartupWindowBootstrap()
       explicit startupOpenWorkspaceRequest? -> 原 Open Workspace 路径（不变）
       startupShowHome === false            -> 原 lastActiveWorkspace 恢复路径（不变）
       startupShowHome === true (default)   -> ensureConversationWorkspace()
                                               initialWorkspacePath = conversationDir
                                               initialWorkspacePurpose = "conversation"
                                               agentWarmupTargets = [conversationDir]

Renderer: Root
  -> restoreSession && !initialWorkspaceIdentity
  -> restorePersistedSession(settings)
       initialWorkspacePurpose === "conversation"
         -> 只恢复 conversation tab 为 active
            lastActiveWorkspace 命中 conversation 时复用，否则新建该 tab
         -> 其余持久化条目仅补齐为 inactive tab（沿用 active-first 的 deferredRestore）
  -> Composer 落在 conversation 草稿态 => 首页；项目选择器显示「选择项目」
```

关键点：`agentWarmupTargets` 必须指向 conversation 目录，否则 Main 仍会按旧设置预热上次项目，
与"启动即首页"的实际激活目标不一致（预热成本与 cwd 归属都会错）。

## 验收场景

1. **典型冷启动**：`lastActiveWorkspace` 指向某项目 A 且该项目存在 → 关闭应用 → 重新启动 →
   显示首页（问候语 + 空 Composer），项目选择器为「选择项目」，左侧栏仍能看到项目 A 与历史任务。
2. **上次停在任务里**：上次打开某个具体任务 → 冷启动后不自动进入该任务，仍是首页草稿。
3. **收敛为开关关闭**：设置页关闭「启动时显示首页」→ 冷启动恢复上次 active 项目/任务（等于改动前行为）。
4. **renderer reload 不受影响**：在任务页按 F5 / 触发重载 → 仍停留在该任务，不回首页。
5. **显式入口不受影响**：资源管理器右键「用 RaspberryCode 打开」某目录 → 直接进入该目录，不回首页。
6. **上次项目已删除**：`lastActiveWorkspace` 指向不存在的目录 → 冷启动仍正常进首页，不报错、
   不出现 unavailable 只读态入口抢占。
7. **远程上次 active**：上次 active 是 SSH 远程项目 → 冷启动进首页，不自动重连、不自动挂回该 tab 为 active。

## 涉及文件

| 文件 | 改动 |
| --- | --- |
| `packages/shared/src/protocol.ts` | `AppSettings` 增加 `startupShowHome?: boolean` |
| `packages/shared/src/validationAppSettings.ts` | 完整 schema `default(true)`；patch schema `optional()` |
| `packages/desktop/src/main/startupWorkspace.ts` | 首页分支：返回 conversation bootstrap |
| `packages/ui/src/root/remoteWorkspaceSessionPersistence.ts` | 首页模式只把 conversation tab 设为 active |
| `packages/ui/src/Root.tsx` | 把首页意图传入恢复流程 |
| `packages/ui/src/SettingsPage.tsx` / `settingsPageHelpers.tsx` | 设置项开关 |
| `packages/ui/src/i18n/locales/{zh-CN,en-US}.ts` | 文案 |
| `packages/desktop/test/startupWorkspace.test.ts` | 首页分支单测 |

## 与既有 spec 的关系

本文覆盖 `2026-04-01-first-run-default-project-design.md` 的"优先恢复 `lastWorkspaceSession`"
默认语义，仅限 Desktop 冷启动且 `startupShowHome !== false` 时生效。其余场景（reload、显式入口、
Web/手机）继续沿用原文档。
