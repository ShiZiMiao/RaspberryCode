# RaspberryCode 二次开发准备文档

> 基于 ZCode v3.16.2（zai-org/ZCode，Apache-2.0）· 准备工作记录于 2026-10-26
>
> 本文档属于 RaspberryCode 衍生项目自有文档，不随上游同步覆盖。

## 1. 项目基线

| 项 | 值 |
| --- | --- |
| 上游仓库 | <https://github.com/zai-org/ZCode>（`git remote: upstream`） |
| 上游版本 | 3.16.2（root `package.json`），上游同步至 2026-10-20 |
| 本地工作区 | `D:\projects\RaspberryCode`（完整 git 历史，18266 个文件） |
| 许可证 | Apache License 2.0，Copyright 2026 Z.AI Co., Ltd |
| 工具链 | Node.js 24.14.0 + pnpm 10.33.2（`mise.toml` 固定，本机 mise 已就绪） |

ZCode 是 AI 编程工作台：Electron 桌面应用 + Web 客户端 + 后端服务 + 终端 Agent CLI（`apps/zcode-cli`）。
pnpm monorepo 共 53 个 workspace 包。

## 2. 许可与合规（动手前必读）

Apache-2.0 **允许**二次开发、修改、商用和再分发，但有义务：

1. **保留** `LICENSE`、`NOTICE.md`、`THIRD-PARTY-NOTICES.md` 及源码中的版权/专利/商标声明；
2. **标注修改**：修改过的文件须注明已更改（建议统一加 `Modified for RaspberryCode` 头注释，或维护 `CHANGES.md` 清单）；
3. 衍生分发须附 Apache-2.0 许可副本（保留根 LICENSE 即满足）；
4. **商标条款（第 6 条）**：不授予使用 ZCode / Z.ai 商标的权利——衍生品**不能**以 ZCode/Z.ai 名义宣传。把品牌替换为 RaspberryCode 不只是需求，也是合规要求；
5. 不提供担保；不得暗示 Z.ai 为衍生品背书。

第三方组件（字体、图标、原生二进制、依赖包）受各自条款约束，见 `THIRD-PARTY-NOTICES.md` 与 `third-party/`。
`NOTICE.md` 中的风险告知（Agent 无沙箱执行、数据上传行为、日志落盘等）建议在衍生品文档中保留对应提示。

## 3. 仓库结构速览

| 目录 | 职责 |
| --- | --- |
| `apps/zcode-cli` | **Agent 核心**：CLI、TUI、运行时、工具与插件（内部又是一个嵌套 workspace，30+ 子包） |
| `packages/desktop` | Electron Main / Host / Renderer 与桌面打包 |
| `packages/web`、`packages/server`、`packages/zcode-server-cli` | Web 客户端、HTTP/WS 服务、独立 Server 启动 |
| `packages/ui`、`packages/services`、`packages/shared`、`packages/rpc`、`packages/client` | 共享 UI、业务服务、协议类型、RPC 框架、Agent 客户端 SDK |
| `packages/provider`、`packages/provider-node` | 模型 Provider 抽象与 Node 实现 |
| `config/` | 随客户端发布的内置默认配置（`default.json`、provider 配置） |
| `scripts/` | 构建/打包/审计脚本（含 `build-zcode.mjs` 发行包组装） |
| `docs/`、`specs/` | 上游开发文档与规格（2000+ 篇，含中文架构分析文档） |
| `patches/` | pnpm patchedDependencies 补丁 |

## 4. 本机环境注意事项（Windows，2026-10-26 已验证）

