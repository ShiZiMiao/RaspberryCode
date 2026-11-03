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

---

## 处置结果（2026-11-02 当日修复，用户指令「三档残留全部修复」）

### A 档（已修复）
- **A1** pdf/docx/xlsx/pptx 四技能：产出元数据默认值 `Z.ai/Z.AI` → `RaspberryCode`（pdf.py 的 `meta.brand` 命令同步改名 `meta.stamp`，briefs/references 示例去品牌）；字体 CDN 改为**必须显式配置** `OFFICE_SKILL_FONT_CDN_BASE`（无品牌默认值，未配置则跳过下载用系统字体）；visual-judge 去掉 `account:bigmodel-individual-coding-plan/GLM-5.3-Flash` 模型钉死（继承会话模型）。LICENSE.txt 版权声明保留（法务）。
- **A2** `remoteCdn.ts` 删除 cdn.codegeex.cn / cdn-zcode.z.ai 默认值与「语言+时区」分流机器：下载根只来自构建注入（`__ZCODE_REMOTE_CDN_RELEASE_ROOTS__`）或运行期 `ZCODE_REMOTE_ASSET_CDN_BASE_URL`，皆缺返回空列表由装配层报错；`cdn-preload.sh` 的 CDN_DOMAIN 无默认值、缺失即报错。

### B 档（已修复）
- **B1** 服务名迁移：`com.raspberrycode.server(.<hash>)` 为唯一写入名（`DAEMON_SERVICE_NAME`），`com.zhipu.zcode.server` 降为 `LEGACY_DAEMON_SERVICE_NAME` 只读兼容——注册前 `unregisterStaleServiceRegistrations` 按内容归属收口同 root 旧名服务（复用 root-scoped alias 扫描），注销/迁移识别新旧两名。新增 `serviceNameMigration.test.ts` 回归 3 例。
- **B2** 远程布局迁移（新名 + 旧名读兼容，规则见迁移台账）：
  - 解析规则统一为「旧根安装标记（zcode-server.cjs / bin/zcode / current.json 任一）存在 → 续用 `~/.zcode/server`，否则新根 `~/.raspberrycode/server`」；部署侧 `deployShared.resolveRemoteServerBase`（WeakMap 记忆）、运行侧 `paths.ts getDefaultServerDataRoot`、shell 侧 `sourceServerProbe` 三处同规则。
  - wrapper（持久文件）写入该机器实际根；旧布局机器的旧 wrapper 持续可用。
  - 修复 resolver 读兼容缺口：`providerRuntimeResolver` 的 agent/bundle 候选链补 `~/.zcode/server/agents/` 旧根候选（此前旧布局机器已部署 agent 解析不到）。
  - `agents/glm/` → `agents/agent/`、组件 id/cache 段 `glm` → `agent`（生产侧随 C1b 已迁，本次补齐 remoteDeploy 等测试断言——顺带修复该文件 51 个存量红测试，现 75/75 绿）。
- **B3** 兜底链路命名：`scripts/download-glm.mjs/.sh` → `download-agent-binary.mjs/.sh`（package.json、docs、audit 规则同步）；删除 bundled-agents 下陈旧 `glm/` 构建残留目录；zcode-agent-runtime/providerRuntimeResolver 注释去旧名。

### C 档（已修复）
- C1 三个 i18n 死 key 的品牌文案改中性措辞；C2 占位示例改 `https://your-server.example`；C3 `login.oauth.regionTag.*` → `bots.regionTag.*`（key 中性化，值不变）；C4 `node.ts` 遥测 JWT 门控改凭据形状判定（去品牌名单，测试改用中性 provider 名验证）、`project-access-token-client` 的 family 分支改「鉴权头格式」声明数据（wire 例外注释）、`useCredentials` 历史 `auth_token` 读兼容泛化到任意 provider；C5 三个开发脚本端点/模型默认值改必填（缺失即报错）。

### 保持不动（按 spec 与既有契约）
- wire 例外（`X-Bigmodel-*` 头、`com.zcode/official-mcp-auth`）、冻结兼容面（`zhipu-account` 读兼容、session 迁移史、wire 诊断字面量、技能 ID `glm:` 前缀、`native:glm`、开发态相邻目录候选等持久化/数据契约）、法务声明（LICENSE.txt / third-party）、测试夹具建模 legacy 的数据（sourceServerContracts 等）、`legacyZCodeConfigProviderReader` 的厂商事实端点常量（旧配置读兼容）。

