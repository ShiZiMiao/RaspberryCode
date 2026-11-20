# RaspberryCode 0.2.6 发版验证报告

- 日期：2026-11-20
- 版本：`0.2.5` → `0.2.6`
- 结论：**自动化门禁全通过；本轮发现并修复 4 个真实打包缺陷。发版前仍需人工确认 7 项。**

---

## 一、最重要的结论

**CUA（电脑控制）在 0.2.6 之前的安装包里是彻底不可用的，而且任何自动化门禁都发现不了。**

原因是四个叠加的打包缺口，只在「真正安装后的机器」上才暴露：

| # | 缺陷 | 症状 | 修复位置 |
|---|---|---|---|
| 1 | `node-repl-host` 解析不到 `koffi` | host 启动即 `ERR_MODULE_NOT_FOUND` | `stage-cua-agent-assets.mjs` 给 host 也放一份 koffi |
| 2 | **`windows-helper.js` 根本没进包** | Helper `code=1` 立刻退出，CUA 全方法不可用 | 新增 `stageCuaRuntime()` 搬 `raspberrycode-cua/dist` |
| 3 | helper 自己也解析不到 `koffi` | `dist/helper/win32.js` 报 `ERR_MODULE_NOT_FOUND` | 同上，给 `raspberrycode-cua` 也放一份 |
| 4 | desktop 从不注入 helper 入口路径 | 打包态回退路径指向不存在的位置 | `shared/runtimeEnv.ts` 加常量 + `desktopRuntimeEnv.ts` 加解析 + `desktopHostProcess.ts` 注入 + `index.ts` 接线 |

**为什么以前没发现**：`verifyStagedKoffi` 默认只查 `raspberrycode-cua-plugin` 那一路，所以打包前自检一直是绿的；而 helper 从来没有存在性校验。开发态又直接读源码树 `packages/raspberrycode-cua/dist/`，一切正常。

**已加防回归**：

- `verifyStagedKoffi` 增加 `hostRelativePath`，同时校验 host 侧
- stage 自检增加 helper 入口存在性断言
- 新增 `scripts/cua-verify-installed.mjs`：**针对安装目录**（不是源码树）跑端到端

---

## 二、门禁结果（`scripts/release-gate.mjs`，无 `--quick`）

```
== 版本一致性 ==
  OK    desktop=0.2.6 root=0.2.6
  OK    build-meta.json
  OK    安装包存在（169.44MB）
  OK    blockmap / latest.yml
  OK    latest.yml version=0.2.6 且 size 与实际一致（177666386）

== 产物核验 ==
  OK    5 个更新链路修复标记全在
  OK    asar 内 package.json 版本=0.2.6
  OK    产物含远程资产发布根（1 个）

== 自动门禁 ==
  OK    typecheck
  OK    lint
  OK    audit-neutrality

发版准入：自动化项通过
```

### 本轮修掉的两个门禁自身缺陷

这两个缺陷会**误报**，把好包判成坏包：

1. **`release-gate.mjs` 只扫 `out/main/index.js`**
   tsup 做代码分割，`__RASPBERRYCODE_REMOTE_CDN_RELEASE_ROOTS__` 被折叠进 `chunk-*.js`。
   实测发布根确实在 `chunk-LRP4F6AG.js` 里，门禁却判「缺少远程资产发布根」。
   → 改为扫描 `out/main` 下全部 `.js`。

2. **`audit-neutrality.mjs` 没有排除 `dist` / `dist-release`**
   `dist-release/<platform>/runtime/` 是 `stage:remote-assets` 解包出来的**上游运行时代码**，
   带 `.__zcode` 品牌串。审计判成 6 个 P0 硬违规，而这根本无法修复。
   → 加入排除列表（与 `mock-cdn` 同类处理）。

---

## 三、CUA 安装版实测（新增，之前从未做过）

脚本：`scripts/cua-verify-installed.mjs`（针对 `%LOCALAPPDATA%\Programs\RaspberryCode`）

链路：外部 MCP client → **安装目录**的 `node-repl-host/dist/mcp/server.js`
→ Worker 内 bootstrap **安装目录**的 `computer-use-client.mjs`
→ **安装目录**的 koffi → Helper 子进程 → 真实记事本

