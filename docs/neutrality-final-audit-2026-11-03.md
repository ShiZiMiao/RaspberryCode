# RaspberryCode 中立性最终完整校验报告（2026-11-03）

校验对象：工作树现状（`main` @ 23a99cdf 之上，含 10651 条未提交改动——zcode→raspberrycode 全量清除批次正在工作树中）
校验标尺：`specs/provider-neutrality.md` 七条规则、`specs/no-login-startup.md`、2026-11-02 终检报告的终态分类账、用户拍板口径「全新独立发行、发版零 zcode」
执行环境：Windows，Node 22.22.2，`npx pnpm`
口径说明：本次为独立复核，不沿用 11-02 结论；全仓扫描统一 `zcode|z code|z-code`（-i 全变体，含空格/连字符/全大写），并逐一区分「真残留 / 有意保留 / 法务例外 / 历史文档豁免 / 构建产物」。

## 一、总体结论

**功能与运行时层完全中立达标；发现 3 处漏网真残留当场修复、2 处法务口径问题（1 处已修、1 处待拍板）、一批构建产物需发版前重建。**

- 五条红线全部复核通过（无官方 OAuth client、无登录链、无网关自动转发、遥测默认关闭、市场断源）。
- 本次新发现并修复：用户可见文案 1 处（主进程退出确认框 "Quit Z Code?"）、模型可见 tool prompt 1 处（"z-code compatibility fallback"）、**法务署名被机械替换误伤 1 处**（README 出处链接被改成不存在的仓库地址，违反 Apache-2.0 归属，已还原）、法务清单来源路径过时 3 行、源码注释 4 处、脚本/文档示例 3 处、测试夹具 62+ 文件批量中性化（z-code/z code/Z Code@electron/假域名 raspberrycode.z.ai/codegeex）。
- **待用户拍板 1 项**：`NOTICE.md` 整篇仍是上游 ZCode 产品功能披露（描述已拆除的登录、网关转发、自动更新、闲时任务、分享、Rewards 等行为），见第五节。
- 发版前必做：全量重建构建产物（out/、dist/、bundled-agents、.turbo 缓存），见第六节。

## 二、红线复核（全部通过，独立验证）

| 红线 | 状态 | 本次证据 |
| --- | --- | --- |
| 无官方 OAuth client / 登录链 | ✅ | `client_P8X5`/`ZAI_*_OAUTH_*`/`OAUTH_APP_SECRET` 全仓仅存 docs 历史文档与 1 个安全测试负例（`remoteConnect.test.ts` 断言 secret 不跨 SSH，夹具值 `must-not-cross-ssh`）；`WelcomeScreen`/`LoginPanel`/`loginEntryRequest` 在 `packages/ui/src` 零命中 |
| 无 Coding Plan 网关自动转发 | ✅ | `packages/shared/src/raspberrycodeEndpoint.ts` 默认 `https://your-server.example`（RFC 2606 占位），`your-server.example` 全仓 12 文件一致性命中 |
| 遥测默认关闭 | ✅ | `packages/shared/src/env.ts`：`__RASPBERRYCODE_TELEMETRY_REPORT_ENDPOINT__`/`__RASPBERRYCODE_ARMS_RUM_ENDPOINT__` 构建期不注入即空串 |
| 插件市场默认远端源断开 | ✅ | `plugin-marketplaces.ts`：RaspberryCode 官方市场 `source: ""`；另内置 Claude 生态目录（`anthropics/claude-plugins-official`）为第三方插件生态源，无品牌特权 |
| 品牌 CDN 清零 | ✅ | 运行时源码无 `cdn.codegeex.cn`/`cdn-zcode`/`z-cdn.chatglm`（A2 修复保持）；测试夹具中的假 URL 本次统一中性化 |

## 三、逐条规则核验（specs/provider-neutrality.md）

