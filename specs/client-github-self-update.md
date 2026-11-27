# 客户端 GitHub 自更新（Client Self-Update via GitHub Releases）

## 背景

旧版桌面端自动更新走厂商服务端 manifest（`GET /api/v1/releases/electron/manifest`）+ electron-updater
自定义 provider，携带灰度通道（stable/preview）与强更门禁，随订阅体系一并拆除
（`4eae94cc` 拆除自动更新/强更门禁，`4d5afb0f` 清除残留与构建期开关，`8884a611` 拆除更新 UI）。

现恢复客户端更新功能，但更新源改为 **GitHub Releases**（electron-updater 内置 `github` provider），
不再依赖厂商服务端 manifest、灰度通道和强更门禁。默认交互为**静默自动更新**：
「自动更新」开关默认开启，启动检查、后台差量下载、退出安装、下次启动生效；
**静默指不主动弹窗打扰，不等于隐藏状态入口**——标题栏更新入口与菜单标签照常反映真实状态
（见产品规则 5 的「静默的边界」）。关闭开关则退回手动模式（标题栏更新入口 + 更新弹窗）。
不恢复独立更新窗口、post-update release notes 展示与「桌面端过旧」强更提示。

## 产品规则

1. **更新源**：GitHub Releases。默认仓库 `ShiZiMiao/RaspberryCode`；设置页可改 owner/repo
   （仅支持公开仓库；留空恢复默认值）。只消费正式 release，忽略 draft 与 prerelease。
2. **启用条件**：仅打包态（`app.isPackaged`）启用检查与下载。开发态更新器不初始化：
   静默检查不执行，手动检查返回「开发环境不检查更新」。
3. **状态机**（main 进程单一所有者）：
   `idle → checking → update-available → download-progress → update-downloaded`；
   检查无更新回 `idle`；任何错误回 `idle` 并落 `warn` 日志。状态经 `UpdateStateChanged`
   广播到所有窗口，renderer 只持有订阅快照。
4. **更新入口**：`update-available` / `download-progress` / `update-downloaded` 期间，
   标题栏显示绿色更新入口（`UpdateStatusButton`），点击打开更新弹窗；原生帮助菜单
   「检查更新」项在各状态下更新标签（正在检查/发现新版本/正在下载/重启以更新）。
5. **「自动更新」开关**（`autoDownloadAndInstallUpdates`，**默认开启**）：
   - **开启（静默自动模式）**：启动静默检查 → 发现更新后台自动**差量下载**（blockmap 单 Range
     顺序差分）→ 应用退出时安装 → **用户下次启动即新版本**。
     **静默的边界（2026-11-23 修正）**：静默指「不主动弹窗打扰」——不弹更新弹窗、
     不弹下载完成 toast；但**状态入口必须可见**：标题栏绿色入口照常渲染（可查看进度、
     可取消），原生菜单标签跟随真实状态（发现新版本 / 正在下载 / 重启以更新）。
     修正前的实现把 `visibleUpdateState` 在自动模式下整体置空、菜单强制成 `idle`，
     叠加「手动检查报 available」就形成用户反馈的「发现新版本了，然后呢？」——
     提示存在但三处都无入口可点。该实现在 0.2.8 起废弃。
   - **关闭（手动模式）**：发现更新出标题栏绿色入口，点击打开更新弹窗：版本号、发布日期、
     release notes（GitHub release 正文 Markdown，下载中隐藏）；操作：下载更新 / 取消下载 /
     跳过此版本 / 稍后 / 重启以更新；附「以后自动下载并安装更新」勾选（即重新打开本开关）。
     重启前若有进行中的 agent 会话，先经确认弹窗。
