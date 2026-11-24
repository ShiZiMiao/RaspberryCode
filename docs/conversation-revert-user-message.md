# 用户消息「回退」入口

## 背景

用户消息行 footer 目前只有「复制」和「编辑」两个动作。编辑走 `editUserQuery`，语义是
**改文本后立即重发**——回退只是重发的副作用，用户无法「回到发送前、把文本放回输入框、自己再决定发不发」。

本规范新增独立的「回退」动作，语义是**只回退、不重发**。

## 与既有能力的关系（边界必须清晰）

| 入口 | 命令 | 截断对话 | 回退文件 | 重发 |
| --- | --- | --- | --- | --- |
| 编辑并发送 | `editUserQuery` | 是 | 可选（`workspaceMode=rewind`） | **立即重发** |
| 重新生成 | `retryTurn` | 是 | 否 | 立即重发原文本 |
| 文件摘要撤销 | `applyFileRewind` | 否 | 是 | 否 |
| **回退（本次新增）** | `revertUserQuery` | 是 | **是** | **否** |

回退 = `revertUserQuery`，等价于 `editUserQuery(workspaceMode=rewind)` 去掉重发那一步，
并在成功后把该条消息的可见正文与附件回填到输入框。

## 回退范围

一次回退**完整恢复**到发送该条消息之前：

1. **会话状态**：active branch 截断到该 user message 之前（`rewindConversationToMessage`）。
   该轮之后的所有消息、轮次、tool 调用、后台任务全部作废；`keptMessageIDs` / `branchGeneration`
   由 runtime 写入 session revert 记录，冷恢复后不会把旧分支捞回来。
2. **文件修改**：该轮产生的 workspace 改动按 checkpoint 倒序逐次写回 before 内容
   （`applyWorkspaceFileRewind` + `commitAfterApply`，与 `editUserQuery(rewind)` 同一事务）。
3. **派生运行时状态**：`rebuildConversationDerivedState` 重置 messageHistory、readFileState、
   context prefix、`currentTurnFileChanges`、`turnNumber` 等，旧分支的 compact / usage 不得泄漏。
4. **界面状态**：该行及其后续行从投影消失；输入框回填该条消息的可见正文 + 附件，**不自动发送**。

### 不包含

- 不回退 git 提交、不清理 terminal 会话、不撤销 MCP / 插件的服务端副作用（这些无 checkpoint）。
- 不回退 bash/shell 工具产生的文件改动（`ignoredFiles`，见下）。

## 可用性（入口只在最新一轮）

与 `editUserQuery` 共用 `latestQueryEditOnly` 语义：只有**当前投影里最后一条 `realUser` 输入**可回退。
理由：历史轮回退会丢弃其后的全部对话与文件改动，且 `latestQueryEditOnly` 是 active branch 的
唯一保护闸。UI 与命令层共用同一份 `row.actions.canRevert`，UI 不自判。

新增 `row.actions.canRevert`（additive optional），与 `canEdit` 由同一个 `latestEditableRowId` 驱动。
两者分开而不是复用 `canEdit`：回退与编辑的副作用强度不同，未来条件分化时不得互相牵连。

`compact` 活跃时（`compactActive`）不提供入口，与 `canEdit` 一致。

## 协议

```ts
// command.ts
revertUserQuery: z.object({ target: conversationRowTargetSchema })
```

- 加入 `COMMANDS_REQUIRING_BASE_REVISION`（CAS）与 `ROW_TARGETING_COMMANDS`（需 `baseLogEpoch`）。
- 加入 `SELECTION_SIDE_CHAT_RESTRICTED_COMMANDS`（side chat 不允许回退主会话分支）。
- **不**加入 `requiresProviderRegistryRefresh`：回退不发起模型请求。

ACK：

```ts
{
  type: "revertUserQuery";
  disposition: "reverted" | "blocked";
  sessionId: string;
  reasonCode?: string;
  preview?: V4ConversationFileRewindPreviewResult; // blocked 时用于弹窗展示
}
```

ACK **不携带**回填材料：renderer 手上已有该行投影（可见正文、附件），回填用它才符合
「恢复到用户当时看到的样子」。把 canonical prompt 文本回填会把 code-comment / web-element
序列化标记塞进输入框。

## Handler 执行顺序（`handlers/fork-edit-retry.ts` 的 `revertUserQuery`）

`revertUserQuery` 与 fork/edit/retry 同属一个命令组文件（同组共享 `submitConversationRewind`
branch cut 原语，拆成两个文件会让「同一判定只允许一处实现」失效）。

1. `resolveRowActionTarget(target, "revertUserQuery")` → 失败抛 `V4RevertTargetNotLatestError`
   （reasonCode `guard.latestQueryEditOnly`，与 edit 同语义同码）。
2. 有活动 turn（`record.activeAbortController` 或 runtime-owned active turn）→ `preemptActiveTurnAndWait`。
3. `previewWorkspaceFileRewind`：
   - **`unsafeFiles.length > 0` 或 `ignoredFiles.length > 0` → blocked**，原样返回 preview，
     不写文件、不截断对话。理由同 `file-summary-safe-rewind`：无法证明完整回滚时 fail closed。
   - **`safeFiles.length === 0` 且无 unsafe/ignored → 跳过文件阶段**，直接进入第 4 步。
     这是与 `editUserQuery(rewind)` 的关键差异：该轮没改文件不是错误，回退仍要成功。