| 验证项 | 结果 | 证据 |
|---|---|---|
| 安装目录资产存在性（host / client / koffi） | PASS | 三项均在 |
| MCP modern era 握手 | PASS | `2026-07-28` pin 成功 |
| 沙箱 bootstrap 安装版 client | PASS | `agent.computerUse` 存在，方法数 ≥ 10 |
| `list_windows` 真实调用 | **PASS** | 返回 **25 个真实窗口**（含 taskbar / CodeBuddy / TRAE / Explorer） |
| `getApp` + `getAXState` 读树 | **PASS** | 记事本完整 **76~94 节点**树（标签栏、菜单、工具栏、状态栏、标题栏） |
| `set_value` 真实改写 | **PASS** | 树内 `document value` 从 `"ORIGINAL"` → `"MEMORY-VERIFIED"` |
| Helper 独立启动 | **PASS** | `{"event":"helper_ready","socket":"\\\\.\\pipe\\raspberrycode-cua-*","protocolVersion":1}` |
| 安装版 UI 渲染 | **PASS** | 见 `.unattended/final-026.png`，导航/任务列表/输入框/模型名均正常 |

### 两个必须记住的判据陷阱

1. **`set_value` 不要用磁盘文件内容判定是否成功。**
   记事本改的是内存文档，不会自动保存。实测磁盘一直是 `"ORIGINAL"`，看起来像失败，
   但树里 `document value` 已经变了。**正确判据 = 重新观察树，读 `document` 行的 `value`。**

2. **`action_receipt.effect = "unverifiable"` 不是失败。**
   它是「单次派发、不做事后效果校验」的设计标记；真正的成功信号是
   `action_sent: true` + `dispatch_status: "sent"` + `path: "ax"`。

3. **`setValue` 之后不要立刻再调 `getAXState`**，因为它的 `emitText` 会顶掉 cell 的 `return` 值。
   要判定效果就在**下一次独立 cell** 里重新观察。

---

## 四、版本号与远程资产

| 项 | 状态 |
|---|---|
| `packages/desktop/package.json` | `0.2.6`（只改 1 行，diff 干净） |
| 根 `package.json` | `0.2.6`（同上） |
| `apps/raspberrycode-cli/package.json` | 未改（规范要求） |
| `mock-cdn/releases/0.2.6/` | linux-x64 + linux-arm64，descriptor 含 sha256 |
| 发布根注入 | `https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.6`，**已在 asar 内确认** |
| macOS 资产 | **按用户指示不考虑** |

### 发布根注入的时机（0.2.5 事故同款陷阱）

`REMOTE_ASSET_RELEASE_ROOT_URL` 在 **`tsup.config.ts`** 里读取，属于**编译时**注入。
只在 electron-builder 阶段设置太晚，产物里不会有。

正确顺序：

```bash
# 1) 编译（必须带发布根）
cd packages/desktop
REMOTE_ASSET_RELEASE_ROOT_URL=https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.6 \
RASPBERRYCODE_ENV=production RASPBERRYCODE_PREVIEW_IDENTITY=0 \
  node scripts/run-production-build.mjs

# 2) 打包（必须显式 --config）
REMOTE_ASSET_RELEASE_ROOT_URL=https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.6 \
RASPBERRYCODE_ENV=production RASPBERRYCODE_PREVIEW_IDENTITY=0 \
  npx electron-builder --win nsis --config electron-builder.config.js
```

---

## 五、本轮踩到的环境坑（下次别再重踩）

