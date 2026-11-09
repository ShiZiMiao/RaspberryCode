# 客户端 GitHub 自更新（Client Self-Update via GitHub Releases）

## 背景

旧版桌面端自动更新走厂商服务端 manifest（`GET /api/v1/releases/electron/manifest`）+ electron-updater
自定义 provider，携带灰度通道（stable/preview）与强更门禁，随订阅体系一并拆除
（`4eae94cc` 拆除自动更新/强更门禁，`4d5afb0f` 清除残留与构建期开关，`8884a611` 拆除更新 UI）。

现恢复客户端更新功能，但更新源改为 **GitHub Releases**（electron-updater 内置 `github` provider），
不再依赖厂商服务端 manifest、灰度通道和强更门禁。默认交互为**静默自动更新**：
「自动更新」开关默认开启，启动检查、后台差量下载、退出静默安装、下次启动生效，全程无感；
关闭开关则退回手动模式（标题栏更新入口 + 更新弹窗）。不恢复独立更新窗口、post-update
release notes 展示与「桌面端过旧」强更提示。

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
     顺序差分）→ 应用退出时静默安装（NSIS `install(true, false)`，不拉起应用）→
     **用户下次启动即新版本**。全程无感：不渲染标题栏更新入口、菜单保持静态「检查更新」、
     不弹下载完成 toast；失败只落日志不打扰。
   - **关闭（手动模式）**：发现更新出标题栏绿色入口，点击打开更新弹窗：版本号、发布日期、
     release notes（GitHub release 正文 Markdown，下载中隐藏）；操作：下载更新 / 取消下载 /
     跳过此版本 / 稍后 / 重启以更新；附「以后自动下载并安装更新」勾选（即重新打开本开关）。
     重启前若有进行中的 agent 会话，先经确认弹窗。
6. **手动检查**（菜单点击或设置页按钮，任意模式可用）：向发起窗口推送 `UpdateCheckResult`
   toast：已是最新 / 发现新版本 / 正在下载 / 已就绪 / 开发态跳过 / 检查失败。
7. **跳过版本**：写入 `skippedElectronUpdateVersions.stable`（单通道语义，复用既有字段）；
   检查命中跳过版本按「无更新」处理（静默模式同样生效）；设置页可清除跳过记录。
   **差量下载**依赖 GitHub Release 资产中的 `.blockmap`；资产缺失时 electron-updater
   自动回退整包下载（功能不变，仅失去增量）。
8. **重启安装时序**：`quitAndInstallUpdate` 先进入退出准备
   （`notifyStabilityLifecycle("update_install")` → `prepareAppQuit(…, "update-install")` →
   win32 追加 `prepareWindowsProcessesForUpdateInstall` 资源锁清理），全部成功后才调用
   `autoUpdater.quitAndInstall()`；退出准备失败不得启动安装器，报错并恢复按钮态。
   迟到的检查/下载结果不得替换已锁定的安装目标（`quitAndInstallState !== "idle"` 时忽略）。
9. **中立性**：更新链路无遥测上报、无强更、无灰度、无厂商域名；GitHub 仓库地址仅作为
   用户可配的更新源，不引入其他外部服务。

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
10. 重启安装前退出准备失败（如资源锁清理异常被上抛）→ 不启动安装器，弹窗按钮恢复可点。
11. `pnpm typecheck`、`pnpm lint` 通过；更新状态机/跳过版本/feed 解析/自动模式缓存/
    弹窗视图模型有单测覆盖。
