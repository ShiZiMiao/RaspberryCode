# composer-status-bar

输入框正下方的会话统计 / Token 用量 / 上下文容量三 chip 状态条
（spec：`specs/composer-status-bar.md`）。

## 存在的意图

会话的三类事实原本分散：上下文容量挤在 composer 工具条里（当配置项读），
会话统计只在开发者工具调试表里可见，Token 累计用量在 UI 里根本没有入口。
本模块把三者收进输入框下方一条紧凑状态条，chip 负责摘要、hover 弹出明细。

## 不变量

- **单一数据源**：Token 与会话统计只来自 `v4/conversation/usage`
  （CLI `queryTaskUsage` 是唯一计算点）；上下文容量只来自会话投影 `snapshot.usage`。
  本模块不推算、不合并、不缓存第二份数字，也不在 UI 里二次求和。
- **null 不是 0**：不可用值（无 TTFT 样本、缓存命中率分母缺失、无完整 TPS 样本）
  在 `contract.ts` 里返回 `null`，调用方整行省略。显示成 0 会让用户误读缓存收益与速度。
- **零数据不渲染**：轮/步都是 0 时不画空壳；草稿态（`sessionId === null`）整条不渲染。
- **位置是悬浮块，不占布局**：状态条 `absolute` 挂在输入卡（`.chat-composer-input-surface`，
  自带 `relative`）的**右上角外侧**（`right-0 bottom-full`）。它必须脱离文档流——若参与布局，
  消息尾部会被顶上去，就变成「动作行一行、状态条另一行」的上下堆叠。
  它与消息悬停动作行同处一条水平带：动作行靠左、状态条靠右。
- **最小窗口宽度是这条规则的硬约束**：桌面 `MIN_DESKTOP_WINDOW_WIDTH`（900）由
  「动作行实测宽 + 间隙 + 状态条实测宽 + 侧栏最小宽 + 主列内边距」推导并真机复核。
  改 chip 数量或文案长度后必须重算，否则两块会重叠。
- **交互与既有容量面板一致**：desktop hover 展开、touch `pointerdown` 展开
  （Radix HoverCard 会吞 touch 的 click，必须前置到 pointerdown）。
- **锚点不变**：上下文容量触发器仍是 `TID_CHAT_CONTEXT_USAGE_TRIGGER`，
  工具条 `TID_V4_MODEL_CONFIG` 上的 `data-usage-*` 也保留，e2e 契约不因位置迁移而漂移。
- **chip 变体不能再套 Tooltip**（2026-11-13 实测缺陷）：`ChatContextUsage` 的 `chip`
  变体不包 `ControlHintTooltip` —— 外层 Radix Tooltip 会抢走 pointerenter，内层 HoverCard
  收不到打开意图，表现为悬停容量 chip 弹不出面板。同时 `ai-elements` 的 `ContextTrigger`
  已修正为「children 只替换按钮内图标」，否则传入 children 会丢掉 aria-label /
  data-testid / onPointerDown 并让 `asChild` 收到多个子节点。
- **窄宽度不裁切**：状态条容器 `flex-wrap`，摘要文本 `truncate`，
  保证三个 chip 都在可视区内。

## 依赖方向

`shared`（协议类型与 test-ids）、`services`（经 `useServices` 读
`raspberrycodeAgentService.getTaskTokenUsage`）、`ui`（复用 HoverCard、
`ChatContextUsage`、`formatCompactTokenNumber`、i18n）。

不写协议、不改会话状态、不发起除用量查询以外的任何请求。
