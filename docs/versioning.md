# 版本号与发版约定

本文件是 RaspberryCode 版本号分配的**唯一事实来源**。发版、改版本号前先读这里。

## 版本号语义

版本形如 `MAJOR.MINOR.PATCH`（`x.y.z`），当前 `0.1.0`。**本项目的三段位含义与 semver 常规不同**，
按「变更来源」而非「API 破坏性」划分：

| 位 | 触发条件 | 例子 |
| --- | --- | --- |
| **MAJOR** `x.0.0` | **仅当用户明确要求**。不得自行判断或提议 | `1.0.0` |
| **MINOR** `0.x.0` | **同步上游 ZCode 更新**（merge upstream） | `0.1.0` → `0.2.0` |
| **PATCH** `0.0.x` | **自有小更新**（功能、修复、优化、品牌调整） | `0.1.0` → `0.1.1` |

### 细则

1. **默认每次发版自增 PATCH 位 1**。即没有特别说明时，发版就是 `0.0.x + 1`。
2. **同步上游归零 PATCH**：同步上游时 MINOR +1、PATCH 归 0。
   例：`0.3.7` 同步上游 v3.18 → `0.4.0`（不是 `0.4.7`）。
3. **MAJOR 必须由用户明确说明**才会变动。任何情况下不得自动升 MAJOR，
   也不要在对话里「建议」升 MAJOR 后直接执行。
4. 一次发版只升一位，不跳号（除同步上游的 PATCH 归零）。

## 未发版的进行中版本用 `-rc.N`（用户 2026-11-24 明确要求）

**功能已完成但尚未正式发版**的版本号必须带 rc 预发布段，形如 `0.2.8-rc.1`。

```text
0.2.8          ← 正式发版时才是这个
0.2.8-rc.1     ← 开发期、功能已完成但未发版
0.2.8-rc.2     ← 同版本内又攒了一批功能/修复
```

规则：

1. **进入开发就先挂 rc**：一旦确定这一版的目标版本号（如 `0.2.8`），
   立刻写成 `0.2.8-rc.1`，而不是先写 `0.2.8` 再等发版。
   避免「本地版本号看起来已发版、实际没有」的混淆。
2. **同版本内追加功能递增 rc 序号**：`-rc.1` → `-rc.2`，不新增 PATCH。
   PATCH 只在**正式发版**时按上面的语义递增。
3. **正式发版时去掉 rc 段**：`0.2.8-rc.3` → `0.2.8`，这是唯一一次把 rc 去掉的时机。
4. **rc 版本号不得上传到 GitHub Release，也不得打 `v*` tag**。
   发版动作只对无 rc 的正式版本执行。

### 为什么 rc 绝不能发到 GitHub（实测依据，不是保守假设）

`releases.atom` **不会**因为某个 release 被标记为 pre-release 就排除它——
实测 `electron/electron` 的 `v46.0.0-alpha.13` 等 prerelease 条目就在 atom 里。
而我们的 `GitHubProvider` 没有显式设置 `allowPrerelease`，完全依赖 electron-updater
的默认逻辑：**正式版用户的 `allowPrerelease=false`，直接取 atom 第一条**。

推演结果（`v0.2.8-rc.1` 若进入 atom 首位）：

| 当前版本 | 行为 | 后果 |
| --- | --- | --- |
| `0.2.7`（正式） | 取 atom 第一条 = `v0.2.8-rc.1` | **RC 直接被推给全部普通用户** |
| `0.2.8`（正式） | 指向 rc.1，但 semver 判定为降级 | 每次检查多走一轮「发现→拒降级」 |
| `0.2.8-rc.1` | 同 channel 匹配到 rc.1 | 正常 |
| `0.2.8-rc.1`（rc tag 已删） | 无同 channel 条目 | `ERR_UPDATER_NO_PUBLISHED_VERSIONS` |

结论：rc 只作为**本地开发期的版本标记**（用于区分「已改版本号但未发版」），
不参与任何分发。这样零风险，且不需要改 `allowPrerelease`。

