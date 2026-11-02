# RaspberryCode 中立性最终校验报告（2026-11-02）

校验对象：`main`（a7aaf9b7，工作树干净，与 origin 同步）
校验标尺：`specs/provider-neutrality.md`（供应商中立七条规则）、`specs/no-login-startup.md`（无登录启动）、历史冻结兼容面清单
执行环境：Windows，Node 22.22.2（pnp m 下运行），`npx pnpm`

## 一、总体结论

**结构性中立达标，"完全中立"未达标。**

- 全部红线复核通过：无官方 OAuth client、无登录链、无 Coding Plan 网关自动转发、默认端点为占位域、遥测默认关闭、插件市场默认远端源已断。
- `specs/provider-neutrality.md` 规则 1–5、7 与例外条款符合；**规则 6（命名与资产中立）存在明确残留**，集中在三处：
  1. 内置文档技能（pdf/docx/xlsx，默认启用）给用户产出的文档盖 Z.ai 品牌元数据，并外链品牌字体 CDN；
  2. SSH 远程资产 CDN 的源码默认值仍指向品牌 CDN（`cdn.codegeex.cn` / `cdn-zcode.z.ai`）；
  3. 服务端/远程子系统运行时命名未迁移（`com.zhipu.zcode.server` 服务名、`~/.zcode/server`、`agents/glm/`）。
- 另有若干低危死文案与账号链路品牌门控残留（无登录后实际不可达）。

## 二、红线复核（全部通过）

| 红线 | 状态 | 证据 |
| --- | --- | --- |
| 无官方 OAuth client / 登录链 | ✅ | 全仓无 clientId/appSecret/authorize 配置；`WelcomeScreen`/`LoginPanel`/`welcomeScreenOpenReason`/`loginEntryRequest` 在 `packages/ui/src` 零命中；`user` 恒 null（no-login spec） |
| 无 Coding Plan 网关自动转发 | ✅ | 默认端点 `DEFAULT_ZCODE_ENDPOINT_ORIGIN = "https://your-server.example"`（RFC 2606 占位），见 `packages/shared/src/zcodeEndpoint.ts` |
| 遥测默认关闭 | ✅ | `ZCODE_TELEMETRY_REPORT_ENDPOINT` / `ZCODE_ARMS_RUM_ENDPOINT` 构建期不注入即为空串、不发送（`packages/shared/src/env.ts`、`telemetryCore.ts`） |
| 插件市场默认远端源断开 | ✅ | 官方市场 `source: ""`（vendor CDN 分发已断），本地 seed 归属保留；见 `packages/shared/src/plugin-marketplaces.ts` |
| 品牌身份唯一事实源 | ✅ | `desktop-product-identity.mjs`：RaspberryCode / `dev.raspberrycode.app` / `raspberrycode`；数据目录 `~/.raspberrycode`；electron-builder appId、productName、homepage（自有仓库）均取自该事实源 |
| 构建健康 | ✅ | `pnpm typecheck` 通过（0 error）；`pnpm lint` 0 error、259 warn（基线 258，新增 1 条测试文件 `addAccountProviderAccess` 未使用告警，非运行时代码） |

## 三、逐条规则核验

1. **能力机制无品牌特判 —— 基本达标，3 处残留（均在账号链路）**
   运行时源码按品牌字面量分支的仅剩：
   - `packages/services/src/node.ts:2408`（`createTelemetryAuthorizationLoader`）：`provider !== "zai" && provider !== "bigmodel"` 门控 JWT 上报——无登录、遥测关闭后不可达；
   - `packages/shared/src/project-access-token-client.ts:315`：`input.family === "zai"` 决定 Authorization 头格式——Team Plan/项目 Key 管理客户端，账号链路已拆、无 token 来源；
   - `packages/ui/src/hooks/useCredentials.ts:38,60`：bigmodel 旧 `auth_token` 兜底读取——注释明示为升级历史读兼容，属规则 7 范畴。
   其余 `zhipu-account` / `zhipu-coding-plan-api-key` 命中均为冻结读兼容（禁写+读兼容），错误码表（`failure-provider-business-codes.ts` 等）为按 provider 声明的数据表而非分支。