### 验证
- `pnpm typecheck` 0 error；`pnpm lint` 0 error（259 warn，同基线）；改动文件 oxfmt 全净；`architecture:check --changed` 0 violation。
- 测试：remoteDeploy 75/75（基线 51 红→全绿）；packages/server 295 过/6 失败、zcode-server-cli 204 过/3 失败——9 个失败全部 stash 对拍确认为 HEAD 存量环境噪声（Windows Git Bash 真 bash 夹具 EOF、socket/spawn 时序），与本次无关；desktop/services/shared 受影响单测全绿。
- E2E 未执行（AGENTS.md 口径留提测前）；51 个 E2E/pending 夹具已机械同步新根命名。

---

## 复扫补充（2026-11-02 晚，用户追问「确定完全中立了吗」后的第二轮独立验证）

第一轮「终态复扫」口径偏窄（只扫域名/服务名/部分目录），第二轮扩大到用户可见字符串字面量、死代码可达性、行为分支逐一定性，**又发现 3 处真残留并当场修复**：

1. **CLI `/help` 幽灵条目（用户可见品牌文案）**：`packages/shared/src/zcode-slash-command-help.ts` 仍含 `/login`（"Z.ai and BigModel browser login…"、usage 含 `zai-coding-plan|bigmodel-coding-plan` 等）与 `/logout`（"Deletes Z.ai OAuth credentials…"）两条帮助条目，但对应命令注册已随登录链拆除（slash-command-surface 仅暴露 goal/workflow/compact/init）。已删除两条死条目（顺带释放 login/logout 保留名）。
2. **死组件**：`packages/ui/src/lib/oauthProviderIcon.tsx`（品牌 logo 映射）零消费方，已删除。`logo-zai.svg` 被 App.tsx 活用（多厂商 logo 资产库），保留。
3. **品牌行为分支**：`oauthService.ts` 的 `provider === BIGMODEL/ZAI` 特判改为 wire 差异声明数据（`OAUTH_AUTHORIZE_REDIRECT_PARAM_BY_PROVIDER` 回调参数名映射、`OAUTH_PROVIDER_SIBLING` 账号互斥映射），`oauth.ts` 注释同步中性化。

第二轮终态扫描结论（按类分列，非"零命中"）：
- **真残留 = 0**（用户可见文案、能力分支、端点默认值均已清）。
- **有意保留**：① 冻结数据契约——provider ID 值（`zai`/`bigmodel`/`account:*`/`zai-family` 等）、`zhipu-account` schema enum、GLM 模型 ID 目录（`official-glm-model-id.ts`，模型身份数据）、legacy 迁移代码与日志（"BigModel token migration" 等历史事实）；② wire 互操作事实——`X-Bigmodel-*` 头、poll 响应按 provider 的字段解析（`ready.zai.access_token` vs `ready.bigmodel.*`）、metered-key 额度端点 `bigmodel.cn`、旧配置读兼容端点 `open.bigmodel.cn`（厂商事实端点，用户自带厂商凭据/存量配置时必须打厂商地址）；③ 法务声明（LICENSE/third-party）。
- **灰色地带（如实声明）**：OAuth 冻结兼容模块（登录已拆、仅供存量登录态读兼容与 Source）内仍存在以 provider ID 为键的行为差异分支（zcodejwttoken 门槛、profile 迁移清理），属冻结兼容面语义，未强行去分支；`appTelemetry.ts` 的遥测标签值 `"z.ai"`/`"bigmodel"` 为数据值（遥测默认关闭）。

验证：`pnpm typecheck` 0 错误；OAuth/UI 受影响测试 31/31 绿；`cli.unit.test.ts` 的 2 个 slash-help 用例（node:test）全过；`protocol-slash-commands.test.ts` 4 失败与 workspaceHook 6 失败均 stash 对拍确认 HEAD 存量（含 `.zcode\AGENTS.md` 陈旧断言——测试期望陷阱①）。

---

## zcode 全量清除（2026-11-02 深夜，用户拍板：全新独立发行、发版零 zcode）

前提澄清（用户确认）：该工具**未曾对外发布**，改造完成后才发布，届时为全新应用、与 zcode 完全独立。此前所有「冻结兼容面」的保留理由（保护存量）随之失效。