### rc 构建自己点「检查更新」会报错，这是预期

rc 版本运行时 `allowPrerelease` 被 electron-updater 自动置为 `true`，
channel 取 `rc`；而 atom 里没有任何 `rc` 条目（rc 不上传），
于是所有条目都不满足 `isNextPreRelease`，最终抛
`ERR_UPDATER_NO_PUBLISHED_VERSIONS`，UI 显示「检查更新失败」。

**这不是缺陷，不要为此加兜底分支**：rc 是开发版，本就不该给自己推更新。
测试 rc 构建时看到这条报错属正常现象。等改成正式版本号并发布后，该行为自动消失。

## 版本号写在哪

发版版本由 **`packages/desktop/package.json` 的 `version`** 决定（electron-builder 据此生成
安装包名与 `latest.yml`）。同步修改：

- `packages/desktop/package.json` → `version`（**权威来源**）
- 根 `package.json` → `version`（保持一致）
- Git tag：`v<version>`（与 `version` 严格一致，自更新据此比对）

**rc 版本不打 tag**：`v0.2.8-rc.1` 这种 tag 一律不创建（见上一节）。
本地 `version` 可以是 rc，但 Git 上的 `v*` tag 只对应正式版本。

**不要改** `apps/raspberrycode-cli/package.json` 的版本（`private: true`，跟随上游 ZCode 版本线，
与产品发版无关）。

## 发版铁律：未全面测试禁止发版

**用户 2026-11-13 明确要求。** 这不是建议，是准入门槛。

发版前必须过 `node scripts/release-gate.mjs`（`pnpm release` 已内置该前置步骤，
`release:raw` 才是裸 release-it）。该脚本自动判定版本一致性、产物内容、三份资产；
**但它无法替代真实安装与功能点验**，脚本末尾会打印人工确认清单，逐项做完才算通过。

历史教训（四次都是用户先发现）：
- `0.2.0` / `0.2.1`：更新下载功能实际不可用（镜像重定向装错 session）。
- `0.1.0` / `0.2.0`：装完没有开始菜单与桌面快捷方式。
- `0.2.5`：**远程连接（SSH）全部不可用**。构建时未设置远程资产发布根，安装包里没有
  Source Server 下载地址，连接时报「Unable to resolve Source Server release descriptor」。
  已加两道防线：`release-gate.mjs` 强制检查产物内是否存在远程资产发布根；
  发版清单第 7 项要求实测远程连接。
- `0.2.7`：**远程连接再次全部不可用，但根因与 0.2.5 相反**——发布根存在且正确，
  错在**拼接**：`tsup` 注入的是已带 tag 的完整根
  （`.../releases/download/v0.2.7`），而 `main/remoteCdn.ts` 又无条件追加了一次版本，
  拼出 `.../download/v0.2.7/0.2.7`（实测 404，正确路径 200）。
  0.2.5 的防线（判「根是否存在」）对此完全无效，因为它判的是存在性不是可用性。
  已修：判定收敛为 server 侧唯一实现 `isReleaseRootAlreadyVersioned`，main 侧复用；
  `release-gate.mjs` 增加「根不得自带重复版本段」+ 发版前真实拉一次 descriptor。
  另暴露一个流程缺陷：0.2.6 的远程连接验证项当时是**未验**状态，等于这条链路从未真跑过。

**判「根存在」永远不等于「根可用」。** 每当远程资产链路的注入形态或消费侧拼接改动，
必须真实连一次远端。

## 远程连接（Source Server）发布要求

远程连接的可用性**不只看 Desktop 版本**，还依赖两件事同时成立：