- **MSVC 已安装并验证**：VS Build Tools 2022 17.14.42（MSVC 14.44.35207 + Windows SDK），`node-gyp` 经 vswhere.exe 定位工具链；`ssh2` 的 crypto 加速绑定（`sshcrypto.node`）已手动编译通过（`node_modules/ssh2/lib/protocol/crypto` 下 `node ../../../../node-gyp/bin/node-gyp.js rebuild`）。
- **node-pty 免编译**：仓库自带 `prebuilds/win32-x64/pty.node`，桌面 postinstall 会自动跳过 electron-rebuild。
- **cpu-features 已跳过**：其 `buildcheck` 调用 `reg.exe` 探测 VS（本机安全策略黑名单拦截）。它只是 ssh2 的可选性能探测模块，已在 `pnpm-workspace.yaml` 中将 `allowBuilds.cpu-features` 改为 `false`（含 `Modified for RaspberryCode` 标注），功能不受影响。
- **安全删除守卫**：WorkBuddy 的 Node 安全删除 shim 对单次批量删除（>50 个文件）要求用户确认。构建命令（`pnpm bootstrap` 的 patched-dependencies 清理会删 `node_modules/vitest` 等）会触发；已确认的放行方式：**仅对该条命令**设 `CODEBUDDY_SAFE_DELETE_ENABLED=0`，命令结束恢复默认保护。
- Electron 二进制经 `ELECTRON_MIRROR`（npmmirror）下载，`mise.toml` 已配置。

## 5. 品牌替换清单（ZCode → RaspberryCode）

全库 **8115 个文件**含 `zcode` 字样（packages 4723 / apps 2054 / docs 1102），不可能一次替换完。建议分层推进：

### L1 · 产品身份与发行物（优先，改动面小、收益直接）

- `packages/desktop/scripts/desktop-product-identity.mjs` —— **桌面身份的唯一事实来源**：
  - `appId: "dev.zcode.app"` → 如 `dev.raspberrycode.app`
  - `productName: "ZCode"` → `RaspberryCode`（含 `ZCode Preview` 变体）
  - `linuxExecutableName` / `linuxPackageName`：`zcode` → `raspberrycode`
- `packages/desktop/electron-builder.config.js`（artifactName、macOS 权限文案、`dev-app-update.yml` 更新源）
- `scripts/build-zcode.mjs` + `scripts/zcode-distribution/`：发行包目录名 `zcode`、`dist/zcode`、`install.sh`、`latest.json`
- `public/` 应用图标（.ico/.icns/.png）
- 根 `package.json` 的 `"name": "zcode"` 与版本策略（建议改 `raspberrycode` 并用自己的版本号段）

### L2 · 包名与命令名

- npm scope `@zcode/*`（53 个 workspace 包）→ `@raspberrycode/*`（可脚本化批量替换，含 import 路径与 `workspace:*` 引用）
- CLI 入口命令 `zcode`（`apps/zcode-cli/packages/cli/package.json` 的 `bin`）→ `raspberrycode`（并决定是否保留 `zcode` 作兼容别名）
- TUI / `zcode --web` 启动文案与 `--help` 文本

### L3 · 环境变量与数据目录

- `ZCODE_*` 环境变量（数百个：`ZCODE_DATA_BASE_DIR`、`ZCODE_API_KEY`、`ZCODE_DIST_*`、`ZCODE_UPDATE_FEED_URL`…）
- 用户数据目录 `~/.zcode/`、`.zcode/`（注意迁移：老用户数据目录兼容）
- 协议/代码标识：`window.zcode`、`packages/shared/src/zcode-protocol/`

### L4 · 服务端点与账号体系（决定产品形态，需先决策）

- `.env.example` / `config/default.json`：`zcode.z.ai`、`cdn-zcode.z.ai`、`chat.z.ai`、`api.z.ai`、`bigmodel.cn`
- **官方 OAuth client id 不可用于衍生品**（`ZAI_OAUTH_CLIENT_ID`），需自建服务端/换 API Key 模式
- ⚠️ `NOTICE.md` 提到「官方 Coding Plan 模型网关转发」：匹配两个官方 Anthropic 兼容端点时请求会**自动改发 ZCode 网关**——RaspberryCode 必须移除或重定向到自有模型服务
- 自动更新源（`ZCODE_UPDATE_FEED_URL`）、遥测（ARMS RUM）应关闭或指向自有端点

