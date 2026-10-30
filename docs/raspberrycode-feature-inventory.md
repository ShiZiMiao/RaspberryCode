# RaspberryCode 功能清单（2026-10-30 源码核实版）

> 基于当前检出源码逐项核实（含 2026-10-26~30 的"全拆/保留"改造后状态）。
> 产品定位：AI 编程工作台（CodingAgent 工具），单机版——无登录、BYOK 手动 Key、自配端点。
> 形态：**桌面应用**（Electron）/ **浏览器界面**（Web）/ **终端 Agent**（CLI + TUI）/ **自托管服务端**（`zcode` server）。

---

## 一、AI Agent 核心能力

### 1.1 内置工具（工具注册表 `builtInTools`）

| 类别 | 工具 | 说明 |
| --- | --- | --- |
| 文件读写 | `Read` | 读文件，自动分发文本/图片/视频/PDF 子处理器，支持 Jupyter notebook 单元输出 |
| | `Write` | 写文件（原子写入，有 e2e 覆盖） |
| | `Edit` | search-replace 精确编辑（含匹配器校验） |
| 执行 | `Bash` | Shell 执行：后台任务、超时策略、图片输出、只读命令判定、git 安全策略、gh 限流防护 |
| | `js` | Node REPL 执行 JavaScript |
| 搜索 | `Glob` / `Grep` | 内置文件名/内容搜索（底层 ripgrep/ugrep/bfs 原生二进制） |
| | `ToolSearch` + `DeferredToolCall` | 工具定义检索与延迟调用（工具过多时按需加载） |
| Web | `WebFetch` | 抓取网页（带 egress guard、缓存、URL 校验） |
| | `WebSearch` | 联网搜索 |
| 任务 | `TodoRead` / `TodoWrite` | 会话内任务清单 |
| | `TaskOutput` / `TaskStop` | 后台 Bash 任务管理 |
| | `CronCreate/List/Update/Delete` | 定时自动化任务 CRUD |
| 多代理 | `Agent`（旧名 `Task` 兼容） | 派发子代理，`subagent_type` 选型 |
| | `SendMessage` / `RespondToCoordinator` / `submit_result` / `escalate` / `reply-to-channel` | 多代理协作消息 |
| 工作流 | `CreateWorkflow` / `AmendWorkflow` / `SaveWorkflow` / `ListSavedWorkflows` / `ListWorkflowRuns` / `GetWorkflowRun` / `ResumeWorkflowRun` / `ResolveWorkflowQuestion` / `FillWorkflowHole` / `EvalWorkflowSnippet` / `ListModels` | 动态工作流全簇 |
| 其他 | `Skill` | 加载技能（SKILL.md） |
| | `EnterPlanMode` / `ExitPlanMode` / `AskUserQuestion` / `ReadSessionContext` / `GoalRead` / `McpElicitation` | 计划模式、交互提问、会话上下文、目标读取、MCP 交互 |

### 1.2 子代理与多代理协作

- 内置子代理类型：`general-purpose`（默认）与 `Explore`（只读探索）。
- 自定义子代理：`.raspberrycode/agents/*.md`，frontmatter 定义模型 / 推理档位 / 可用工具。
- 子代理运行时：runner、上下文构建、工具裁剪（强制禁用列表）、持久记忆、完成通知、事件镜像。
- 动态工作流 = 多 actor 专家编排（expert run-loop + scheduler）。

### 1.3 模式与权限

- 会话模式 5 种：`build` / `plan` / `edit` / `yolo` / `guarded`（兼容 Claude Code 风格映射：acceptEdits→build、bypassPermissions→yolo）。
- 权限裁决三态 `allow | ask | deny`，会话级 "Always allow" 规则，项目/用户两级规则集持久化。
- 规则匹配支持通配符、WebFetch 域名规则（`domain:hostname`）、Bash 命令级 allow 与只读命令判定（git/gh 子命令细分）。
- Plan mode：计划获批后落盘（计划文件连续性），计划模式策略独立管控。
- 前端权限审批卡（permission-request-preview）。

### 1.4 会话与历史管理

- 消息历史、会话水合与恢复（workspaceSessionRestore）、topic 归档、会话邮箱。
- 上下文压缩：auto-compact（阈值 + 32K 预留）、microcompact、手动 compact。
- 会话级 fork / compact / rewind；对话回退与文件级撤销 `applyFileRewind`（不截断聊天历史）。
- **Git checkpoint**：createCheckpoint / diffCheckpoints / restoreBetweenCheckpoints / deleteCheckpoint——编辑回滚与 undo。