6. **手动检查**（菜单点击或设置页按钮，任意模式可用）：向发起窗口推送 `UpdateCheckResult`
   toast：已是最新 / 发现新版本 / 正在下载 / 已就绪 / 开发态跳过 / 检查失败。
   **自动模式下的语义（2026-11-23 对齐上游 RaspberryCode）**：若本次检查已触发自动下载
   （`downloadingVersion` 已设置），结果必须返回 `downloading` 而**不是** `available`。
   原因：自动下载是异步发起的，`download-progress` 事件尚未到达时状态仍是
   `update-available`，直接映射成 `available` 会误报「发现新版本」，让用户以为要手动操作，
   而系统其实正在后台下载。上游在自动分支里只发下载请求、不发 `available` 结果，本实现对齐该语义。
7. **跳过版本**：写入 `skippedElectronUpdateVersions.stable`（单通道语义，复用既有字段）；
   检查命中跳过版本按「无更新」处理（静默模式同样生效）；设置页可清除跳过记录。
   **差量下载**依赖 GitHub Release 资产中的 `.blockmap`；资产缺失时 electron-updater
   自动回退整包下载（功能不变，仅失去增量）。
8. **重启安装时序**：`quitAndInstallUpdate` 先进入退出准备
   （`notifyStabilityLifecycle("update_install")` → `prepareAppQuit(…, "update-install")` →
   win32 追加 `prepareWindowsProcessesForUpdateInstall` 资源锁清理），全部成功后才调用
   `autoUpdater.quitAndInstall()`；退出准备失败不得启动安装器，报错并恢复按钮态。
   迟到的检查/下载结果不得替换已锁定的安装目标（`quitAndInstallState !== "idle"` 时忽略）。

   **NSIS 安装界面（Windows，2026-11-23 用户要求）**：
   更新时的安装器**只显示进度页与完成页**，不出现需要逐页点「下一步」的向导
   （不询问「为所有用户 / 仅为我安装」、不询问安装目录）。
   用户唯一需要操作的是最后一页点「完成」。

   实现约束（三层，缺一不可）：
   - **不用 `quitAndInstall(true)`**：那是 NSIS 的 `/S` 完全静默，连进度条和完成页都不显示，
     应用退出后用户看不到任何反馈，会误以为崩溃。必须保留 `isSilent=false`。
   - **`oneClick:false` + `allowToChangeInstallationDirectory:true` 保持不动**：
     这是首次安装需要向导（选目录）的前提；更新时靠 `${isUpdated}` 跳过。
   - **补上安装模式页的跳过**：electron-builder 已给目录页包了 `skipPageIfUpdated`，
     但 `PAGE_INSTALL_MODE` 没有，更新时会多出一页。
     因此通过 `scripts/patch-nsis-assisted-installer.mjs` 在打包期给该页补同一个宏
     （`${isUpdated}` 为真时 Abort），打包结束后恢复上游模板。
     该 patch 锚点匹配失败时安全降级（不改文件），不阻断构建。
9. **中立性**：更新链路无遥测上报、无强更、无灰度、无厂商域名；GitHub 仓库地址仅作为
   用户可配的更新源，不引入其他外部服务。