1. **能力机制无品牌特判** ✅ —— 运行时源码零品牌分支（含 `-i` 全变体复扫）。
2. **签名兼容域** ✅ —— 机制在 `reasoning-signature-scope.ts`，域成员为数据声明。
3. **排序中立** ✅ —— `resolver.ts:355` `resolveProviderOrder` 按声明顺序，注释明示中立。
4. **删除规则中立** ✅ —— 按「内置/自定义」判定，无品牌特判。
5. **模型徽标按元数据** ✅。
6. **命名与资产中立** ✅（本次修复后）—— 运行时路径/变量/协议均为 raspberrycode 命名（`RASPBERRYCODE_*`、`~/.raspberrycode`、`com.raspberrycode/*`）；本次清掉最后的 "Z Code"/"z-code" 字面量。
7. **保留兼容面** ✅ —— 旧配置读兼容端点（`legacyRaspberryCodeConfigProviderReader` 的 `open.bigmodel.cn`）、metered 额度查询端点（`bigmodel.cn`）为 wire 协议事实；provider ID/GLM 模型 ID/logo 资产库为平铺第三方标识。

**平铺性专项**：内置模板 21 席（zai×2、bigmodel×2、Kimi、MiniMax、DeepSeek、阿里云×2、小米×2、OpenAI、Anthropic、xAI、OpenRouter、OpenCode×6），**零特权标记**（无 default/recommended/featured/pinned/rank），zai/bigmodel 与 OpenAI/Anthropic 完全平级。

## 四、本次发现并修复（真残留清单）