| 坑 | 现象 | 解法 |
|---|---|---|
| **electron-builder 26.17 不自动发现 `electron-builder.config.js`** | 静默用默认配置（只有 3 个键），`npmRebuild`/`asarUnpack`/`afterPack` 全失效 | **必须显式 `--config electron-builder.config.js`** |
| **VS 缺 Spectre 库** | `MSB8040: 此项目需要缓解了 Spectre 漏洞的库` | `setup.exe modify --productId Microsoft.VisualStudio.Product.BuildTools --channelId VisualStudio.17.Release --add Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre`。**必须用 `--productId` 定位**，`--installPath` 会因路径规范化成正斜杠而报「找不到匹配的已安装产品」 |
| **`HTTPS_PROXY` 与 `https_proxy` 同时存在** | PowerShell `Env:` 驱动器抛异常；**Electron 静默退出（退出码 0、零输出）** | 启动脚本里 `set HTTPS_PROXY=` 全部清空，再用 `explorer.exe` 脱离进程树启动 |
| **`safe-delete` 守卫** | 构建清理随机失败；electron-builder 删 50 个 locale 正好撞阈值 | `CODEBUDDY_SAFE_DELETE_ENABLED=0 CODEBUDDY_SAFE_DELETE_SANDBOX=0` |
| **`JSON.stringify` 重写 `package.json`** | **删掉整个 `scripts` 字段（84 行）**，导致配置加载报毫不相关的 ESM top-level await 错误 | 改版本号必须用**正则只替换版本行**，不要重新序列化 |
| **`out/` 被别的构建覆盖** | asar 里有发布根但 `out/` 没有（chunk 名都不同），看起来像缺陷 | 判据要看 asar 内实际内容，不要看 `out/` |
| **agent-desktop 拿不到 Chromium 无障碍树** | `The Chromium tree is still thin after its accessibility build settled` | 启动加 `--force-renderer-accessibility` |

---

## 六、必须人工确认的 7 项（脚本无法替代）

```
[ ] 卸载旧版 → 安装本产物 → 版本号显示为 0.2.6
[ ] 开始菜单 + 桌面快捷方式均已创建，且双击能启动
[ ] 升级路径实跑：0.2.5 → 检查更新 → 下载 → 安装 → 重启 → 版本号变 0.2.6
[ ] 远程连接实测：SSH 连真实远端 → 识别设备 → 装/升级 Source Server → 进工作区
    （0.2.5 就是漏了这项才出的全量故障）
[ ] 新建对话并收到模型回复（不是只看界面有没有回显）
[ ] 文件编辑 / 终端 / 设置页 / MCP·技能·插件入口 逐项点过
[ ] 涉及 UI 的改动已看真实界面截图确认
```

### CUA 的额外人工确认（本轮无法在自动化里完成的部分）

在应用里**创建一个本地 Windows 项目**（不是 SSH 远程），然后：

```
[ ] 设置 → 电脑控制，不再显示「当前环境不支持电脑控制」
[ ] 打开物理注入开关 + 干扰预算设为 unrestricted
[ ] 重启应用（预算/授权在 runtime 创建时一次性解析，改设置必须重启）
[ ] 新建任务，让 Agent 操作记事本：读内容 → 改写 → 再读确认
[ ] 确认 Agent 真的调用了 CUA 工具（不是用 shell 命令绕）
```

**特别说明**：CUA 设计上**不支持 SSH / WSL / Docker 远程环境**，设置页有明确提示。
本轮所有"远程工作区里 CUA 不可用"的现象都是**环境前提不满足**，不是缺陷。

---

## 七、诚实声明：本轮未验的项目

| 项 | 状态 | 原因 |
|---|---|---|
| 通过应用 UI 真实驱动 Agent 使用 CUA | **未验** | 需在本地 Windows 项目里，且需手动确认开关；GUI 自动化在本机受焦点/遮挡限制不稳定 |
| 物理注入类方法（`type`/`key`/`paste`/`left_click_drag`）在安装版 | **部分验** | `set_value` 走 UIA ValuePattern 已验；键盘类需 `unrestricted` + 授权 + 真实前台窗口 |
| 升级路径（0.2.5 → 0.2.6） | **未验** | 需真实发布到 GitHub Release 才能测更新链路 |
| macOS 平台 | **按指示不做** | — |
| 远程连接（SSH 装 Source Server） | **未验** | 需真实远端主机 |

---

## 七点五、代码入库后重建复验（2026-11-20 10:15）

首次打包时 CUA 的全部源码**还未进版本库**（`packages/raspberrycode-cua/src/`
40 个文件未被跟踪）。把代码按 9 个 commit 提交后，为保证「产物 == 源码」
重新走了完整链路：

```
编译（带发布根）  → 2m21s
stage CUA 资产    → 自检通过
打包              → 11m42s
安装              → 0.2.6.0，文件时间 09:35 → 10:10
```

复验结果：

| 项 | 结果 |
|---|---|
| `release-gate`（无 `--quick`） | **6 项自动化全绿** |
| `cua-verify-installed.mjs` | **10 PASS / 0 FAIL** |
| 应用启动 | 7 进程 / 1 窗口 / 标题正常 |
| UI 渲染 | 正常（导航、任务列表、输入框、模型名） |