1. **安装包内有可访问的远程资产发布根**。构建时必须注入其一：
   - `REMOTE_ASSET_RELEASE_ROOT_URL`：完整 URL 根，用于 GitHub Release 这类托管形态
     （形如 `https://github.com/<owner>/<repo>/releases/download/v<version>`）；
   - `CDN_DOMAIN` + `OSS_PATH_PREFIX`：自建 CDN/OSS 形态。
   两源皆空时产物内没有发布根，远程连接必然失败——`release-gate.mjs` 会直接拒绝发版。
2. **该发布根下有当前版本的 `source-server-release.json` 与四个平台 tar.gz**
   （`linux-x64` / `linux-arm64` / `darwin-x64` / `darwin-arm64`）。
   生成入口：`pnpm --filter @raspberrycode/server-cli run stage:remote-assets`
   （只做 Linux 时加 `--linux`），产物落在 `packages/desktop/mock-cdn/releases/<version>/`，
   发版时需随 Release 一起上传。

> `minCompatibleVersion` 默认回退为当前 `productVersion`，语义是「只承诺同版本兼容」。
> 因此**每发一个新版本，旧版本的远端都必须能升级到新版本**，否则远端会被判为必须升级却无包可下。
> 这条前提成立的条件就是上面的第 1、2 点都做到。

### GitHub Release 托管时的完整发版步骤

```bash
# 1. 生成远程资产（约 17 分钟；Linux 加 --linux，全平台约 350MB）
pnpm --filter @raspberrycode/server-cli run stage:remote-assets

# 2. 构建时注入发布根，指向本版本的 Release 下载目录
REMOTE_ASSET_RELEASE_ROOT_URL=https://github.com/ShiZiMiao/RaspberryCode/releases/download/v<version> \
  pnpm --dir packages/desktop run build

# 3. 打包后把远程资产一并上传到同一个 Release
gh release upload v<version> --repo ShiZiMiao/RaspberryCode \
  packages/desktop/mock-cdn/releases/<version>/source-server-release.json \
  packages/desktop/mock-cdn/releases/<version>/raspberrycode-server-*.tar.gz
```

### 下载镜像

**客户端自更新**与**远程资产下载**是两条链路，**共用同一个默认镜像前缀**：

| 链路 | 实现 | 覆盖范围 |
| --- | --- | --- |
| 客户端自更新 | `packages/desktop/src/main/autoUpdate/updateMirror.ts` | `github.com/<o>/<r>/**` 全站（含 `releases.atom`） |
| 远程资产 | `packages/server/src/remote/remoteAssetCdn.ts` 的 `withGithubMirror` | `releases/download/...` |

**默认镜像的唯一事实源**：`packages/shared/src/client-update/contract.ts` 的
`DEFAULT_UPDATE_MIRROR_PREFIX`（`https://gh-proxy.org/`）。两边都从这里取，改一处即两边生效。

为什么要共用：两条链路是两个包、两个进程、两套网络栈（前者走 Electron `webRequest`，
后者走 Host 子进程 undici，`Session.setProxy` 影响不到它），代码无法复用，
但面对的是同一个网络问题、同一批镜像。各维护一份必然出现
「客户端已切到新镜像、远程升级还在用旧镜像」的错位。

共同语义是**镜像在前、直连兜底在后，绝不把镜像作唯一候选**。
客户端自更新的回退链路固定为 `mirror → direct → manual`。

默认镜像 `https://gh-proxy.org/` 在 2026-11-26 实测通过三项硬条件：
1. 能代理 `releases.atom` 且响应体是真实 Atom XML（含 `<feed>`）；
2. 支持单 Range（206 且长度等于请求区间）；
3. 能正确返回含 `version` + `sha512` 的 `latest.yml`。

镜像失效时用户可在设置里覆盖 `updateMirrorPrefix`（空串 = 只走直连），
无需发版。不再维护发版前探测与候选列表。

## 发版检查清单

1. 确认变更类别 → 决定升哪一位（见上表）。
2. **去掉 rc 段**：`0.2.8-rc.3` → `0.2.8`。同时改
   `packages/desktop/package.json` 与根 `package.json` 的 `version`。
   这是唯一一次移除 rc 的时机；发版后不得再出现 rc 段。
