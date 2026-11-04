# 供应商中立性（Provider Neutrality）

## 背景

RaspberryCode 是独立发行的 CodingAgent 工具，模型供应商生态必须完全中立：
不为任何品牌（含上游遗留的 Z.ai / BigModel / GLM）提供专属的产品行为、能力差异或排序特权。
上游实现中的智谱专属优化（thinking 签名兼容组、BigModel 错误码语义表、
智谱系供应商排序置顶与禁删、GLM 模型展示特判、品牌命名资产）需要按本 spec 中立化。

中立不等于抹掉事实差异：

- **数据事实**（如某服务的多个 provider 身份共享同一套 thinking 签名密钥）保留为中立声明数据。
- **按格式适配**（如解析 BigModel 方括号业务错误码、Anthropic 签名字段）属于 provider 适配，
  保留，但必须按 provider 声明/格式门控生效，不得让品牌逻辑渗入通用模型执行路径。
- **内置供应商接口信息是产品能力，不是品牌残留**（2026-11-03 口径确认）：内置的智谱、DeepSeek 等
  API 接口模板、模型 ID 目录、厂商名称与 logo，是为用户提供的接入便利功能，不在命名清理范围。
  其中立性判定标准是「平铺无特权」——无默认推荐、无排序置顶、无禁删特权、无能力差异，
  与 Anthropic/OpenAI 等模板同级对待。中立清理的对象是「产品自名与品牌特权」，
  不是「代码中出现厂商名」。

## 产品规则

1. **能力机制不得按品牌特判**：reasoning 回放、错误分类、视觉能力徽标等模型行为
   一律按 provider 声明的元数据/格式判定；代码中不得以品牌名单（zai/bigmodel/glm/智谱）
   作为能力分支条件。品牌多身份的事实关系以「签名兼容域」等中立数据声明表达。
2. **签名兼容域（reasoning signature scope）**：thinking 签名与服务密钥绑定，跨服务回放
   会被 provider 拒绝。同域 provider 身份之间可跨身份回放签名 reasoning；跨域一律剥离。
   域成员是数据声明，任何 provider（含自定义 provider）均可声明/注入自己的域，
   机制不得只对特定品牌开放。同 provider 身份（source === target）恒兼容。
3. **供应商排序中立**：provider 列表排序只按配置声明顺序（内置模板顺序 + 用户自定义顺序），
   不得内置品牌置顶。zai/bigmodel family 不得享受排序特权。
4. **删除规则中立**：内置供应商模板是否可删除按「内置/自定义」判定，
   不得按品牌给特定供应商禁删特权；同一规则适用于全部内置模板。
5. **模型展示按元数据**：能力徽标（视觉/推理/接入类型）按模型目录元数据与 access 配置生成，
   不得按具体 modelId 硬编码特判（如 GLM-5.3 视觉徽标例外）。
6. **命名与资产中立**：产品运行时路径、环境变量、自有协议字段、内置资源不得以品牌命名
   （glm/bigmodel/zai 等）；内置资源（图标等）不得外链品牌 CDN，须随包或自托管。
   已有命名按兼容策略迁移（保留旧名读取），新代码不再引入品牌命名。
   **例外——对外 wire 互操作契约**：与第三方服务/已发布插件之间的 wire 常量
   （如官方 Server MCP 的 `X-Bigmodel-*` 身份头、`com.raspberrycode/official-mcp-auth` meta 键）
   是互操作协议事实，改名即协议破坏，按数据事实保留并注明协议边界；它们的消费分支
   必须按协议/格式门控，不得渗入产品能力逻辑。
7. **保留兼容面**：历史数据读兼容（`zhipu-account`、`zhipu-coding-plan-api-key` 旧值、
   session migration 映射、MCP `http_headers` 旧字段）与按格式的 provider 适配保留不动。

## 状态所有者

- 签名兼容域数据与判定：`packages/shared/src/reasoning-signature-scope.ts`；
  历史归一化消费方 `apps/raspberrycode-cli/packages/adapters/src/model/reasoning-history-normalization.ts`。
- provider 排序：`packages/provider/src/resolver.ts`（`resolveProviderOrder`）。
- 供应商删除规则：`packages/ui/src/settings/model-provider-section/modelProviderActions.ts`。
- 模型能力徽标：`packages/ui/src/lib/modelVisionBadge.ts` 及模型目录元数据。
- 业务错误码语义表：`apps/raspberrycode-cli/packages/adapters/src/model/failure-provider-business-codes.ts`
  （按 provider 声明的错误码数据，BigModel 码表是数据来源之一，不是分支条件）。