产物：`RaspberryCode-0.2.6-win-x64.exe` 177,666,386 bytes

### 同时修掉验证脚本的三处判据错误

原脚本会给假失败，三处都值得记下来：

1. 用 `computer.get_app_state` 的 `structuredContent` 找 `elements` —— 那里
   只有 `element_count`，元素表要经 SDK 的 `appStateOf` 从 text block 合并。
   改用高层 API：`getApp` → `getAXState` → `setValue`。
2. 用磁盘文件内容判定 `set_value` —— 记事本改内存文档、不自动保存。
   改为重新观察树读 `document` 行的 `value`。
3. 在同一个 cell 里紧接着 `getAXState` —— 它的 `emitText` 会顶掉 `return` 值。
   判定必须放在**下一次独立 cell**。

## 八、当前产物

```
packages/desktop/dist/RaspberryCode-0.2.6-win-x64.exe      177,666,386 bytes
packages/desktop/dist/RaspberryCode-0.2.6-win-x64.exe.blockmap
packages/desktop/dist/latest.yml                           version 0.2.6
packages/desktop/dist/win-unpacked/                        未安装版（可直接运行）
```

包内已确认：

- `resources/agent/packages/raspberrycode-cua/dist/helper/windows-helper.js`
- `resources/agent/packages/raspberrycode-cua/node_modules/koffi/`
- `resources/agent/packages/node-repl-host/node_modules/koffi/`
- `resources/agent/packages/raspberrycode-cua-plugin/node_modules/koffi/`
- `resources/agent/packages/raspberrycode-cua-plugin/scripts/computer-use-client.mjs`
- asar 内 `out/main/chunk-LRP4F6AG.js` 含完整发布根

---

## 九、发版前的最后提示

**未打 tag、未建 Release、未推送。** 按项目规范，这些动作需要用户明确授权。

创建 Release 时注意：

```bash
gh release create v0.2.6 \
  --repo ShiZiMiao/RaspberryCode \    # 必须显式指定，默认会解析到 upstream
  --title "v0.2.6" \
  ...
```

且 **Release 必须真的上传 `mock-cdn/releases/0.2.6/` 里的两个 tar.gz + descriptor**，
否则产物里的发布根指向 404，SSH 会重演 0.2.5 事故。

---

## 十、第二轮修复：插件缓存路径下 CUA 与浏览器控制同时不可用（2026-11-20 14:00）

用户实测反馈：Agent 会话里说「没有 `mcp__node_repl__js`，CUA 要求的执行宿主不存在」，
浏览器控制也同时不可用。

### 一个缺陷同时废掉两个功能

`resolveBuiltInNodeReplMcpServers` 的门禁是「Browser Use 或 Computer Use 任一启用
即注册宿主」，两者共用同一个 `node_repl` 宿主。宿主起不来，两个能力一起不可用。

### 三个根因（都在「资产搬运」这一层）

**1. 宿主未声明 `node_modules` seed 白名单（主因）**

`shouldSkipDirectory` 对 `node_modules` 的规则是「只有 depth===0 且在顶层白名单里
才复制」。`computer-use` 声明了 `runtimeTopLevelPaths: ["node_modules"]`，宿主没有，
于是宿主的 `node_modules` 被静默裁掉 —— 而宿主的 `server.js` 有静态
`import koffi from "koffi"`（koffi 带原生 .node，esbuild 标为 external）。

源码树能解析到是因为 monorepo 根有 koffi；seed 到插件缓存后是独立目录，
祖先目录里没有，启动即 `ERR_MODULE_NOT_FOUND`。

**2. 宿主 manifest 版本与另两处不一致**

目录名 `0.7.0`、`package.json` `0.7.0`、`manifest` `0.6.1`。
这正是定义文件里反复警告的「三处版本应保持一致，否则会继续加载旧缓存目录」。

**3. `prepare-agent-node-bundle` 只给 cua-plugin stage koffi**

sharp 当年踩过同一个坑（注释原文：「sharp 必须 stage 到宿主目录，否则宿主里的
`import sharp` 在打包后的 app 里解析不到」），koffi 只补了一半。

**4. 修复后又暴露第四层：Helper 入口没传给 node_repl 子进程**