### 执行内容
1. **删除（不再需要兼容）**：B1 旧服务名 `com.zhipu.zcode.server` 兼容链；B2 旧根 `~/.zcode/server` 探测（deployShared/paths.ts/sourceServerProbe/providerRuntimeResolver 四处）；`restore-legacy-sessions` 插件（导入 zcode 时代会话的死功能，含 official-plugin-definitions、SEA/agent 资产清单、builtinSkillI18n、packaging/build-sea/plugins 测试接线）；`migrateLegacyCommonMcp` 端到端（shared IPC 契约 + desktop main/preload/renderer + ui mcpStore/mcpStoreMigration，从 `ai.z.zcode` 导入 MCP 的死功能）。
2. **批量改名**（产物+源码+测试+目录名+文档）：`@zcode/*`→`@raspberrycode/*`、`ZCODE_*`→`RASPBERRYCODE_*`、`ZCode`→`RaspberryCode`、`zcode`→`raspberrycode`；含包名、环境变量、产物文件名（`zcode-server.cjs`→`raspberrycode-server.cjs`、`zcode.cjs`/`zcode.mjs`/`zcode.cmd`→`raspberrycode.*`、CLI 二进制 `zcode`→`raspberrycode`）、IPC/协议（`zcode://`→`raspberrycode://`、`window.zcode`→`window.raspberrycode`、`com.zcode/*`→`com.raspberrycode/*`）、目录名（`apps/zcode-cli`→`apps/raspberrycode-cli`、`packages/zcode-server-cli`→`packages/raspberrycode-server-cli`、`.zcode-plugin`→`.raspberrycode-plugin`）等约 6000+ 文件内容、5000+ 路径。
3. **漏网修补**：`schema.baseline.sql` 表名（`.sql` 不在替换扩展清单，与迁移代码 `raspberrycode_database_identity` 失配）；third-party 法务工具脚本（被法务排除规则误跳，含依赖扫描 `@zcode/` 过滤器）；根点文件（`.env*`/`.gitignore`/`.gitattributes`/`.husky/pre-push`/`.prettierignore`——终扫脚本 `lstrip('./')` bug 首轮漏掉）；Dockerfile/`.jsonl`/`.map`。

### 验证
- `pnpm typecheck` 0 错误；`pnpm lint` 0 错误（259 warn 同基线）；`architecture:check --changed` 0 新违规（1892 条改名引发的 unmanaged-new-file 经 `baseline:update` 登记为存量）。
- 测试：受影响套件（shared/server/server-cli/ui/desktop/CLI bootstrap）全绿，除**已定性环境噪声**：remoteAssetInstaller EOF×6、ipc/remoteAssetRelease/serviceManager×3（今日 stash 对拍过的存量）、plugins.test Windows chmod/路径分隔符×3、build-sea tar 解压×1。
- **services 全套 70 失败经干净 worktree 对拍 HEAD 定性为存量**（HEAD 同批文件 41 失败、同类同报错，本树还少 18）——family 体系退役/glm→agent 迁移的过时期望，属「services 迁移期望过时」既有噪声类。

### 法务例外（无法清除，Apache-2.0 强制）
发行产物中唯一保留的 zcode 字样是**上游版权声明**（LICENSE / NOTICE.md / THIRD-PARTY-NOTICES.md 及其 dist 副本）：Apache-2.0 要求保留原版权声明，删除即违法。另有两处 dev 元数据保留原文：`scripts/architecture/upstream-snapshot.json`（upstream 镜像登记，机制已随独立发行作废）与本文档（历史记录）。

### 遗留事项
1. architecture 工具基线仍是 `merge-base upstream origin/main`，与「全新独立」语义冲突（本次靠 baseline 登记压平）；建议后续把基线切 HEAD/本地。
2. 首次发版前：E2E 全量 + 打包安装实测（产物名已全部变化：raspberrycode.cmd、raspberrycode-server.cjs、服务名、named pipe 等）。
3. upstream-snapshot / audit 等 fork 同步机制建议择期拆除。

---

## 最终检查（2026-11-03 凌晨，用户指令：完成遗留后地毯式终检，不放过任何功能和文件）

### 遗留三件的处置
1. **architecture 基线切本地（已完成）**：`scripts/architecture/git-base.mjs` 摘除 `@{upstream}`（zai-org/ZCode）候选，基线落本地默认分支/HEAD。`architecture:check --changed` 绿。
2. **fork 同步机制拆除（已完成）**：删除 `upstream-admission.mjs`、`upstream-snapshot.mjs`、`upstream-snapshot.json`、`architecture-upstream-admission.test.mjs`；`policy.mjs`/`architecture-check.mjs`/`run-cli-lint.mjs`/`architecture-policy.yaml`/`package.json` 的接线全部摘除（lint 的「pristine upstream 免计」机制随之取消，全部文件按现行规则计数）。架构治理测试 23/23 绿。
3. **打包实测（已完成）**：`build:raspberrycode` 全链走通（环境注意：脚本内裸 `pnpm` 需 PATH shim；Windows tar 需 git-bash tar 补完归档步骤）。产物命名核对通过：`bin/raspberrycode.mjs`、`agent/raspberrycode.cjs`、`server/remote/raspberrycode-server.cjs`、`agent/provider/raspberrycode-builtin.json`、wrapper/部署模块均为 raspberrycode 命名；发行归档 `raspberrycode-0.1.0.tar.gz`（53MB）产出。E2E 全量仍按 AGENTS.md 口径留提测前。

