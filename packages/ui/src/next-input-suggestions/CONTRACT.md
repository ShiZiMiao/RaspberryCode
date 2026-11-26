# next-input-suggestions

Agent 回复结束后的下一步输入预测：在最后一条助手消息下方展示最多 3 条建议条，
点击直接发送，悬浮可把文本追加到输入框。产品规则见 `specs/next-input-suggestions.md`。

## 存在的意图

用户在一轮回复结束后往往还要补一句追问或指令，但需要自己组织语言。
这里复用已有的只读输入预测链路，把候选直接呈现在消息流里，减少一次输入成本。

## 不变量

- **只读。** 预测不写会话、不进历史、不产生任务事件；候选只是本模块 hook 的局部投影。
- **每轮最多一次。** `requestedTurnKeyRef` 记录已请求的轮次；同一轮内 `revision` 变化不重复请求。
- **迟到丢弃。** 每次请求带自增 `requestId`；回包不是最新请求就丢弃。
- **门禁集中。** `shouldRequestNextInputPrediction` 是唯一判定点：开关、聚焦、RPC 就绪、
  会话存在、轮次存在、轮次完成必须同时成立。
- **失败静默。** 任何异常都收敛成「无建议」，不弹错误、不重试。
- **草稿所有者是 composer。** 本模块不直接写编辑器；「添加到对话框」经
  `requestComposerTextInsert(..., "append")` 交给 composer 消费。
- **发送走宿主。** 点击建议条调用宿主注入的 `onSend`（SessionPane 的 `handleSendText`），
  不新增发送路径，也不改动输入框草稿。
- **纯函数与 IO 分离。** `contract.ts` 只有门禁、候选收敛与配置形状；
  请求编排在 `useNextInputSuggestions`，UI 在 `ConversationNextInputSuggestions`。

## 与其它模块的交集

- **服务通道**：`raspberrycodeAgentService.conversationInputPredictionV4`
  （协议 `v4/conversation/inputPrediction`），经 `@/hooks/useWorkspaceServices` 访问，
  本地与远端 workspace 由同一解析结果路由。
- **设置**：`AppSettings.nextInputPredictionEnabled`（默认 `true`），
  经 `@/hooks/useSettingService` 读取与更新。
- **输入框写入**：`requestComposerTextInsert` 的 `append` 模式，
  与其它草稿写入路径同级，不绕过编辑器。
- **时间线**：由 `ConversationTimeline` 注入给末轮 `ConversationTurnGroup`，
  只在最后一条助手正文完成且未运行时渲染。