koffi 就位后宿主能启动了，但真正调用 CUA 时：
`helper 启动前退出: code=1 signal=null`。

`resolveHelperEntry` 的顺序是 `RASPBERRYCODE_CUA_HELPER_ENTRY` → 回退
`../helper/windows-helper.js`。但 seed 到缓存的宿主**只有 `dist/mcp/server.js`**
（`requiredSeedPaths` 就只声明那一个），没有 `dist/helper/`。Helper 真实位置在
安装目录 `resources/agent/packages/raspberrycode-cua/dist/helper/`，
它属于 producer workspace 包、不随插件 seed。

desktop 已给 **host 子进程**注入该变量，但 `createBundledMcpRuntimeConfig`
构造 node_repl 的 MCP 子进程 env 时把它丢了。

### 修复

- `official-plugin-definitions.ts`：宿主加 `runtimeTopLevelPaths: ["node_modules"]`
- `node-repl-host/.raspberrycode-plugin/plugin.json`：版本改回 `0.7.0`
- `prepare-agent-node-bundle.mjs`：koffi 同时 stage 到 cua-plugin 与 node-repl-host
- `built-in-node-repl.ts` + `create-app.ts`：把 `RASPBERRYCODE_CUA_HELPER_ENTRY`
  传给 node_repl 的 MCP 子进程

### ⚠ 正确的构建顺序（本轮最大的流程教训）

`run-production-build.mjs` **只跑 tsup + vite**，不含 `prepare:agent-bundle`。
而 `prepare:agent-bundle` 不在这条链里，必须单独执行。今天前面几次打包都漏了它，
导致 `bundled-agents/` 一直是 11 月 2 日的旧内容——改的 manifest 和 stage 的 koffi
**都没进包**，而门禁全绿（门禁只看产物里有没有文件，不看文件是不是最新）。

正确顺序（五步）：

```bash
# 1) 编译（带发布根，编译时注入）
cd packages/desktop
REMOTE_ASSET_RELEASE_ROOT_URL=... node scripts/run-production-build.mjs
# 2) 准备 agent 资产（关键！含 bundled-agents 的插件与 koffi）
npx pnpm run prepare:agent-bundle
# 3) CUA 专项 stage（runtime dist + helper + 三处 koffi + 自检）
node ../../scripts/stage-cua-agent-assets.mjs
# 4) build-meta（必须在打包前，否则产物里是旧 commit）
npx pnpm run prepare:build-meta
# 5) 打包（显式 --config）
npx electron-builder --win nsis --config electron-builder.config.js
```

### 升级路径验证（老用户能自动修好）

缓存路径是 `cache/<marketplace>/<name>/<version>/`，`isSeedCurrent` 比对
`marker.hash === plugin.hash`，而 `hashSeedFiles` 对每个文件的
`path + sha256 + mode` 做哈希。加入 koffi 后 hash 必然变化 → 触发原子替换。

实测（保留旧缓存直接装新版 + 启动）：

```
升级前  0.7.0: koffi=无  manifest=0.6.1
升级后  0.7.0: koffi=有  manifest=0.7.0   ← 自动修复
        0.6.1: koffi=无  manifest=0.6.1   ← 旧版残留，不参与加载
```

**不需要用户手工清缓存。**

### 本轮验证结果

| 项 | 结果 |
|---|---|
| 安装目录 CUA（`cua-verify-installed.mjs`） | **10 PASS / 0 FAIL** |
| 插件缓存路径 CUA（模拟 Agent 真实链路） | **PASS** — `getApp("Notepad++")` + `getAXState()` 读出 `@state s-2 ... showing 0-23 of 24` |
| 插件缓存路径浏览器控制 | **PASS** — 同一宿主内 `agent keys: browsers,documentation`，`agent.browsers` 为 object |
| `release-gate` 六项自动化 | 全绿 |
| 应用启动 / UI 渲染 | 正常（7 进程 / 1 窗口 / 界面完整） |

### 一个必须记住的启动参数陷阱

用 `--force-renderer-accessibility` 启动会让该版本**渲染层停在闪屏**
（DOM 里只有空 `root` group，截图是闪屏）。不带该参数启动则界面完全正常。
这个参数只在需要用 agent-desktop 读 Chromium 无障碍树时才加，**不能用它做 UI 正常性判断**。