2. **签名兼容域** —— ✅ 机制在 `packages/shared/src/reasoning-signature-scope.ts`，域成员为数据声明。
3. **排序中立** —— ✅ `resolver.ts:355` `resolveProviderOrder`：内置声明顺序+自定义顺序，注释明示不按 group 品牌置顶。
4. **删除规则中立** —— ✅ 按「内置/自定义」判定（`modelProviderActions.ts`），抽查无品牌特判。
5. **模型徽标按元数据** —— ✅ `modelVisionBadge.ts` 按 access 配置/目录元数据生成（含 legacy access 值，属读兼容）。
6. **命名与资产中立 —— 未完全达标**（详见第四节）。
7. **保留兼容面** —— ✅ 与冻结清单一致：`zhipu-account`、`zhipu-coding-plan-api-key` 旧值、session migration 映射（0020/0021/0022）、MCP `http_headers` 旧字段、wire 诊断字面量均原样保留。
   例外条款执行正确：`official-mcp-auth.ts` 的 `X-Bigmodel-*` 头与 `com.zcode/official-mcp-auth` meta 键按 wire 互操作契约保留，文件内注明协议边界；无登录 JWT 时该链路无身份源、自然降级。

## 四、规则 6 残留清单（按处置优先级）

### A 高：用户可见品牌输出 / 运行时网络耦合

**A1. 内置文档技能的品牌元数据与品牌 CDN**（默认启用插件：`pdf`、`documents`、`spreadsheets`）
- 产出文档盖品牌戳：
  - `apps/zcode-cli/packages/pdf-plugin/skills/pdf/scripts/pdf.py`：`/Author: Z.ai`、`/Creator: Z.ai`、`/Producer: http://z.ai`；
  - `apps/zcode-cli/packages/documents-plugin/skills/docx/scripts/document.py`：tracked changes/comments 默认 `author: "Z.AI"`；
  - 对应 SKILL.md 与 briefs 均要求「Author/Creator = Z.ai」；xlsx 技能同类（`spreadsheets-plugin`）。
- 字体安装外链品牌 CDN：`https://z-cdn.chatglm.cn/office-skill/fonts`（三个技能的 `env_setup/setup_windows.ps1`、`setup_mac_linux.sh`、`setup.md`）——直接违反规则 6「内置资源不得外链品牌 CDN，须随包或自托管」。
- 附带：`pdf-plugin/agents/visual-judge.md` 默认模型指向 `account:bigmodel-individual-coding-plan/GLM-5.3-Flash`（账号套餐型 provider，单机无登录下不可用）；`pdf-plugin/skills/pdf/LICENSE.txt`「Copyright (c) 2026 Z.ai」为上游技能法律声明，应保留但不能作为产出元数据默认值。

**A2. 远程资产 CDN 源码默认值指向品牌域名**
- `packages/desktop/src/main/remoteCdn.ts:5-9`：`domestic: https://cdn.codegeex.cn/zcode/electron/releases`、`overseas: https://cdn-zcode.z.ai/zcode/electron/releases`（两者均为品牌 CDN）；
- `scripts/cdn-preload.sh:3`：默认 `CDN_DOMAIN=cdn-zcode.z.ai`。
- 构建期可经 `__ZCODE_REMOTE_CDN_RELEASE_ROOTS__` / `CDN_DOMAIN` 注入覆盖，但未注入时回退即请求品牌 CDN。默认值应改为占位或强制要求显式配置。

### B 中：运行时品牌命名（迁移过半，冻结面待迁移）

