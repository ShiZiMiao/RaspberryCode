# prompt-enhance

输入框草稿优化：把当前草稿交给当前选中的模型改写成更清晰的提示词，再回填输入框。
产品规则见 `docs/prompt-enhance.md`。

## 存在的意图

用户写草稿时常缺上下文和产出约定，导致 Agent 反复追问。这里提供**一次点击**的改写，
不新增任何设置项、不改变发送链路、不介入会话内容——只作用于尚未提交的草稿。

## 不变量

- **草稿的唯一所有者是 composer。** 本模块不 `setText`、不持久化草稿、不缓存副本。
  `readDraft` 由调用方传入，结果作为返回值交出，写不写回由调用方决定。
- **纯函数与 IO 分离。** `contract.ts` 只有提示词构建、输出清洗、草稿指纹；
  请求编排在 `usePromptEnhance`。清洗规则必须可单测，不能埋进 hook。
- **一次只有一个请求。** 进行中再次调用是取消，不是并发。`requestId` 单调递增，
  迟到的响应（被取消 / 被取代 / 组件已卸载）一律丢弃，不落到输入框。
- **请求绑定草稿作用域。** composer 实例**跨会话复用**（`key="conversation-composer"`
  固定），会话切换只改 props 不重挂载。发起时记下 `draftScopeId`，回来时比对；
  作用域变了就丢弃——否则在会话 A 发起、切到 B 后回来的结果会写进 B 的草稿。
- **不覆盖用户的新输入。** 回写前用 `fingerprintDraft` 比对当前草稿；
  与发起时不一致就不写回。宁可丢一次优化结果，也不能吞掉用户刚打的字。
- **写回要保住 mention。** 用 `resolveDraftWriteMode` 决定走 `setText` 还是
  `setTextWithPluginMentions`。前者会用纯文本节点重建编辑器，把 plugin mention chip
  打回普通文字；判据必须与 composer 回填草稿时一致。
- **指令与草稿不同条消息。** 指令走 `system`、草稿走 `user`，靠协议的角色边界区分，
  不靠文本标记（标记可被草稿本身闭合，是"用提示词对抗提示词"）。
- **输出必须清洗。** 围栏、寒暄前缀、成对引号都要剥掉；清洗后为空或与原文相同都不写回。
- **清洗必须带原文。** 清洗只看形式，分不清「模型加的包装」和「用户正文本来长这样」。
  原文自带哪种包装就跳过那条规则，否则模型原样返回时会静默改坏用户草稿。
- **不能夸大战果。** 只动了标点/空白时用 `minor` 档，UI 提示「已做小幅调整」
  而不是「已优化」。

## 与其它模块的交集

- **服务通道**：`raspberrycodeAgentService.generateWorkspaceText`
  （协议 `workspace/generateText`），经 `@/hooks/useServices` 访问，
  与 Git 提交消息生成同一条链路。`querySource = "prompt_enhance"` 用于轨迹归类。
- **模型选择**：由 composer 的 `draftConfig` 提供，本模块不读取、不推断、不回落默认模型。
- **输入框写入**：调用方经 `LexicalChatInputHandle.setText` 写回，
  与其它草稿写入路径同级，不绕过编辑器。
