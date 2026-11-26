# 下一步输入预测

## 背景

Agent 回复结束后，用户往往需要再输入一句追问或指令（「继续」「先跑一遍测试」「把刚才的改动提交」）。
这类输入高度依赖上一轮上下文，但用户仍要自己组织语言。

参考 TRAE：在最后一条助手消息下方给出最多 3 条「用户下一步可能输入」的建议条，
点击直接发送，悬浮可把文本加入输入框。

仓库已有完整的输入预测链路（原手机远控 ghost hint）：

- 线格式 `v4/conversation/inputPrediction`（`packages/shared/src/raspberrycode-protocol-v4/input-prediction/`）；
- Host 服务方法 `conversationInputPredictionV4`（`packages/services/src/raspberrycode-agent/raspberrycodeAgentService.ts`）；
- CLI 处理器与提示词（`apps/raspberrycode-cli/packages/bootstrap/src/raspberrycode-protocol/input-prediction-handler.ts`、
  `apps/raspberrycode-cli/packages/core/src/runtime/methods/input-prediction-sidecar.ts`）。

本 spec 只新增渲染层 UI、设置开关与草稿追加通道，**不改协议**。

## 产品规则

1. **位置**：建议条渲染在最后一条助手消息的操作栏下方、轮组内部，随消息滚动，不进入输入框 dock。
2. **可见性**：仅在「最后一条助手正文完成」（`unit.isRunning === false` 且
   `latestAssistantTextRow.state === "complete"`）后展示。以下情况不展示、不请求：
   - 草稿会话（`sessionId === null`）；
   - 只读会话、选择侧聊、移动紧凑浮层；
   - 非聚焦 pane；
   - 设置开关关闭；
   - 远端连接未就绪（`rpcReady === false`）。
3. **数量**：最多 3 条、最少 0 条。只展示置信度 ≥ 0.6 的候选；低于门槛的候选即使同批 top 达标也不展示。
   无候选时不渲染容器，不留空白占位。
   - **布局**：1 条时行内展示；多于 1 条时纵向排列，每条独占一行、左对齐。
4. **点击建议条**：直接发送该文本，不改动输入框现有草稿。发送后新一轮开始运行，建议条随之消失。
5. **悬浮建议条**：出现「添加到对话框」按钮；点击后把文本**追加**到输入框。
   - 输入框为空时等价于写入；
   - 已有草稿时补一个空格后追加，不覆盖用户内容；
   - 追加后建议条保留显示（用户可继续追加或直接点击发送）。
6. **设置开关**：`nextInputPredictionEnabled`，默认开启。关闭后不再发起预测，已展示的建议条立即消失。
7. **失败静默**：预测失败、超时、无模型、旧 CLI、远端未就绪一律视为「无建议」，
   不弹错误、不重试、不影响主链路。
8. **每轮一次**：同一轮最多发起一次预测；同一轮内 `revision` 变化不重复请求；
   迟到响应按 `requestId` 丢弃。
9. **只读**：建议文本只来自模型候选，不写入会话、不进历史、不产生任务事件。

## 数据口径

- 复用 `v4/conversation/inputPrediction` 的只读查询，请求不带 `draft`（预测下一条完整输入）。
- 仅当 `decision === "show"` 时取 `candidates`；其余决策（`suppress_below_threshold`、
  `suppress_no_context`、`unavailable`、`cancelled`）一律 0 条。
- CLI 侧逐条按置信度门槛过滤候选：低于 0.6 的候选不返回；过滤后为空则 `suppress_below_threshold`。
- `candidates[].text` 在草稿为空时就是整条输入；渲染前 trim、去重、截断到 3 条。
- 单条候选上限 40 字；置信度门槛 0.6（2026-11-26 手工验收后从 0.8 下调：
  真实模型对清晰模式的 top 置信度约 0.55–0.62，0.8 会让建议条几乎不出现）。
- 请求参数：`sessionId`、`revision`（当前会话投影 revision）、`requestId`（renderer 自增）。
- 触发延迟 800ms：避免用户连续发送时浪费模型调用。

## 接口

无协议改动。新增设置字段：

```ts
// packages/shared/src/protocol.ts AppSettings
nextInputPredictionEnabled?: boolean; // 默认 true
```

草稿插入通道新增 `append` 模式：

```ts
// ComposerTextInsertRequest.mode
"replace" | "prepend-if-missing" | "append"
```

## 模块与所有者

- 新 managed 模块 `next-input-suggestions`（`packages/ui/src/next-input-suggestions/`）：
  建议条 UI、请求编排 hook、设置开关组件、纯函数契约。
- 会话行、运行态与 `revision` 归 v4 conversation projection（CLI 权威）。
- 建议候选是本模块 hook 的局部只读投影，不持久化、不跨窗口同步。
- 草稿文本的唯一所有者仍是 composer；「添加到对话框」经 `requestComposerTextInsert`
  的 `append` 模式写入，不绕过编辑器。
- 发送走宿主注入的 `onSend`（SessionPane 的 `handleSendText`），不新增发送路径。
- 设置开关归 `AppSettings`（Host 持久化，跨窗口广播）。

## 验收

1. 连续两轮对话后，最后一条助手消息下方出现建议条；最多 3 条，文本来自模型候选。
2. 无候选（置信度不足、轮数不足、模型不可用）时不渲染任何建议条。
3. 点击建议条直接发送该文本；发送后建议条消失，输入框草稿保持不变。
4. 悬浮建议条出现「添加到对话框」；点击后文本追加到输入框，已有草稿不被覆盖。
5. 输入框已有草稿时建议条仍显示。
6. 设置中关闭开关后不再出现建议条；重新开启后下一轮恢复。
7. 会话运行中、草稿会话、只读会话、非聚焦 pane 不出现建议条。
8. 预测失败或超时静默无建议，不弹错误，不影响发送与流式回复。
9. 深浅主题、中英文长度下建议条不溢出、不遮挡操作栏。
