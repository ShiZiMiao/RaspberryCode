# 轮尾「重新生成」与「本轮用量」

## 背景

截图中两条能力此前在 V4 对话里都没有产品入口：

- V4 迁移时按 `latestAssistantRetryOnly` 裁决把 assistant retry 入口**全部隐藏**（`canRetry` / `retryTurn` 只留协议兼容）。用户能重跑一轮的唯一方式是编辑原提问，代价更高。
- 输入框下方状态条只有**会话级**累计（`v4/conversation/usage`）；单轮花了多少 token 在 UI 里没有任何入口，Developer Tools 的调试表也不算产品面。

## 1. 重新生成（regenerate）

### 产品行为

- 入口位置：完成态 assistant 轮尾动作行，紧跟复制，位于赞/踩之前。
- 图标：`RefreshCw`，与 fork/赞/踩同为 3.5 号 ghost 图标。
- tooltip：`点击将重新生成会话和产物，请谨慎操作`。措辞必须点明「会话和产物」——这个动作是 `retryTurn`，会 rewind 截断该轮之后的历史并丢弃本轮工作区改动，和「再问一遍」不是一回事。
- 可见性由**能力**裁决，不由 UI 猜：
  - 只有 `assistantText.actions.canRetry === true` 的行渲染按钮（CLI 投影 `latestAssistantRetryOnly`：全时间线最新一条 assistantText + 同轮有 `origin=realUser` 的 canonical user input）。
  - 只读会话（宿主未注入 `onRetry`）、运行中、synthetic 轮（background result / goal continuation / mailbox）一律不渲染。
  - 其余行不渲染任何 retry 入口 —— 不出现「点了会被命令层拒绝」的按钮。

### 数据与归约

点击 → `runUserAction({featureId: "conversation.history.branch", action: "retry"})` → 宿主 `handleRetry` → `retryTurn` CAS 命令 → CLI rewind 截断 + 按 canonical `ConversationInputIntent` 重发。

埋点不新造 feature：`conversation.history.branch` 已含 `retry` 词，与 `fork`/`edit` 同一域。

### 不变量

- `canRetry` 与命令层解析必须共用同一份权威：UI 不得按 rows 位置或文案自行判断。
- 命令被拒绝时不改 UI 状态（没有乐观态需要回滚）。

## 2. 本轮用量（turn usage）

### 事实源

`turnHeaderRow.usage`（协议见 `docs/v4-refactor/10-protocol-spec.md`）。

三层口径必须严格区分，混用就会对不上号：

| 展示 | 来源 | 语义 |
| --- | --- | --- |
| 本轮用量（本轮新增） | `turnHeader.usage` | 该 product turn 内主链路 ModelComplete 的累计 |
| Token 用量（输入框下方） | `v4/conversation/usage` | 整个会话累计（含 subagent/workflow child） |
| 上下文容量圆环 | `snapshot.usage.contextWindow` | 当前上下文水位，与会话累计无关 |

只有 `querySource === "main_turn"` 的 ModelComplete 进本轮用量：subagent、workflow child、标题生成、compact 验证器都属于别的执行线，混进来会让「这一轮」与用户看到的这一轮对不上。

### 写入路径

- **live**：`ProductProjection.onModelComplete` 逐请求累加（`accumulateTurnUsage`），`TurnComplete.usage`（`ModelUsageSummary`）在轮终态收口覆盖（`settleTurnUsage`）——流式期观察时机不可靠，终态以持久汇总为准。
- **cold**：`transcript-hydration` 从 assistant message 的 `info.tokens` 累加（`addHydratedUsage`），经合成 `TurnComplete.usage` 走同一条归约。合成事件里那个零占位 ModelComplete 的 usage 不参与，它只为恢复 output-token Continue 资格。
- `message.info.summary === true` 的 compact 摘要消息不计入：压缩请求的 token 不属于用户这一轮。

### 未知不冒充 0

缺席 = 不知道。以下情形 `usage` 整体缺席，UI 不渲染 chip：