### 地毯式终检（全仓全功能）发现并修复的杂散项
1. **`.env.*` 三件套（最重要）**：`.env.example`/`.env.development`/`.env.production` 里残留改名机器翻出的假域名（`raspberrycode.z.ai`、`cdn-raspberrycode.z.ai`——实为 z.ai 域名）作为默认端点，以及**硬编码的厂商 OAuth client id**（`ZAI_TEST/PRODUCTION_OAUTH_CLIENT_ID=client_P8X5...`，四个 `ZAI_*` 变量经查为已删登录链的死配置，零消费方）。已全部清除：死变量删除，端点示例统一 `https://your-server.example` 占位，`BIGMODEL_API_BASE_URL`（按量计费 Key 的厂商 wire 端点）留空注释。
2. **半截改名的 i18n bug（真 bug）**：`botsUi.getBotProviderRegionTagLabelId` 仍返回旧键 `login.oauth.regionTag.*`（zh 侧早已改名 `bots.regionTag.*`、en 侧没改）——查键落空。已统一为 `bots.regionTag.global/cn`，删除 en 侧旧键。
3. **i18n 键名残留**：`mode.label.glm.*`/`mode.description.glm.*`（12 键×2 语言 + display-help 引用 + 1 测试）→ `.agent.`；`settings.skills.agent.glm` → `.settings.skills.agent.raspberrycode`。
4. **杂散**：`desktopHostProcess.ts` 的 `BIGMODEL_OAUTH_APP_SECRET` 死日志（secret 本体已无消费方）；遥测标签 `"z.ai"`→`"zai"`（对齐 provider ID）；2 个测试夹具的品牌句 `"Sign-in to BigModel expired."`→`"Sign-in expired."`；`remoteCdn.ts`/`validationAppSettings.ts` 注释里的历史域名字样；4 条 JSDoc 品牌注释（usage-stats/project-access-token-response）中性化。

### 终态分类账（按中立性标准：无偏袒、无耦合、无自名；厂商名仅作第三方标识/协议事实平铺存在）
| 类别 | 内容 | 终态 |
|---|---|---|
| 产品自名 zcode | 全仓仅 4 文件：`NOTICE.md`/`THIRD-PARTY-NOTICES.md`/`office-runtime/LICENSE`（Apache-2.0 上游版权声明，法定义务不可删）+ 审计历史文档 | ✅ 法务例外 |
| 用户可见文案 | i18n 值、/help 表、TUI 文案、错误消息 | ✅ 品牌清零 |
| 默认端点/默认厂商 | env 示例全占位；模板目录 20+ 厂商平铺（zai/bigmodel 仅占 4 席：moonshot/minimax/deepseek/qwen/mimo/openai/anthropic/xai/openrouter…）；无 default/recommended 标记 | ✅ 无偏袒 |
| 品牌能力分支 | 仅剩 OAuth 冻结兼容模块内的 provider wire 适配（回调参数映射、响应字段解析）与错误码表——按 provider 声明的数据，非特权分支 | ✅ 数据化 |
| 第三方标识数据 | provider ID（`zai`/`bigmodel`/`account:*`）、模板 ID（`zai-api` 等）、模型 ID（`GLM-*`）、供应商 logo 资产库（anthropic/openai/deepseek/zai 平铺）、迁移史（SQL/legacy schema） | ✅ 平铺对待（与 Anthropic/OpenAI 同级） |
| wire 事实 | `X-Bigmodel-*`/`Bigmodel-Organization` 等厂商 API 头、按量计费额度端点、`apiFormat: anthropic/openai` 协议名 | ✅ 协议事实 |

### 验证
typecheck 0；架构治理测试 23/23；UI/shared/adapters 受影响测试全绿（v4ComposerModeControls/quickPick/workflowNotification 32、dwf-journal 155、telemetryPrivacy+providerLogoAssets 22）；打包冒烟全通（含发行归档产出）。