3. **重新生成构建元数据**：`pnpm --dir packages/desktop run prepare:build-meta`。
   跳过这步会打出旧版本号的包 —— `extraMetadata.version` 读的是
   `out/metadata/build-meta.json` 缓存，不是 package.json。
   **从 rc 改成正式版号后必须重跑**，否则产物里仍是 rc 版本号。
4. **完整构建**：`pnpm --dir packages/desktop run build`（= 运行时资产 +
   build-meta + `run-production-build.mjs` 真正编译）。
   **只跑 electron-builder 不会编译 TS**，会拿旧 `out/` 打包。
   构建前必须设置远程资产发布根（见上一节），否则门禁会拒。
5. 跑门禁：`pnpm release:gate`（含 typecheck / lint / audit-neutrality）。
   `--quick` 会跳过自动门禁，仅用于查产物一致性，
   **正式发版必须无 `--quick` 跑一次**。
6. 构建安装包（见项目记忆的打包定式）。
7. **真实安装与升级实测**（不可跳过）：
   - 卸载旧版 → 装新版 → 版本号正确
   - 开始菜单 + 桌面快捷方式存在且能启动
   - 旧版 → 检查更新 → 下载 → 安装 → 重启 → 版本号变新
8. **主要功能以用户视角逐项点过**：新建对话收发消息、文件编辑、终端、
   设置页、MCP/技能/插件、自动化。UI 改动必须看真实截图。
9. 打 tag `v<version>` 并推送；创建 GitHub Release，**必须上传三个资产**：
   - `RaspberryCode-<version>-win-x64.exe`
   - `RaspberryCode-<version>-win-x64.exe.blockmap`（差量更新用）
   - `latest.yml`（自更新清单）
7. 发布后自查：`latest.yml` 里的 `version` 与 tag 一致、`sha512` 与实际文件匹配。

> 自更新链路依赖以上三个资产齐全。缺 `.blockmap` 会退化为整包下载（功能不受影响）；
> 缺 `latest.yml` 则**完全无法检查更新**。

## 变更记录

| 日期 | 版本 | 类型 | 说明 |
| --- | --- | --- | --- |
| 2026-11-09 | `0.1.0` | 首个版本 | 公开发布 |
| 2026-11-12 | `0.2.0` | MINOR（同步上游） | 同步 ZCode v3.17.2；另含自更新下载镜像三级回退、E2E 锁清理修复、dev 端口改 6174、版本约定确立 |
| 2026-11-13 | `0.2.1` | PATCH（自有修复） | 修复自更新下载链路：镜像重定向改到 updater 自己的 partition session、按阶段切换代理（镜像直连／直连走系统代理）、检查阶段失败也可降级且降级路线不再被重复错误重置；补齐 Electron 44 剪贴板 API |
| 2026-11-13 | `0.2.2` | PATCH（自有修复） | 修复 Windows 安装后不创建快捷方式：安装段强制重置 keepShortcuts，避免重装/升级时开始菜单与桌面快捷方式被清空 |
| 2026-11-17 | `0.2.3` | PATCH（自有修复） | 修复 Windows 无符号链接权限时无法出包；「检查更新」加超时兜底与失败反馈；回收未完成握手的任务占位行；renderer 跨 HMR 复用单一 React root；任务右键菜单新增删除；上下文来源占比与模型用时统计 |
| 2026-11-17 | `0.2.4` | PATCH（品牌） | 产品图标更换为粉彩透明版（树莓 + 绿叶 + 星环）：全部槽位透明无背板；启动动画、标题栏、关于弹窗、DMG 安装背景同步 |
| 2026-11-18 | `0.2.5` | PATCH（自有功能） | 输入框「增强提示词」（三态 idle/pending/undo，走 workspace/generateText）；轮尾「重新生成」入口与本轮用量 chip（`turnHeader.usage`，live/cold 双路径归约，缺席不落 0） |