- provider 未回报用量（旧 transcript、部分兼容端点）。
- 冷恢复只有零 token 记录。
- controlOnly 轮（没有 agent 工作）。

UI 侧同理：`inputTokens === 0` 时不显示缓存命中率（0% 会把「没有输入」说成「缓存完全没命中」）。

### 展示

- chip：`用量 569K tok`，位于动作行时间戳之前。**只报用量，不报缓存命中率**——命中率是判断「值不值」的次级信息，塞进同一行会把动作行撑长、挤掉同排图标按钮。它在悬浮面板里单独成行。数字用 `formatCompactTokenNumber`（zh-CN 走万/亿，en-US 走 K/M）。
- 合计 = `inputTokens + outputTokens`。缓存读写是 input 侧拆分，再叠一次会虚高。
- 悬浮面板（hover / focus；触屏 pointerdown），宽 `w-80`：`本轮用量` + 合计，明细行为
  - 提供方 / 模型：`SJFD/DeepSeek-V4.1-Flash-1017`（本轮首个有模型的请求；一轮内切模型不改写）。**这一行不截断**——`break-all` 换行显示完整身份串，截成 `DeepSee…` 会让这行失去唯一用途。
  - 缓存命中：`cacheReadTokens / inputTokens`
  - 未缓存输入：`inputTokens - cacheReadTokens`
  - 缓存读取、输出

  缺席项整行省略，不出现空斜杠或占位破折号。

### providerId ≠ 用户看到的提供方名

`usage.provider` 存的是 **providerId**，不是用户看到的名字。用户自建连接时 id 自动生成（`new-provider`），他起的名字（`SJFD`）存在 provider_config 的 `providerName`，**只有渲染侧拿得到**——CLI 不应该也不需要知道用户给连接起了什么名。

所以折算必须在渲染侧做（`TurnUsageChip.formatTurnUsageProviderLabel`）：

1. 目录命中（`context.modelSelectionView.providers` 里 `providerId` 相同）→ 用它的 `providerName`。
2. 内置预置供应商 → 只显示模型名（与 composer 触发器同一口径）。
3. 目录查不到（连接已删、跨机器开启的会话）→ **只显示模型名**，绝不拼原始 id：`deleted-provider/DeepSeek-…` 比缺一行更难读。

注意 `resolveProviderLabel` 在查不到时会回落成 id 本身，**不能用它的返回值真假判断是否命中目录**，必须显式 find 一次。

### 提供方/模型的取值顺序

`流式期已落定的身份` → `会话 config`。必须带第二档：冷恢复的合成 ModelComplete 全是零用量，会被判成「无事实」而不写身份，只认第一档会让**所有历史会话**的面板都缺这一行（曾经的实测症状）。反过来，live 一轮内切过模型时第一档记的是首个模型，不能被 config 覆盖。

### 数据链路

```
ModelComplete(main_turn) ──accumulate──► turnHeader.usage ──┐
                                                            ├─► 轮尾 chip / 面板
TurnComplete.usage ──────settle─────────► turnHeader.usage ─┘
                                                            ▲
assistant info.tokens ──addHydratedUsage──► TurnComplete.usage（cold）
```

UI 侧 `ConversationTurnGroup` 从 `unit.header.usage` 取，逐段下传到轮尾 assistantText 的动作行；普通段（`hideAssistantActions`）不显示。

## 验证

- `packages/ui/test/v4TurnUsageChip.test.ts`：合计口径、chip 不含命中率、面板行与身份串省略规则、providerId → 显示名（含目录未命中只显示模型名）。
- `packages/ui/test/v4AssistantFeedback.test.ts`：`canRetry` 门与 `retryTurn` target。
- `apps/raspberrycode-cli/packages/bootstrap/tests/product-projection.test.ts`：逐请求累加、subagent 不入账、零占位不落明细、TurnComplete 收口覆盖、收口时回填 config 身份。
- `apps/raspberrycode-cli/packages/bootstrap/tests/transcript-hydration.test.ts`：cold 还原、零 token 缺席、summary 消息排除、cold 补 provider/model。