### 1.5 提示、命令、钩子、记忆

- 自定义斜杠命令：`.raspberrycode/commands/*.md` 与 `.agents/commands/*.md`（user/plugin 来源，global/project 作用域）；内置 `/init`（生成 AGENTS.md）、`/workflow`。
- 钩子（hooks）7 类事件：`SessionStart / UserPromptSubmit / PreToolUse / PermissionRequest / PostToolUse / PostToolUseFailure / Stop`；类型 `command | process`，支持 matcher/timeout/异步；workspace 钩子带信任评审流。
- 项目指令：`AGENTS.md` 优先 + 全局 `~/.raspberrycode/AGENTS.md`。
- 技能系统（Skills）：SKILL.md 规范、`~/.raspberrycode/skills`、内置技能、skill-creator。
- 输出风格（output-styles）；代理记忆（MEMORY.md 索引、dream 整理、recall 检索）。

### 1.6 Git / 编辑器 / 计算机使用

- Git 服务：仓库操作、提交信息生成、checkpoint。
- "在 VS Code / JetBrains 中打开"（编辑器探测 + 记住偏好）。
- CUA（计算机使用）插件 + Windows CUA 权限 broker。
- 无 LSP/语言诊断集成（源码反向确认）。

### 1.7 多模型 / 流式 / 多模态

- 协议层：Vercel AI SDK，接 Anthropic / OpenAI / OpenAI 兼容端点。
- 自定义模型（`custom:` 前缀）、模型目录与切换（`ListModels`）、连接测试。
- 流式输出；reasoning/thinking 展示与回放（思考强度档位、历史归一化）。
- 图像输入（Read 图片 → base64 image part）、Bash 图片输出、附件源/传输。

---

## 二、模型与供应商配置（BYOK）

- **API Key 管理**：设置页录入 / 显隐 / 删除 Key，跳转供应商 Key 管理页。
- **两类访问模式**：`api-key`、`metered-api-key`（计量 Key）；旧值 `zhipu-coding-plan-api-key` 读入自愈归一。
- **内置供应商模板 20 个**：zai-api / zai-standard-api / bigmodel(-standard)-api / moonshot-kimi / minimax / deepseek / qwen-alibaba-model-studio-cn/intl / xiaomi-mimo(-token-plan) / openai / anthropic / xai / openrouter / opencode 六档，各带内置模型清单。
- **自定义 Base URL / 端点**：供应商卡片可编辑 baseUrl（归一化保存、端点建议）；全局「服务端点」设置行（`zcodeEndpointOrigin`）。
- **供应商 CRUD + 连通性测试**；模型元数据编辑（名称/模态/推理等级/排序）。
- 会话内模型选择器：按供应商分组、徽标（Key 类型、视觉能力）、自定义模型值。

## 三、用量统计与额度

- 用量统计设置页：Token 总量、模型占比饼图、日趋势、热力图、工具调用统计、系统健康度。
- 会话额度横幅：额度/并发限制提示（仅对计量 Key 供应商查额度），纯信息展示。
- usage-stats / usage-quota 共享协议 + 用量服务（含桌面 E2E）。

## 四、远程工作区（SSH / WSL / Docker / Source）

- SSH/设备连接向导（多步流程、历史建议、密码输入、标签），单一 flow owner 契约。
- 远程 workspace 控制器：connect-device / open-project / open-conversation / reconnect 意图机，贯穿 `remoteSessionId` 与 `workspaceIdentity`。
- 远程部署后端三类：SSH / WSL / Docker；远端资产 CDN/安装/预检、Agent bundle 部署（开发态 mock-cdn + SFTP 上传）。
- Source Server 管理面板（连接记录、迁移报告、更新活动）。
- 远程配置同步：MCP / 插件 / 技能一键同步到远程。

## 五、自动化与工作流

- **定时任务（Automations，Beta）**：cron 调度 + 手动触发，模板目录、编辑视图、运行历史（每索引上限 20）。
- **常驻 cron 调度进程**（桌面 utility process）：事务认领、misfire 跳过、single-flight、失败退避。
- **动态工作流**（灰度：disabled / onDemand / alwaysOn，服务端下发 + 设置页开关）。
- **保存的工作流 / 工作流中枢**：运行产物 chips、workflow tab。

