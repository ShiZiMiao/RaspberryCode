# 输入框下方会话统计 / Token 用量 / 上下文容量

## 背景

会话的用量事实目前分散在两处：

- **上下文容量**只挂在 composer 工具条左侧（`ChatContextUsage`，`TID_CHAT_CONTEXT_USAGE_TRIGGER`），
  与模型/思考档位挤在同一行，容量语义被当成"配置项"读。
- **会话统计**（轮次、模型用时、首 token 延迟、输出速度）没有产品入口，只有
  `DeveloperToolsPane` 的调试表能看，普通用户不可见。
- **Token 用量**只剩协议方法 `v4/conversation/usage`（`getTaskTokenUsage`），
  UI 从未消费；累计总量、缓存收益无处可看。

参考 deepseek-harness：三类事实以**胶囊 chip** 形式排在输入框正下方，
点击/悬停展开明细。本 spec 采用同一信息架构，但数据一律取自 RaspberryCode 现有权威源，
不新增第二份状态。

## 产品规则

1. **位置**：三个 chip 渲染在输入框底排的**中部**，右对齐贴住模型选择器，与
   `+` / 分支 / 权限 / 模式同排，与模型名 / 语音 / 发送同排。
   - **不再单独占输入卡上方的一行**。历史上那一行与消息动作行共用同一水平带，
     正文滚动时必然经过，于是只能在两种坏结果里二选一：
     - 遮罩把整条带淡出 → 左侧动作行跟着变灰（用户实测截图：`昨天 19:58` 半透明）；
     - 遮罩只切输入卡 → 正文清晰压在 chip 上，并从 chip 缝隙透出来。
     遮罩是**全宽横向渐变**，分不清左右，无法只保护其中一侧。
   - **并入底排的收益**：输入区不再多一整行，动作行上方的水平带只剩它自己，
     从根上消除"两个元素抢一条带"的冲突。
   - **实现**：`ChatPromptEditor` 的 `footerInlineSlot` 插槽，位于左侧操作区与右侧
     `submitControl` 之间。没有传这个插槽的形态（行内编辑等）底排布局完全不变。
   - **宽度不足时降级为只留图标**：底排可用宽度由左侧（`+`/分支/权限/模式，约 160px）
     与右侧（模型名 + 语音 + 发送，约 280px）挤压，窗口 1180px 以下中间只剩几十 px。
     此时逐个 chip 各自 truncate 会得到「5 轮 7 步·4…」「2…」这类无信息量碎片，
     因此整块隐藏摘要文字、只留图标（图标有语义：仪表=会话统计、数据库=Token、
     圆环=容量且自带用量弧），完整数字进悬停面板。
     阈值用容器查询 `@max-[1180px]/composer`，不是视口查询——底排宽度取决于侧栏与面板。
   - **宽度取舍的实测依据**（1180px 窗口）：底排 460px，左侧 158px、右侧 278px，
     中间仅剩 24px 而完整状态条需要 294px。这个数字决定了"必须降级"而不是"再挤一挤"。
   - 状态条随输入卡一起固定在 bottom dock，不随消息滚动。
   - **dock 必须挂在滚动容器之外**（`timelineRoot` 的直接子项），这是唯一同时满足
     「输入框常显」与「内容不被裁」的结构。
     - 在滚动容器**内部**时只能二选一：`sticky bottom-0` 能常显但内容会滚到它背后被
       裁断/发灰；`shrink-0` 不裁但输入框会随内容滚出视野（用户实测两次否决）。
     - 移到外部后，滚动容器的 `flex-1` 只分配给消息，dock 的 `shrink-0` 独占自己的
       高度（实测 scroll 从 830 降到 686，正好让出 dock 的 144px）。
     - 移出后**根节点必须加 `overflow-hidden`**，否则 dock 虽在根节点内仍会溢出到
       可视区外。
     - 验证方法：`composerDockRef.current.parentElement === timelineRootRef.current`
       必须为 true；若为 false 说明 dock 仍在滚动容器里（改缩进/移动代码时容易做错）。
   - **消息层不使用渐变遮罩**：历史上的「离底滚动时淡出底部内容」与动作行直接冲突——
     淡出带相对视口固定，动作行随内容滚动，滑进那条带就被整行削成半透明。
     `clearMessageLayerMask` 恒定清空遮罩样式（兼作旧会话恢复时的残留清理）。
   - 各层自带不透明底色（dock 外壳 / dock 内容列 / 输入卡容器），
     作为 `back-to-bottom` 按钮等 absolute 浮层的视觉兜底。
2. **可见性**：仅在已存在会话（`sessionId !== null`）且后端返回过可用事实时渲染。
   草稿态（新任务）与零数据态不渲染空壳；任一 chip 的数据缺失只隐藏该 chip。
3. **三个 chip**（从左到右，与 dsh 顺序一致）：

   | chip | 摘要文案 | 明细弹窗 |
   | --- | --- | --- |
   | 会话统计 | `{rounds} 轮 {steps} 步 · {tps} tok/s`（tps 缺失时省略该段） | 标题「会话统计」+ 右侧 `{rounds} 轮 {steps} 步`；行：模型用时 / 首 token 平均（TTFT）/ 输出速度（TPS） |
   | Token 用量 | `{totalTok} tok · 缓存命中 {rate}`（rate 缺失时省略该段） | 标题「Token 用量」+ 右侧 `{totalTok} tok`；行：缓存命中 / 未缓存输入 / 缓存读取 / 输出 |
   | 上下文容量 | 圆环图标 + `{percent}` | 沿用现有 `ChatContextUsage` 明细（容量条 + 来源占比 + 缓存命中率） |

