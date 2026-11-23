# client-update-runtime

客户端 GitHub 自更新的 desktop main 运行时（spec：specs/client-github-self-update.md）。
更新状态机（idle → checking → update-available → download-progress → update-downloaded）
的唯一所有者。

- `autoUpdateService.ts` 持有状态机与安装目标锁；IPC 命令（desktopMainIpcPlatform）与
  桌面命令（desktopCommandHandlers.CheckForUpdates）都只经本模块公共函数下发，不自建状态。
- `contract.ts` 是可注入端口：electron-updater 最小面（AutoUpdaterLike）与 setting.json
  读写面（SettingServiceLike）；生产由 index.ts 组装注入，测试注入假实现。
- 更新源：GitHub Releases（electron-updater github provider），默认仓库
  ShiZiMiao/RaspberryCode，设置字段 `updateFeedGithubOwner/Repo` 可覆盖，空值回退默认。
- 仅打包态（app.isPackaged）启用；开发态降级为 enabled=false，手动检查返回 dev-skipped。
- 退出安装顺序固定：锁安装目标 → onBeforeQuitAndInstall（稳定性标记 + 退出屏障 +
  win32 资源锁清理）→ autoUpdater.quitAndInstall()；退出准备失败不得启动安装器。
- 偏好与跳过版本的持久化唯一所有者是 SettingService（setting.json）；跳过版本单通道
  语义写入 skippedElectronUpdateVersions.stable。
- 下载镜像（产品规则 10）：mirror → direct → manual 三级回退，`updateMirror.ts` 是纯函数
  与状态机，`updateMirrorSession.ts` 负责 webRequest 接线。**mirror 阶段重写 github.com
  全站**（不只 /releases/download/），因为检查阶段第一条是 `releases.atom`，只拦下载会让
  无代理用户在第一条就超时。
- **镜像前缀不写死**：由 `AppSettings.updateMirrorPrefix` 提供，`updateMirrorSession` 通过
  `getMirrorPrefix()` 每次请求动态读取。三态语义：undefined = 用内置候选列表；
  `""` = 禁用镜像只走直连；非空 = 只用指定的一家。第三方公益镜像不稳定，
  改配置即可切换而无需发版。
- **候选列表的事实源已上移到 shared**（2026-11-23）：
  `packages/shared/src/client-update/contract.ts` 的 `DEFAULT_UPDATE_MIRROR_CANDIDATES`。
  `updateMirror.ts` 只是 `export ... from "@raspberrycode/shared/client-update"` 重新导出，
  **不要在这里重新定义一份**。原因：远程资产下载
  （`packages/server/src/remote/remoteAssetCdn.ts`）面对同一个网络问题但代码不能复用，
  各写一份必然错位（历史上它固定写着 `ghfast.top`，早已失效）。
  发版前重跑探测时只改 shared 那一处。
- 备用分发通道（CNB）的设计约束见 `docs/update-distribution-platform-evaluation.md`
  第 3.1.1 节与 spec 产品规则 11，当前未实现。
- **手动检查在自动下载空窗期返回 `downloading` 而非 `available`**（2026-11-23 对齐上游）：
  `downloadAvailableUpdate` 同步设置 `downloadingVersion` 但不同步改 state，
  `download-progress` 事件到达前 state 仍是 `update-available`。
  若据此返回 `available`，用户会看到「发现新版本」而系统其实已在后台下载。
- **main 侧不得在自动更新模式下篡改对外投影的状态**（2026-11-23）：
  原生菜单必须用真实 `updateState` 调用 `updateCheckForUpdateMenuState`，
  **不要**再写成 `isAutoUpdateMode() ? { kind: "idle" } : updateState`。
  静默的边界是「不主动弹窗打扰」，不是「把状态藏起来」——藏了状态会让用户在
  发现更新后找不到任何入口。renderer 侧对应约束见
  `packages/ui/test/useAppChromeStateAutoUpdate.test.ts` 的「更新入口不再被静默模式掩蔽」。