## 六、扩展生态

- **MCP**：stdio / http 服务器增删改查；多来源导入（mcp / zcodeagentmcp / claudeclimcp / geminiclimcp / codexclimcp / opencodemcp）；官方 MCP 信任/授权通道。
- **插件系统**：含 **UI Plugin**（经 MCP Apps 提供可交互页面，如 Excalidraw 画布协作）；插件管理（暂停/卸载/恢复内置）、来源管理（git/URL/本地目录）。
- **插件商店**：官方 Marketplace，公开/社区/个人分段、策展推荐、目录自动刷新。
- **技能（Skills）**：列表/发现/管理、远程同步、技能锁（skills-lock.json）。

## 七、自托管服务端（packages/server + zcode-server-cli）

- HTTP Host（Hono + WebSocket RPC，默认 3030）：静态 Web 托管（SPA fallback）、可选 token 鉴权（`ZCODE_SERVER_AUTH_TOKEN`）。
- 路由面：`/api/server-info`、`/api/rpc-host-capability`、`/ws/host`（desktop-continuous 实时链路）、`/ws`（web-remote-replayable 恢复链路）、`/api/bots/:provider` Bot 回调（微信/飞书/Lark/Telegram）。
- stdio Agent Host（设备中间层）。
- `zcode` server CLI：`serve / status / running-tasks / stop / restart / update / apply-update / uninstall / migrate / proxy-stdio / version`。

## 八、界面与设置

- 设置分区：通用 / 外观 / 模型供应商 / 记忆 / 子代理 / 插件 / MCP / 技能 / 命令 / 自动化（含工作流）/ 钩子 / 浏览器 / 远程设备 / 计算机使用 / 快捷键 / 工作区文件搜索（.zcodeignore）/ 用量。
- 主题三态（system / dark / light）、中英双语（zh-CN / en-US）。
- 终端：系统 Profile 继承、字体、集成终端 Shell 选择。
- 数据存储路径管理（含迁移复制）、主动建议开关、任务自动归档、快捷键自定义。
- 遥测默认关闭（构建期上报端点为空则不发）。

## 九、形态与打包

- 桌面打包：`pnpm bundle:desktop`（mac/win/linux × x64/arm64）。
- 命令行发行包：`pnpm build:zcode` → TUI / `zcode --web` 统一入口；`install.sh` + `latest.json` 安装体系（`~/.raspberrycode/runtime`）。
- Web 开发：`pnpm dev:web`（Vite 5173 + 后端 3030 代理）。
- 品牌数据目录 `~/.raspberrycode`；`ZCODE_DATA_BASE_DIR` 可重定向。

---

## 十、明确不包含的功能（改造中已拆除）

| 功能 | 状态 |
| --- | --- |
| 账号登录 / OAuth 登录 UI | 已移除，启动无登录路径 |
| Coding Plan 订阅购买 / 支付 | 已移除（订阅/购买/下单 API 已删） |
| Rewards 积分 | 已移除 |
| 营销触达 | 已移除 |
| 闲时任务 / 低峰排队执行 | 产品下线（automations 仅 schedule/manual 触发） |
| 加速卡 / highspeed | 已移除 |
| 分享链接 / 手机远控 | 已移除（Android 远控壳工程文件仍在，属残留） |
| 客户端自动更新 | 已移除（server-cli 自身的 update/apply-update 仍在） |
| 账号鉴权链（family 体系 / CLI 登录 / 账号 CAS） | 已移除 |
| 官方 OAuth client / Coding Plan 网关自动转发 | 已移除 |

> 有意保留的兼容面（勿清）：off-peak 磁盘兼容行、冻结 fixture schema、wire 诊断 reason 枚举、`zhipu-coding-plan-api-key` 旧值读兼容、IOAuthService（Source 远程在用）、官方插件市场机制（默认远端源已断、本地 seed 归属保留）。

---

*生成说明：功能条目均带源码证据（工具注册表 `apps/zcode-cli/packages/core/src/tool/handlers/index.ts`、模式枚举 `packages/shared/src/zcode-task-mode-schema.ts` 等），本文为归纳性清单，未逐条附路径；需要定位某一项实现时可按符号名检索。*
