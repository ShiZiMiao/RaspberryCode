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