### 合规保留项（不要删）

`LICENSE`、`NOTICE.md`、`THIRD-PARTY-NOTICES.md`、`third-party/`，以及 `docs/`、`patches/` 中描述"来源=ZCode"的字样可保留。

## 6. 上游同步策略

- `upstream` 指向 zai-org/ZCode；自己的仓库建好后 `git remote add origin <your-repo>`。
- 上游以 "sync ZCode source" 批量提交滚动，**按版本整体合并**最省力（如 v3.16.2 → v3.17.x：`git fetch upstream && git merge upstream/main`）。
- 把品牌替换收敛在少数"身份文件"（第 5 节 L1）+ 脚本化批量替换，能把合并冲突面降到最低。
- 建议分支模型：`main` 尽量贴近上游（只放兼容性改动），`raspberrycode` 分支放自有功能与品牌改动；或在主干开发、定期 `git merge upstream/main`。
- 仓库自带架构治理（`pnpm architecture:check`、`AGENTS.md` 工作流）；自有改动建议同步维护 `specs/`。

## 7. 常用命令（从仓库根目录）

| 用途 | 命令 |
| --- | --- |
| 初始化（依赖 + 构建） | `mise run bootstrap` 或 `pnpm bootstrap` |
| 桌面开发 | `pnpm dev:desktop`（测试环境 `pnpm dev:desktop:test`） |
| Web 开发 | `pnpm dev:web`（Web:5173 + 后端:3030） |
| CLI 开发 | `pnpm --filter @zcode/cli dev` / 构建 `pnpm --filter @zcode/cli... build` |
| 命令行发行包 | `pnpm build:zcode --base-url <下载根地址>`（产物在 `dist/zcode/`） |
| 类型检查 / Lint | `pnpm typecheck` / `pnpm lint` |
| 提交前检查 | `pnpm verify:pre-push` |
| 单测 | `pnpm test:unit`（全量 `pnpm test`） |

## 8. 下一步行动清单

1. [x] 安装 VS Build Tools（C++ 工作负载 + Windows SDK）——17.14.42 已装并验证
2. [x] 放行 bootstrap 的批量删除确认（单命令 `CODEBUDDY_SAFE_DELETE_ENABLED=0`）
3. [x] `pnpm-workspace.yaml` 中 `allowBuilds.cpu-features: false`
4. [x] `pnpm bootstrap` 跑通；基线验证：`pnpm typecheck` 通过（3m54s）、`pnpm lint` 0 errors / 97 warnings（上游自带）
5. [x] 创建自有 Git 仓库并配置 `origin`（github.com/ShiZiMiao/RaspberryCode，私有；上游版本标签按用户要求不保留）
6. [x] L1 品牌替换完成（2026-10-26，commit 56b16368）：桌面身份（appId `dev.raspberrycode.app`、
   productName `RaspberryCode`/`RaspberryCode Preview`、Linux 名 `raspberrycode`）、全套图标
   （build/ 与 public/ 的 PNG/ICO/ICNS）、窗口标题/关于页/托盘/菜单/TUI 侧边栏、i18n 261 处、
   功能耦合点（进程名匹配、安装目录探测、deep-link、CA 元数据、User-Agent）、版本号 0.1.0；
   并修复 MemoryFileSystem 测试桩 Windows 路径缺陷（上游基线问题）
7. [ ] 模型服务决策：接自有 Provider / API Key，移除官方网关转发与 OAuth
8. [ ] L2–L4 按需分阶段推进（L2：包名/命令名 @zcode/* 与 zcode、内部报错文案、发行包目录命名；
   L3：ZCODE_* 环境变量与 ~/.zcode 数据目录、协议标识；L4：服务端点与账号体系）