| # | 位置 | 内容 | 性质 | 处置 |
| --- | --- | --- | --- | --- |
| 1 | `packages/desktop/src/main/index.ts:1222` | 退出确认框 `确认退出 Z Code? / Quit Z Code?` | **用户可见文案**（空格变体躲过全部 zcode 词扫描） | ✅ 改 RaspberryCode |
| 2 | `apps/raspberrycode-cli/packages/core/src/tool/handlers/node-repl.ts:336` | tool prompt `z-code compatibility fallback` | 模型可见文案 | ✅ 改 legacy |
| 3 | `README.md`/`README.en.md` 第 2 行 | 出处署名被机械替换为 `zai-org/RaspberryCode`（不存在的仓库地址） | **法务归属篡改**，违反 Apache-2.0 4(c) 真实署名要求 | ✅ 还原 `zai-org/ZCode` |
| 4 | `THIRD-PARTY-NOTICES.md` ×3 行 | 来源路径 `apps/zcode-cli/...`、`zcode-protocol-v4/` 过时 | 法务清单准确性 | ✅ 改现行路径 |
| 5 | UI 源码注释 ×4（terminalDataTransform/ConversationRowView/SessionPane/conversationTelemetrySupervisor） | `z-code`/`z-code-2` 旧产品名对比注释 | 死文案 | ✅ 改「旧实现/上游实现」 |
| 6 | `scripts/dev-desktop-env.mjs`、`scripts/spawn-command.mjs` | 注释路径示例 `E:\Z Code\` | 死文案 | ✅ 改 `D:\my repo\` |
| 7 | `protocolDocs.ts`、`UI_PLUGIN.md`、`UI_PLUGIN.en.md`、`apps/raspberrycode-cli/AGENTS.md`、`check-workspace-freshness.mjs` | 示例路径/文案 z-code | 死文案 | ✅ 中性化 |
| 8 | 测试夹具 62+ 文件（ui/services/server/desktop/cli tests） | `/Users/dev/workspace/z-code`、`Z Code@electron`（过时输入，运行时已是 `RaspberryCode@electron`）、假域名 `raspberrycode.z.ai`、`codegeex`（含 `cdn.codegeex.cn` 假 URL、owner/host 夹具） | 夹具死文案（断言不依赖品牌值；`/tmp/z code` 含空格路径的转义测试语义已保持为 `/tmp/my tool`） | ✅ 批量中性化（demo/demo-org/example.com） |

## 五、待拍板：NOTICE.md 与产品现状脱节（重大发现）

`NOTICE.md`（73 行）标题为「**ZCode** 相关功能说明与第三方组件声明」，正文是上游 ZCode 产品的合规披露，其中大量条目描述的行为**在 RaspberryCode 中已拆除**：

- 「登录、授权、账号与 API 凭据」「套餐、订单、支付与额度」—— 登录链与订阅购买已全拆；
- 「官方 Coding Plan 模型网关转发：命中时自动改发 ZCode 网关……由 `ZCODE_BASE_URL／ZCODE_ENDPOINT_ORIGIN` 配置」—— 网关自动转发已全拆（且是本次校验的红线之一）；
- 「桌面定时任务与**闲时任务**」「**营销触达与奖励中心**」「**手机远程控制**（`ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL`）」「桌面**自动更新**（`ZCODE_UPDATE_FEED_URL`）」「**会话分享**、浏览与导入」—— 均已拆除；
- 路径引用全为旧名（`apps/zcode-cli/...`、`packages/zcode-cua/`、`~/.zcode/cli/db/db.sqlite`）。

**定性**：
1. 该文件不是版权声明（LICENSE:190 `Copyright 2026 Z.AI Co., Ltd` 才是，法定义务已保留），而是**产品功能/数据行为披露**；
2. Apache-2.0 4(d) 明确可剔除「不适用于衍生作品的声明」（notices that do not pertain to any part of the Derivative Works）——上述已拆除功能的披露段依法可以且应当改写；
3. **它不随发行包分发**（build 脚本与 `win-unpacked/resources` 只携带 THIRD-PARTY-NOTICES.md），风险限于仓库文档层；但作为仓库顶层披露文档，与产品事实严重不符，且自称 ZCode。

**建议处置**（二选一，待拍板）：
- A（推荐）：重写为 RaspberryCode 现状披露（删除/改写已拆除功能段、路径与变量名对齐现行、产品名改 RaspberryCode），文首保留一行上游归属（基于 zai-org/ZCode，Apache-2.0）；
- B：降级为历史文档（移入 docs/history/）并另立简短 NOTICE 仅含归属与第三方组件声明。

## 六、发版前必做：全量重建构建产物

源码已净，但**旧构建产物仍携带旧字符串**，发版前必须全量重建（否则会打进发行包）：

| 产物 | 残留内容 | 说明 |
| --- | --- | --- |
| `packages/desktop/out/main/index.js` | `"确认退出 Z Code?":"Quit Z Code?"` | 我修复的 index.ts 的旧编译输出；electron-builder 打包即用 out/ |
| `packages/services/dist/`、`packages/server/dist/` | THIRD-PARTY-NOTICES 旧路径副本 | 重新构建时拷贝新清单即净 |
| `packages/desktop/bundled-agents/win32-x64/agent/raspberrycode.cjs` | 旧注释 "z-code compatibility fallback" | 源头（node-repl.ts）已修，重新构建 agent bundle 即净 |
| `packages/desktop/dist/win-unpacked/resources/` | app.asar 内旧串 + THIRD-PARTY-NOTICES 旧路径 | 旧打包快照，重建即净 |
| `apps/raspberrycode-cli/.turbo/cache` | 记录旧产物名 `zcode.cjs` 的哈希清单 | 清缓存重建，避免增量构建误判 |

## 七、有意保留 / 豁免（复核确认，勿清）

1. **法务**：LICENSE:190 `Copyright 2026 Z.AI Co., Ltd`（Apache-2.0 原始版权声明，4(d) 强制保留）；README 出处说明段（已还原真实上游链接）；技能 LICENSE.txt 版权行。
2. **wire 协议事实**：metered 额度端点 `bigmodel.cn`、旧配置读兼容端点 `open.bigmodel.cn`、`X-Bigmodel-*` 互操作头——用户自带厂商凭据/存量配置时必须打厂商地址。
3. **平铺第三方标识数据**：provider ID（zai/bigmodel/account:*）、模板名（"Z.ai Coding Plan" 等厂商官方产品名）、GLM 模型 ID 目录、logo 资产库、SQL/迁移史。
4. **历史文档豁免**：`docs/**`（含历史设计、工作记忆、审计报告本身）、`apps/raspberrycode-cli/docs/**`——不进发行包，保留作历史记录。
5. **测试夹具建模 legacy 的数据契约**（session migration、sourceServerContracts 等）。

## 八、验证

- `pnpm typecheck`：**0 error**（修复后复跑）。
- `pnpm lint`：**0 error**、264 warn（基线 259；warn 差异来自工作树其他未提交改动累积，本次改动均为注释/字符串替换）。
- 测试：`workspaceSidePane` 121/121 绿（夹具改动验证）；受影响批量单测见文末补记。
- 扫描方法学备注：初轮扫描曾因两个口径缺陷误报/漏报（bash grep 未加 `-i` 漏全大写变体；行级过滤 raspberrycode 误滤混合行），已统一为 `-i` 全变体 + 无行过滤复核，终扫结论以复核为准。

---

## 补记（测试批量结果）

- 批量 1（ui/services/server 20 文件 + workspaceSidePane 单跑）：410 用例中 408 绿；2 红定性为**清扫批次半截改名所致**（`memorySettingsSection` 的 displayName "Z Code"→"RaspberryCode" 改了但 mock label `z-code` 未同步，`normalizeWorkspaceDisplayName` 的 slug 匹配断链）——本次修复（label 与 displayName 同名对齐），复跑 **8/8 绿**。
- 批量 2（desktop 侧）：`desktopRuntimeEnv` 1 红定性为**清扫批次自身不一致**（测试期望 `raspberrycode.z.ai` vs `.env.development` 实值 `your-server.example`）——本次修复期望对齐现行占位值，复跑 **33 过/4 skip**；desktopAppTestIdLookup、desktopAppWorkspaceReadiness、releaseChangelogWriter、cdnPreloadScript 均绿。
- CLI 侧（apps/raspberrycode-cli/packages/*/tests，独立 vitest 入口）：adapters 16/17（1 红 `bash-startup-script`：断言硬编码"含空格路径→引号"形态，与本机 tmpdir 无空格耦合，失败正则未被本次替换触及）；core 163/166（3 红：`runtime-persistence`×2、`subagent-explore`×1，均为异步时序断言形态——title 生成顺序、刷新事件缺失、mock 文件写入未落；本次改动面仅注释/虚构路径字符串，与失败面无因果）。
- 上述 4 红均为环境/时序类存量形态，但 `apps/raspberrycode-cli` 目录整体未跟踪（改名产物）**无 HEAD 基线可 stash 对拍**，如实标注：已排除本次改动因果，待后续统一基线甄别。
- `node-repl` 文案改动无测试断言依赖（全仓无 "compatibility fallback" 旧文案断言）。
- 判读纪律：单跑定性、对照组验证、git diff 对拍分清「清扫批次改动」与「本次改动」，未把存量红写成本次问题，也未把本次问题推给存量。