4. `applyWorkspaceFileRewind({ ..., commitAfterApply: () => submitConversationRewind(...) })`：
   文件全部写成功后才在同一 commit gate 提交 branch cut；`applied === false` → blocked。
5. **不调用** `startCanonicalIntent`。
6. 写 info 审计日志（`conversation.command.revert_user_query.completed`）。

## UI

- 按钮位置：user 行 `MessageActions` 内，**复制、编辑之后**（最后一个）。
- 图标 `Undo2Icon`，`data-testid="v4-revert-<rowId>"`，无障碍名「回退」。
- 点击先弹确认弹窗（`ConversationFileRewindDialog` 新增 `variant="conversationRevert"`）：
  - 标题/描述说明「回退到发送这条消息之前，本轮对话与文件改动都会被丢弃，且不可撤销」。
  - 列出将恢复的文件（`safeFiles`）、无法安全恢复的文件（`unsafeFiles`）与其原因。
  - 无文件变更时显示「本轮没有文件改动，只回退对话」。
  - 存在 unsafe/ignored 时确认按钮禁用，提示需先手动处理。
  - **预览未就绪或预览失败不阻断确认**：预览是只读告知，命令层提交前会重新预检并
    fail closed。把它做成硬前置会让一次只读查询的延迟直接锁死回退入口
    （实测缺陷：无文件改动场景按钮长期 disabled，回退无法完成）。
  - 输入框已有草稿时额外提示「输入框中现有内容将被这条消息替换」。
  - 运行中（turn 未结束）也允许：命令内部会先抢占当前轮。
- 确认后：`dispatchCommand("revertUserQuery", { target }, ...)`。
  - `accepted` + `disposition === "reverted"` → 关弹窗，触发 composer 回填。
  - `blocked` → 保持弹窗，用 ACK 的 preview 刷新文件列表与错误提示。
  - 拒绝 / 异常 → 关弹窗，保留现状，toast 提示回退失败。
- composer 回填复用 `ComposerRestoreRequest`，新增 `replaceExistingDraft?: boolean`：
  回退是用户主动要求恢复该条消息，需要覆盖既有草稿；queue 撤回编辑仍保持「有草稿则不覆盖」。

## 异常与边界

| 场景 | 行为 |
| --- | --- |
| 会话只有这一条消息 | 回退后会话为空（回到 draft 空态），输入框持有原文；不报错 |
| 该轮无文件改动 | 文件阶段整体跳过，只截断对话 |
| 文件被外部改过 / checkpoint 缺失 | blocked，弹窗列出 unsafe 文件与原因，不写任何文件 |
| bash 产生的文件改动 | 归入 `ignoredFiles` → blocked（无法证明完整回滚） |
| 运行中点击 | 先抢占当前轮再回退；被抢占轮的产物同样作废 |
| compact 活跃 | 不提供入口（`canRevert` 缺席） |
| 非最新轮 | 不提供入口（`canRevert` 缺席）；命令层直调被 resolver 拒绝 |
| 命令被拒 / CAS 冲突 | 不改变任何状态，toast「回退失败」 |
| 回填时 pane 已切到别的 session | 放弃回填并记录 warn（权威回退已生效） |

## 验证

- L2：`apps/raspberrycode-cli/packages/bootstrap/tests/v4-native-revert-query.test.ts`
  - 最新 realUser 行回退成功，ACK `reverted`，历史被截断且**没有新 user message 产生**。
  - 无文件改动时仍 `reverted`。
  - unsafe 文件 → `blocked`，文件与对话均未变。
  - 非最新行 → `guard.latestQueryEditOnly`。
- L3：`packages/desktop/test/e2e/conversation-session/conversation-session-v4-revert.test.ts`
  - 真实 Write checkpoint → 点回退 → 确认 → 文件回到 before、旧回复消失、输入框文本 == 原消息。
  - 无文件改动场景：只有对话截断。
  - 取消确认 → 弹窗关闭，文件与时间线均不变。
  - **必须同时提供两份 fixture，缺一用例会被 mock 当成没有对应响应而空转超时**：
    `test/e2e/fixtures/upstream/conversation-session/conversation-session-v4-revert.json`（响应定义）
    与 `test/e2e/fixtures/cases/conversation-session/conversation-session-v4-revert.json`（case manifest）。
    校验命令：`pnpm --filter @raspberrycode/desktop e2e:fixture:check -- --spec ./test/e2e/conversation-session/conversation-session-v4-revert.test.ts`
  - 计数类断言（「没有触发新的上游请求」）不能只读一次：发送那次请求的计数可能尚未落盘，
    会被误读成基线。用例里用 `waitForStableUpstreamCount`（连续两次读数相同）取基线。

### E2E 环境前置（否则 Electron 静默崩溃，一个用例都跑不起来）

`Chrome failed to start: crashed / DevToolsActivePort file doesn't exist` 的真因是本机
`ELECTRON_RUN_AS_NODE=1` 与 `HTTP(S)_PROXY` 同时存在。用 `env -u` 剔除后再跑：
```sh
env -u ELECTRON_RUN_AS_NODE -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  npx pnpm test:e2e -- --spec test/e2e/conversation-session/conversation-session-v4-revert.test.ts
```