4. **交互**：桌面 hover 即展开、点击固定；触摸端 `pointerdown` 展开（沿用
   `ChatContextUsage` 已有的 touch 分支）。弹出层方向 `top`，与 chip 底部对齐。
5. **数字格式**：token 数用 `formatCompactTokenNumber`（`9.9K tok`、`1.2M tok`）；
   用时小于 1 秒用 `0.8 秒`，否则 `1.1 秒`；TPS 取整（`434 tok/s`）；百分比保留 1 位小数。
6. **不新增第二份状态**：chip 只消费
   - 会话投影 `snapshot.usage`（上下文容量，既有）；
   - `v4/conversation/usage` 返回的会话用量聚合（token/缓存）与会话统计聚合（轮/步/用时/TTFT/TPS）。

## 数据口径

### 会话统计（新增字段，`v4/conversation/usage`）

数据源为 CLI 侧持久化 usage 表（`model_usage` / `turn_usage`），因此进程重启后仍成立。

- **轮** `roundCount` = `turn_usage` 中该 session 的行数（一个 product turn 一行）。
- **步** `stepCount` = `model_usage` 中 `query_source = 'main_turn'` 的记录数
  （与 `turn_usage.model_request_count` 同源，取记录数避免重复求和）。
- **模型用时** `modelDurationMs` = `main_turn` 记录 `duration_ms` 之和
  （模型请求从发起到完成的墙钟，不含工具执行）。
- **首 token 平均** `avgTimeToFirstTokenMs` = `main_turn` 记录中 `time_to_first_token_ms`
  非空样本的算术平均；无样本时为 `null`。
- **输出速度** `outputTokensPerSecond` = `Σ output_tokens / Σ(duration_ms - time_to_first_token_ms)`，
  仅累计两者都完整的记录；分母 ≤ 0 时为 `null`。
  口径与 `calculateOutputTps`（`packages/shared/src/session-debug.ts`）一致：
  TPS 只衡量首 token 之后的生成段，不用请求总耗时替代。

### Token 用量

- **总量** `totalTokens`：沿用现有增量口径（`queryTaskUsage` 的 baseline 递减），
  避免上下文重复计入。
- **未缓存输入** `uncachedInputTokens` = `Σ input_side_tokens - Σ cache_read_tokens`（下限 0），
  只统计 `main_turn` / `subagent` / `workflow_child` 三类基线来源，与增量口径同一批行。
- **缓存读取** `cacheReadTokens`、**输出** `outputTokens`：现有聚合值。
- **缓存命中率** `cacheHitRate` = `Σ cache_read / Σ input_side`（`main_turn` 行的 provider 原始
  input 侧 token 为分母，含缓存读写）；分母 0 或存在未知用量行时为 `null`
  （与 `session-debug` 的 `hasUnknownCacheUsage` 判定一致，不臆造 0%）。

## 接口

`v4/conversation/usage` 结果新增字段（additive；CLI 与桌面同批发版，无偏斜窗口）：

```ts
{
  // 既有：sessionId / totalTokens / inputTokens / outputTokens / reasoningTokens
  //       cacheCreationTokens / cacheReadTokens / modelRequestCount / modelErrorCount
  //       inputBaselineBySource
  uncachedInputTokens: number;          // 未缓存输入
  cacheHitRate: number | null;          // 0..1，null = 不可用
  roundCount: number;                   // 轮
  stepCount: number;                    // 步
  modelDurationMs: number;              // 模型用时
  avgTimeToFirstTokenMs: number | null; // 首 token 平均
  outputTokensPerSecond: number | null; // 输出速度
}
```

## 模块与所有者

- 新 managed 模块 `composer-status-bar`（`packages/ui/src/composer-status-bar/`）：
  三个 chip、明细弹窗、会话用量读取 hook。只读展示，不写协议、不改会话状态。
- 聚合计算归属 CLI：`queryTaskUsage` 是唯一计算点，扩展它而不是在 UI 里二次求和。
- 上下文容量 chip 复用 `ChatContextUsage`（`chat-input-toolbar/contextUsage.tsx`），
  仅新增 chip 外观变体，明细内容与 `TID_CHAT_CONTEXT_USAGE_TRIGGER` 锚点不变。

## 验收

1. 已有一条会话完成一轮后，输入框下方出现三个 chip；摘要数字与明细弹窗一致。
2. hover 会话统计 chip 展开明细，模型用时/TTFT/TPS 三项齐全；TTFT 无样本时不显示该行。
3. hover Token 用量 chip，四项（缓存命中/未缓存输入/缓存读取/输出）与总量自洽：
   `未缓存输入 + 缓存读取 + 输出 = 总量`（允许 ±1 的取整误差）。
4. hover 上下文容量 chip，原有容量条与来源占比不变；工具条左端不再有容量入口。
5. 重启应用后重新打开该会话，三个 chip 数据仍成立（来自持久化 usage 表，不是内存旁路）。
6. 草稿态（新任务未发首条消息）不渲染状态条。
7. 窄宽度下三个 chip 不溢出、不与消息动作行重叠；窗口缩到最小宽度时二者仍分列左右。
8. 悬停消息末尾时，动作行（左）与状态条（右）在同一水平带内各自对齐，无遮挡。
