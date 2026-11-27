# Task List Context Menu

任务列表项新增右键菜单，统一承接 task 级快捷操作，避免把所有动作都堆到 hover 按钮或 Header more。

## 当前菜单项

- Move to group（分组视图；`GroupedTaskContextMenuContent`）
- Pin task
- Rename task
- Archive task
- Mark as unread
- Delete task
- Open in Finder / File Explorer / File Manager
- Copy path
- Copy task path / Copy log path / Copy session ID
- Go to config
- View model trajectory
- Report issue

## 交互说明

- `Pin task` 会持久化到 task 元数据，刷新或恢复后仍保持置顶；已置顶项菜单会显示 `Unpin task`
- 已置顶任务会常驻在列表顶部的独立 `Pinned` 分组里，不再和普通任务混排；折叠态下也始终可见
- `Rename task` 使用弹窗完成，支持 `Enter` 提交、取消关闭
- 重命名有两个等价入口：任务行右键菜单，或在任务行上双击（桌面鼠标）。两者打开同一个重命名弹窗，并预填当前标题；双击不新增另一套标题状态
- 双击的第一次点击仍按原行为立即打开任务；第二次点击不再重复打开，避免重复导航或重复建立远端连接。行内按钮、交互胶囊、工作流运行行和归档二次确认态不触发双击重命名
- 「按未读」视图不启用双击重命名：第一次点击会清除未读并移除该行，第二次点击没有可命中的目标；该视图继续使用右键菜单
- 触摸设备（`hover: none`）不启用双击重命名，保留一次点击打开和长按菜单
- 只读工作区（目录不存在或不可访问）不打开重命名弹窗，判据与右键菜单的禁用一致
- `Archive task` 会把任务标记为 archived，并从默认任务列表中隐藏
- 归档只在左侧侧栏提供（行内归档按钮、grouped 行的关闭按钮、两套右键菜单）；Header 更多菜单不展示归档。任务运行中（侧栏转圈的同一判据：sessions-index phase 为 `prewarming` / `running`）时这些入口禁用，提示「任务运行中，请先停止后再归档」。原因：归档只写 task index、不停止 agent turn，运行中归档后 agent 仍会以该任务 sessionId 新建 Browser tab，而任务已离开列表，没有 scope 能显示或关闭这个 tab。Header 的 task meta 来自 tasks-index，没有实时 phase，残留的 `status=running` 会误禁用，所以不在 Header 提供归档。
- 任务行 hover 时展示行内归档入口；首次点击进入二次确认态。确认态是显式等待用户决策的状态，鼠标移出任务行后仍保持确认按钮可见；点击任务行外空白处或按 `Esc` 取消确认态。
- `Mark as unread` 会持久化到 task 元数据；重新启动 app 后仍保留蓝点，打开该任务时再自动清除
- 重命名会持久化到 `tasks-index.sqlite` 并同步更新运行中 task 的内存 meta；恢复和快照回写必须遵守 [Task Title Authority](./task-title-authority.md)，避免 raw session snapshot 把手动标题还原成自动标题
- pin / unread / archive 也会同步更新运行中 task 的内存 meta，避免后续 session 持久化把旧状态写回来
- `Copy path` 指向 task 的持久化快照文件路径
- `Copy log path` 指向 task 对应的原生日志路径；RaspberryCode Agent 使用按日期滚动的结构化 JSONL 日志
- `Go to config` 会复用当前持久化的编辑器偏好；如果无法直接用编辑器打开，则回退到文件管理器

## Delete task（2026-11-14 新增）

任务右键菜单新增 `Delete task`（`删除任务`），用于不移步归档列表就直接把任务从任务列表中永久移除。

### 交互与状态

- 入口位置：任务管理动作组内，紧随 `Mark as unread` 之后、分隔线之前；`variant="destructive"`，`data-testid="task-delete"`。
- 归档视图打开时，`Archive task` 变为 `Unarchive task`，`Delete task` 仍然可用；对已归档任务执行删除即“直接永久删除”，与归档列表内单条删除等价。
- 点击后先走 `useConfirmDialog`：标题 `confirmDialog.taskDeleteTitle`，说明 `confirmDialog.taskDeleteDescription`（只声明从任务列表移除、不会再出现在列表中），确认按钮 `taskList.delete`、`confirmVariant="destructive"`。取消不写入任何数据。
- 确认后执行既有条件删除链路 `mutateProjectTask({ kind: "delete" })` → `IWindowControllerService.mutateTask` / `IRaspberryCodeTaskService.deleteTask`，成功后调用 `removeTaskState` 回收选中态、运行态与 composer 草稿，再 `refresh()` 刷新列表。
- 失败以 toast `taskList.deleteFailed` 呈现，不乐观移除任务行。

### 保留语义（不改变既有事实归属）

- 删除只写 task 列表 membership 的 tombstone（`deleted` + CLI handoff 意图），CLI 会话文件、会话正文、项目文件与 worktree 均保留；不新增 App-Agent wire 命令，不改动 `CommandInbox`、owner/lease 与运行时的会话事实。
- 远程任务仍按完整身份路由：`workspaceIdentity` / `remoteSessionId` / `sourceServerId` 与其它写操作一致，离线和已换代 source 保持 fail-closed。
- 只读工作区（`isWorkspaceReadOnly`）下入口禁用，标题使用既有 `workspaceSidebar.unavailableLocalDirectory` 说明。

### 覆盖

- 入口与禁用态：`packages/ui/test/taskActionMenuContent.test.ts`（菜单项顺序与 `disableTaskTargetActions` 组合）。
- 真实交互与持久化：`packages/desktop/test/e2e/conversation-session/manual-review/pending/conversation-session-task-delete-context-menu.test.ts`（pending 代表人，右键 → 确认 → 行消失 → tasks-index `deleted=1`、CLI 会话保留）。

## 2026-11-14 删除任务后布局整体下推（根因与修复）

现象：删除任务后整页（含侧栏）向下偏移、底部输入区被裁出视口，且顶部出现大片空白。

根因不在删除逻辑，也不在布局：`packages/desktop/src/renderer/src/main.tsx` 在模块作用域直接
`createRoot(document.getElementById("root"))`，没有跨 HMR 复用。开发态 Vite 重新求值该模块时，
同一个 `#root` 上被叠加多个 React root；每个 root 都渲染一棵 `h-dvh` 整高树并各自持有 container
的 children 所有权，后续提交互相 `removeChild` 对方节点，抛
`Failed to execute 'removeChild' on 'Node'`。根级 `AppErrorBoundary` 再把整高兜底卡片追加进
`#root`，于是 `#root` 里堆起 2 个兜底卡片 + 1 棵真实应用，应用被推到第三屏，视觉上就是整体下移。

修复：root 实例按 `Symbol.for("raspberrycode.renderer.root")` 挂在 window 上跨 HMR 复用，
复用前 `replaceChildren()` 清掉上一次求值遗留的 DOM；`message` 监听器同样按
`Symbol.for("raspberrycode.renderer.servicePortListener")` 记录引用并精确移除，避免重复处理
ServicePort 消息导致重复 render。生产加载只执行一次模块，行为不变。

回归护栏：`conversation-session-task-delete-context-menu.test.ts` 在删除后断言
`#root` 只有一个整高子节点、无错误兜底卡片、`window frame` 贴顶且高度等于视口高度。