- 远端 server 根解析：`packages/server/src/remote/deployShared.ts`（部署侧，SSH 远端）与
  `packages/raspberrycode-server-cli/src/runtime/paths.ts`（运行侧，远端本机）——两处必须实现同一条解析规则。
- daemon 服务名：`packages/raspberrycode-server-cli/src/platform/serviceManager.ts`。

## 命名迁移与旧名读兼容台账

规则 6 的落地终态（全新独立发行）。台账只记录两类事实：仍在生效的旧名读兼容
（读侧归一、写入只写新名），与已收敛为唯一命名的终态面。历史旧名原文保存在
`docs/archive/` 与中立性审计报告（历史文档豁免），本文件遵守「活跃文档零旧产品名」口径。

### 仍保留的旧名读兼容（只读不写）

| 面                   | 旧值（只读兼容）                                       | 新值（唯一写入）                  | 解析规则                                                                                             |
| -------------------- | ------------------------------------------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| agent provider 标识  | `glm`（历史 modelSelection/session 迁移值）            | `agent`                           | 读侧归一化映射（`model-selection.ts` 等），旧值只读                                                   |
| 主题内部代号         | `zai-light`、`zai-dark`（localStorage 旧值）           | `light`、`dark`、`system`         | `useTheme.ts` 的 `LEGACY_THEME_MAP` 读侧归一，写入只写新值；renderer 初始化（main.tsx）复用同一归一函数 |
| agent 二进制环境变量 | `GLM_BINARY_PATH`（用户残留 `.env` 的读兼容兜底）        | `RASPBERRYCODE_AGENT_BINARY_PATH` | 桌面端读兼容旧名（`desktopRuntimeEnv.ts`，且不下发给 host）；文档与写入只用新名                            |
| 历史数据旧值         | `zhipu-account`、`zhipu-coding-plan-api-key` 等旧配置值 | 现行 api-key / metered-api-key 体系 | 规则 7 的读兼容面（session migration 映射、MCP `http_headers` 旧字段同此）                            |

### 全新发行终态（历史布局兼容已移除）

| 面                   | 终态唯一命名                        | 说明                                                                                                                                                                            |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 远端 server 根       | `~/.raspberrycode/server`           | 部署侧（`deployShared.resolveRemoteServerBase`）、运行侧（`paths.ts getDefaultServerDataRoot`）、Shell 侧（`sourceServerProbe`）同一条规则：缺省固定新根（运行侧另有 `RASPBERRYCODE_DATA_BASE_DIR` 显式覆盖），不探测、不续用历史布局 |
| 远端 agent 资源目录  | `agents/` + 组件 id `agent`         | 组件元数据 `.asset-components/agent.json`；旧组件缓存的 legacy 清理逻辑已随历史布局兼容一并移除，旧工作树残留由 prepare 脚本重建覆盖                                             |
| daemon 服务名        | `com.raspberrycode.server(.<hash>)` | 注册/管理只使用该名；旧名服务不再识别                                                                                                                                            |
| 本地数据目录         | `~/.raspberrycode`                  | 唯一数据根；历史布局目录不再读取（含旧产品名目录，遵守「发版零旧产品名」口径）                                                                                                   |

## 验收场景

1. zai/bigmodel 各身份之间切换，签名 reasoning 回放保留（既有行为不回归）；
   跨服务（如 zai → deepseek）签名 reasoning 剥离，未签名 reasoning 保留。
2. 自定义 provider 声明同签名域后，跨身份切换同样保留签名 reasoning（机制对所有供应商开放）。
3. provider 列表顺序等于配置声明顺序，无品牌置顶；任意内置模板可按统一规则处理删除。
4. 全仓运行时源码（排除兼容映射、测试 fixture、历史迁移）无品牌能力分支；
   `pnpm typecheck`、`pnpm lint` 通过，受影响单测更新后通过。
5. 全新发行终态：部署侧/运行侧/Shell 侧三处 server 根解析结果一致（缺省 `~/.raspberrycode/server`）；
   历史布局不再探测或续用（历史机器按新布局重新部署），旧名读兼容仅限台账「仍保留的旧名读兼容」
   表所列四类且只读不写；`pnpm typecheck`、`pnpm lint` 与 `node scripts/audit-neutrality.mjs` 保持通过。