- **B1** `packages/zcode-server-cli/src/platform/serviceManager.ts`：系统服务名 `com.zhipu.zcode.server(.<hash>)`——安装在用户机器上的服务名，品牌可见。建议按「新名+旧名读兼容」迁移。
- **B2** 远程部署布局 `~/.zcode/server`（`deployShared.ts` `REMOTE_BASE`、`zcode-server-cli/src/runtime/paths.ts`）与 `agents/glm/zcode.cjs`（`zcodeAgentBundleWrapper.ts`，remoteDeploy 测试钉住现行布局）。provider 标识已完成 glm→agent 迁移（`model-selection.ts:64`、`taskIndexRepo.ts:40` 保留旧名读兼容映射，符合规则 6 迁移策略），但远程磁盘布局仍旧名——涉及已部署机队与旧版 App 兼容（`deploy.ts:381`），属事实上的冻结 wire/磁盘面，建议列入后续迁移计划。
- **B3** 手动兜底链路命名：`scripts/download-glm.mjs`、desktop `prepare:agent-binary` 及 `bundled-agents/<platform>/glm/` 布局——docs 已明确「仅保留为手动兼容兜底，不进入默认 Dev、桌面打包或 remote 资产准备链路」，默认打包只用 `agent/` 目录。属兜底工具，风险低。

### C 低：死文案、命名气味、开发夹具

- **C1** i18n 死 key（无任何组件引用，仅存于 `zh-CN.ts`/`en-US.ts`）：
  - `settings.modelProvider.presetDescription`：「内置 Z.ai 与 BigModel 供应商，支持通过 OAuth 辅助完成配置。」——既有品牌文案又与无登录事实矛盾；
  - `settings.usage.entitlementNotConfigured`、`settings.usage.codingPlanNotConfiguredDescription`：「…Z.ai / BigModel 编程套餐…」。
- **C2** UI 占位示例品牌化：`settings.modelProvider.anthropicEndpointPlaceholder` = 「如：https://open.bigmodel.cn/api/anthropic」。
- **C3** `login.oauth.regionTag.zai/.bigmodel` i18n key 被 Bots UI 复用作 Lark/Feishu 区域标签（`botsUi.ts:69`）——key 名沿用旧登录命名，显示值中立。
- **C4** 账号链路品牌门控死代码（见规则 1 三处），可随账号链路精简一并清。
- **C5** 开发脚本/夹具：`scripts/multimodal-tool-result-p0.mjs`、`apps/zcode-cli/test-model.mjs`、`apps/zcode-cli/packages/adapters/test-model.mjs`、`scripts/dev-official-mcp-server.mjs` 默认端点指向 `open.bigmodel.cn`（仅开发用）；`packages/desktop/wdio.conf.ts` E2E 夹具含官方 OAuth URL/`appId=zcode` 字面量（测试夹具，按验收口径豁免）。
- **C6** 历史/法务/文档（保留）：README 出处说明（Apache-2.0 二次开发署名，必须保留）、`THIRD-PARTY-NOTICES` 与技能 LICENSE、session-store migrations（0020–0022 冻结迁移史）、`scripts/architecture/upstream-snapshot.json`（上游基线数据）、`apps/zcode-cli/docs` 设计文档示例 URL、`restore-legacy-sessions` 插件（ACP 时代会话恢复，功能性保留）。

## 五、第三方 agent 残留审计（补充维度）

`node scripts/audit-zcode-agent-remnants.mjs`（claude/codex/gemini/opencode/acp 关键词棘轮）：
- 69 文件 / 230 命中；分类：compat-type 25 文件、product-decision 27 文件、legacy-data-parser 2、runtime-blocker 1（`wdio.conf.ts` E2E 夹具）、unclassified 14 文件/60 命中。
- unclassified 主体：Claude 历史会话导入（claude-native import，功能性保留）、`.claude-plugin` 市场格式兼容（插件生态 wire 格式）、`restore-legacy-sessions` 插件、`upstream-snapshot.json`。
- 未设 `--max-*` 棘轮阈值，exit 0；如需固化可加 `--max-unclassified` / `--max-runtime-blocker` 进 CI。

## 六、建议处置

1. **必修（达成「完全中立」的最小集）**：A1 技能产出元数据默认值改中性（如 RaspberryCode 或留空）、字体改为随包/自托管；A2 远程 CDN 默认值改占位或改为必须显式注入。
2. **建议修**：B1 服务名迁移；C1 死 key 清除；C2 占位示例改中性域名。
3. **保持不动**：wire 例外（official-mcp-auth）、冻结兼容面、法律声明、迁移史、测试夹具、B2 远程布局（待机队迁移窗口）。