## 九、验证终值

- `pnpm typecheck`：0 error（两轮）。
- `pnpm lint`：0 error / 264 warn（终态复跑；warn 与基线同量级，来自工作树其他未提交改动）。
- 测试合计：**736 用例绿**（121+8+408+33+3+16+163 中的绿计），4 红为存量/环境形态（见补记），本次改动引入的红 = **0**（3 个由本次定性修复归零：memorySettingsSection×2、desktopRuntimeEnv×1）。

## 十、机制化收敛（响应「如何保证」的追问）

人工逐轮扫描已证伪（每轮都有新遗漏）。2026-11-03 上午固化 `scripts/audit-neutrality.mjs`（可复跑机器判据），第一跑即抓出人工扫描漏掉的 2 处源码注释残留（输出截断漏看）——再次证明应以机制而非信心收敛。

**判据设计**（把历次教训编码进去）：
- P0 产品自名：`(?<![a-z0-9])z[-_ ]?code\b` -i 穷举空格/连字符/下划线/大小写变体（防 "Z Code" 空格盲区），前边界排除 bizCode/TikZ code 误报；
- P1 品牌词（Z.ai/zai/zhipu/智谱/codegeex/chatglm/bigmodel）：运行时源码仅允许「协议事实/数据声明」白名单文件（每条附定性注记），wire 事实行（`raspberrycode.error.*` 错误码 key、`X-Bigmodel-*`）行级豁免；
- P2 用户可见文案面（i18n/slash-help/TUI）品牌词必须 0；
- 产物硬边界（out/dist/win-unpacked/bundled-agents/发行归档）：P0 判负（法务 LICENSE 文件豁免），P1 报告基线（模型 ID 数据豁免）；
- 豁免全部显式打印（P0/P1 白名单 348 文件 + 产物豁免 24 文件），不是隐藏。

**当前基线**（2026-11-03 10:30）：
- 源码层：**P0=0 / P1=0 / P2=0**（三档全清）；
- 产物层：P0 12 文件 + P1 32 文件——**全部为旧构建产物副本**（win-unpacked、bundled-agents、out、各包 dist、dist/raspberrycode 归档工作目录），源码源头已净，全量重建后复跑应为 0；
- 产物豁免 24 文件：技能 LICENSE 版权声明（法务）+ 模型 ID 目录数据。

**发版门槛建议**：`node scripts/audit-neutrality.mjs` 必须 PASS（硬违规 0）方可打发行包；可选挂入 `verify:pre-push`。