10. **下载镜像与三级回退**：
    - **动机**：GitHub Releases 的元数据与下载域名在部分网络下不可用或极慢。
      **检查阶段同样需要镜像**：electron-updater 的 github provider 每次检查要发三条请求
      （`releases.atom`、`releases/latest`、`releases/download/<tag>/latest.yml`），
      只拦下载会让无代理用户在第一条就超时。
    - **路线顺序**：`mirror`（默认 `https://cdn.akaere.online/`，前缀 + 完整原 URL 形态）
      → `direct`（原站直连，等同改造前行为）→ `manual`（不再自动下载，UI 给「手动下载」）。
    - **默认镜像固定为 `https://cdn.akaere.online/`**（2026-11-26 实测）：四项硬条件全部通过
      （atom 返回真实 XML、`releases/latest` 带 `Accept: application/json` 返回含 `tag_name`
      的 JSON、单 Range 206、latest.yml 含 version + sha512）。不再维护发版前探测与候选列表。
      > 0.2.9 回归教训：`gh-proxy.org` 对 `releases/latest` 返回镜像首页 HTML，
      > GitHubProvider 解析 JSON 失败，检查更新直接报错。选镜像必须实测这一条，
      > 只看状态码 200 不够。
    - **重写范围**：`mirror` 阶段拦截 **`github.com` 全站**请求（不再只限
      `/releases/download/`），以同时覆盖 `releases.atom` 与 `releases/latest`。
      安全性依据：`GitHubProvider` 只用 `github.com` 域（atom / latest / download），
      全程不访问 `api.github.com`，故放宽范围不会误伤任何 API 请求。
      `direct` 阶段不重写，行为回到改造前。
    - **镜像可配置**：由 setting.json 的 `updateMirrorPrefix` 提供，三态语义：
      `undefined` = 用默认镜像；`""` = 禁用镜像只走直连；非空串 = 只用指定的一家。
      镜像失效时改配置即可切换而无需发版。
    - **唯一事实源是 shared**：常量定义在
      `packages/shared/src/client-update/contract.ts` 的 `DEFAULT_UPDATE_MIRROR_PREFIX`，
      **客户端自更新与远程资产下载（Source Server 包）共用同一份**。
      理由：两者是两个包、两个进程、两套网络栈（前者走 Electron `webRequest`，
      后者走 Host 子进程 undici，`Session.setProxy` 影响不到它），代码无法复用，
      但它们面对的是同一个网络问题、同一批镜像。各维护一份必然出现
      「客户端已切到新镜像、远程升级还在用旧镜像」的错位。
    - **触发降级**：检查阶段与下载阶段的失败都参与降级（检查失败不再只报错，
      而是换下一级重试）；但一旦收到有效字节即锁定当前路线，避免中途换源拼坏文件。
    - **实现位置**：不改 electron-updater 内部（其下载 URL 由 baseUrl 拼装，`resolveFiles`
      私有、`createClient` 不可注入，无法靠配置接入路径前缀式镜像）。改在 Electron
      `session.webRequest.onBeforeRequest` 重写请求。
    - **代理与阶段匹配**：实测镜像直连可用、经系统代理可能不可达，而 `github.com`
      在部分网络下需要代理。因此按阶段切换 updater session 代理：
      `mirror` → direct，`direct` → system。
    - **手动兜底**：各级都失败时 `update-available` 携带 `manualDownloadRequired: true` 与
      `manualDownloadUrl`（release 详情页而非资产直链），弹窗把「下载更新」替换为「手动下载」，
      交由浏览器/下载工具打开。
11. **CNB 备用通道（预留，暂不启用）**：国内自控分发路线已调研完成
    （见 `docs/update-distribution-platform-evaluation.md` 第 3.1.1 节）。要点：
    腾讯云 CNB 的 Release 附件支持匿名下载与单 Range 差量（206），速度约 5MB/s，
    计费不含下载流量。接入时改走 `generic` provider、清单放仓库 raw 目录、
    发布脚本须把资产写成绝对 URL（相对路径会解析到 raw 目录导致 404）。
    该通道作为镜像方案失效时的备选，当前**不实现**，仅记录设计约束。

## 状态所有者

| 状态 | 唯一所有者 | 其他层的访问方式 |
| --- | --- | --- |
| 更新状态机（idle/checking/available/progress/downloaded） | `packages/desktop/src/main/autoUpdateService.ts` | IPC 只读快照 + `UpdateStateChanged` 广播 |
| 偏好（autoDownloadAndInstallUpdates / skippedElectronUpdateVersions / updateFeedGithub*） | SettingService（setting.json） | 经 autoUpdateService 读写，IPC 命令转发 |
| renderer 更新快照 | `useAppChromeState`（订阅缓存） | 派发给 `WorkspaceShellLayout` → `UpdateStatusButton` |
| 弹窗交互锁（下载/取消/跳过/重启 in-flight） | `UpdateStatusDialogController` 组件内 | 不外溢；按 `updateState.kind` 收口 |

## 接口契约

