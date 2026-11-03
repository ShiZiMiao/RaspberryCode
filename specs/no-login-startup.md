# 无登录启动（No-Login Startup）

## 背景

RaspberryCode 是自有品牌发行版，不再沿用上游的 Z.ai / BigModel 账号登录体系。
旧版本启动时若未连接账号或未配置模型凭据，Root 启动门禁会打开 WelcomeScreen 登录页
（连接 Z.ai / 连接 BigModel / 使用 API Key），阻塞进入主界面。

## 产品规则

1. **启动直达主界面**：应用启动后不得出现任何身份验证、账号登录或「连接账号」步骤。
   启动门禁只允许等待与登录无关的就绪状态（provider 快照水合、workspace 恢复、初始 workspace 注入）。
2. **登录页整体移除**：WelcomeScreen（含 LoginPanel、API Key 登录表单）不再存在；
   任何交互路径（启动、登出后、会话过期、设置页 Connect、购买续接、营销动作、奖励入口、远控配对）
   都不得再打开登录页或发起账号登录。
3. **模型接入走设置**：模型供应商与 API Key 配置入口是「设置 → 模型供应商」
   （`SettingsPage` → `ModelProviderSection`），与登录流程无关，保持可用。
4. **账号绑定能力按 signed-out 降级**：`user` 恒为 `null`（无登录来源写入）。
   依赖账号的功能（Coding Plan 订阅购买、Rewards、营销触达、Web 远控账号鉴权）
   须按既有 signed-out 分支降级：隐藏入口或给出不可用提示，不崩溃、不出现死按钮。
5. **不新增兜底**：不保留「以后再登录」「跳过登录」等过渡交互；需要账号的操作直接不可用。

## 状态所有者

- 启动渲染门禁：`packages/ui/src/lib/rootStartupGate.ts`（纯函数）+ `Root.tsx` 消费。
- 登录入口状态（`welcomeScreenOpenReason`、`loginEntryRequest`）整体删除，无后继所有者。
- `user` / `authSessionSeq` / `oauthError` 等 store 字段保留（signed-out 语义与既有降级逻辑依赖），
  但无任何生产路径写入 `user`。

## 验收场景

1. 首次安装（无凭据、无 provider 配置）启动 → 直接进入主界面（默认 workspace），
   不出现登录页；模型不可用时在会话/设置内提示配置 API Key。
2. 老版本升级（残留 OAuth 凭据或 JWT 失效标记）启动 → 直接进入主界面，
   不弹「重新登录」，不消费 JWT 失效重启标记。
3. 登出（若残留已登录态触发）→ 重启后仍直接进入主界面，不强制回登录页。
4. 设置页「模型供应商」仍可新增/编辑 API Key 与自定义供应商，模型调用可用。
5. Coding Plan Connect / 购买、Rewards、营销触达账号动作、远控配对登录按钮：
   无登录入口，按 signed-out 降级（隐藏或提示），无未处理异常。
6. `pnpm typecheck`、`pnpm lint` 通过；受影响单测更新为断言「无登录门禁」行为。

## 明确不做（后续精简建议）

- 不删除 `oauthService` 服务层（401 自动登出、RPC 装配仍依赖）。
- 不动 CLI（`raspberrycode login`）与 Web 远控浏览器侧登录（`packages/web/src/auth`），
  它们是独立体系，另行决定去留。
- Coding Plan 订阅购买、Rewards、营销触达等 Z.ai 账号绑定功能整体移除属后续任务。