**语义层边界（诚实声明）**：扫描只能证明"字面干净"。排序/删除规则/能力分支的中立（无品牌特权）靠 `specs/provider-neutrality.md` 七条逐项核验 + 对应单测锚定，不由扫描覆盖；如需更强保证，可在 CI 加"排序快照断言"类测试。

## 十一、文档层全面更新（2026-11-03 下午，用户口径「全量分层处理 + 已拆功能文档归档标注」）

**分层执行结果**：
- **已拆功能文档归档**（移 `docs/archive/` + 文首归档声明，archive/README.md 有全索引与保留能力对照）：off-peak-task/（闲时任务）、highspeed/（加速卡）、oauth/（登录/JWT）、web-remote-control/ + issues/web-remote-control-relay-v2/（手机远控）、web-share/ + conversation-share-v1（会话分享）、marketing-touch-* + cloud-content-dialog（营销/奖励）、coding-plan-purchase-*/quota-reset-*/upgrade-*/webview-bridge（订阅购买）、账号套餐体系（team-plan/start-plan/family-merge）、force-update（强制更新）、zai-oauth/zai-start-plan、对应 testing/monitoring/ui 子文档——合计 80+ 文件。
- **历史记录层**（原文保留 + 目录级历史声明）：superpowers/、working-memory/、analysis/、adr/、issues/、plans/、oss-cdn 迁移史、feedback API 迁移史。
- **现役产品文档更新**：产品自称（"Z Code"→RaspberryCode）、本仓旧名（z-code→raspberrycode，保护真实上游仓名 z-code-toolset）、历史对照措辞（z-code-2→旧版）、断链改指 archive/（22 文件）、**假域名占位化**（raspberrycode.z.ai / cdn-raspberrycode.z.ai / cdn.raspberrycode-ai.com → your-server.example 系，20 文件——假域是 z.ai/旧产品真域形态，与 .env 处理同口径）。
- **活文档对齐现状**：AGENTS.md（节名改"远程链路"、relay 条目改为 Server 自托管转发语义——核实 web 三包已拆、web-remote-replayable 为活协议枚举保留）、DESIGN.md（删除 Login/升级/Rewards surface 条款）、UI_PLUGIN×2（登录→API Key）。
- **NOTICE.md 按方案 A 重写**：RaspberryCode 现状披露（数据目录 ~/.raspberrycode、BYOK 接收方语义、删已拆行为条目：登录/订单支付/网关转发/闲时票据/营销/会话分享/自动更新），文首保留真实上游出处（zai-org/ZCode，Apache-2.0 归属），链接目标已验证存在。

**终扫结论**：现役文档+活文档除两类有意保留外全清——① 法务署名（README/NOTICE 的 zai-org/ZCode 出处、LICENSE 版权行）；② 真实上游仓名（z-code-toolset）。审计基线不变（FAIL 17 全为旧构建副本，发版前重建归零）。

## 十二、产物全量重建与终验（2026-11-03 下午）

按「发版前必做」执行全量重建（清旧产物→全包构建→发行归档→Windows 打包），环境坑逐一排解（safe-delete 守卫开关 `CODEBUDDY_SAFE_DELETE_ENABLED=0`、NSIS 模板旧补丁标记幂等断链修复、packages/shared 丢失的 build script 补回、build-raspberrycode.mjs 的 pnpm shell/tar 原生 Windows 兼容修复、tar 归档按实证用 git-bash 补完）。

**产出**：
- 发行归档 `dist/raspberrycode/releases/0.1.0/raspberrycode-0.1.0.tar.gz`（53MB）：bin/raspberrycode.mjs、agent/raspberrycode.cjs、server/ 布局命名全对，内容零产品自名（THIRD-PARTY-NOTICES 副本与 agent bundle 抽查 0 命中）。
- Windows 安装包 `RaspberryCode Preview-0.1.0-win-x64_TEST.exe`（155.5MB）：签名、blockmap、runtime 依赖闭包校验、体积审计全过，exit=0。

**audit-neutrality 终验：PASS（exit=0）**——P0 产品自名=0、P2 文案自称=0、产物 P0=0。P1 厂商信息盘点（合法能力）源码 57+产物 51；产物 P1 报告项仅 1（归档压缩流内 LICENSE `Copyright Z.AI` 版权行，法务合法）。

**中立性改造全部收口**。发版剩余事项仅：将工作树改动提交为版本快照。