- **shared 类型**（`packages/shared/src/platformUpdate.ts`）：
  `UpdateStatePayload`、`UpdateCheckResultPayload`、`PostUpdateReleaseNotesPayload`、
  `AutoUpdatePreferences`。`download-progress` 携带 `progress`(0-100) 与可选
  `transferredBytes`/`totalBytes`。
- **设置字段**（AppSettings）：新增 `updateFeedGithubOwner?`、`updateFeedGithubRepo?`
  （空/缺省 → 默认 `ShiZiMiao/RaspberryCode`）；复用 `autoDownloadAndInstallUpdates`、
  `skippedElectronUpdateVersions`。`receivePreviewUpdates`、`pendingPostUpdateReleaseNotes`
  保留为磁盘兼容字段，无生产读写路径。
- **IPC（PlatformChannels）**：
  `GetUpdateState`（invoke→UpdateStatePayload）、`DownloadUpdate`、`CancelUpdateDownload`、
  `QuitAndInstallUpdate`、`SkipUpdateVersion`（version）、`GetAutoUpdatePreferences`、
  `SetAutoDownloadAndInstallUpdates`（boolean）、`SetUpdateFeedGithub`（owner/repo）、
  `UpdateStateChanged` / `UpdateCheckResult`（main→renderer 推送）。
- **IPlatformService（可选方法，仅 Desktop 实现）**：
  `getUpdateState`、`onUpdateStateChanged`、`onUpdateCheckResult`、`downloadUpdate`、
  `cancelUpdateDownload`、`skipUpdateVersion`、`quitAndInstallUpdate`、
  `getAutoUpdatePreferences`、`setAutoDownloadAndInstallUpdates`、`setUpdateFeedGithub`。
- **桌面命令**：`DesktopCommandIds.CheckForUpdates`（菜单与设置页共用；结果走
  `UpdateCheckResult` 推送，不与启动静默检查混用）。

## 验收场景

1. **默认（自动更新开）**：打包态启动且 GitHub 有新版本 → 后台静默差量下载 → 正常退出时
   静默安装 → **下次启动 `app.getVersion()` 为新版本**；全程无更新入口、无动态菜单、无 toast。
2. 自动模式下手动点「检查更新」→ toast 正常反馈（正在下载/已就绪等用户主动查询结果）。
3. 关闭「自动更新」→ 发现更新出标题栏入口；点击弹窗展示版本/发布日期/更新日志；
   「下载更新」出进度；「重启以更新」完成安装后为新版本。
4. 弹窗「跳过此版本」→ 入口消失；再次手动检查同版本不提示；设置页清除跳过后恢复提示；
   跳过在自动模式下同样生效（该版本不再静默下载）。
5. 手动检查的六种结果 toast 正确（已是最新/发现新版本/正在下载/已就绪/开发态/失败）。
6. 开发态：无静默检查、无更新入口；手动检查 toast「开发环境不检查更新」。
7. 设置页修改 owner/repo 后检查走新仓库；非法输入（空格、URL、超长）被校验拒绝；
   「恢复默认」回到 `ShiZiMiao/RaspberryCode`。
8. Release 资产含 `.blockmap` 时走单 Range 差量（日志可见 differential download）；
   缺失时回退整包下载。
9. 断网/仓库无 release/版本号不可比：更新状态回 idle，日志有 warn，UI 无残留入口，不崩溃。
   **含 rc 预发布段的构建属此列**：rc 版本走 `allowPrerelease=true` + channel=`rc`，
   而 atom 里没有 rc 条目，必然抛 `ERR_UPDATER_NO_PUBLISHED_VERSIONS`。
   这是预期行为（rc 是开发版，不该给自己推更新），按本条回归 idle 即可，不要加兜底分支。
   版本号规则见 `docs/versioning.md` 的「未发版的进行中版本用 `-rc.N`」。
10. 重启安装前退出准备失败（如资源锁清理异常被上抛）→ 不启动安装器，弹窗按钮恢复可点。
11. `pnpm typecheck`、`pnpm lint` 通过；更新状态机/跳过版本/feed 解析/自动模式缓存/
    弹窗视图模型有单测覆盖。
