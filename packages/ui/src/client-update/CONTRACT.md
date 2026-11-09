# client-update-ui

客户端 GitHub 自更新的 UI 层（spec：specs/client-github-self-update.md）。

- `contract.ts` 是纯视图模型契约：把 `UpdateStatePayload` 折算为弹窗阶段、版本显示、
  进度文案与可跳过版本；不持有状态事实，不发 IPC。
- `UpdateStatusButton` 是标题栏更新入口（仅 update-available / download-progress /
  update-downloaded 期间渲染），点击打开 `UpdateStatusDialogController` 管理的内嵌弹窗。
- `UpdateStatusDialog` 为纯展示组件；`UpdateStatusDialogController` 持有弹窗交互锁
  （下载/取消/跳过/重启 in-flight），命令一律经 `IPlatformService` 可选更新 API 下发，
  状态收口完全跟随 main 的 `UpdateStateChanged` 广播，不作乐观切换。
- `UpdateSettingsSection` 是设置页「更新」区块（检查更新/自动下载偏好/跳过版本/更新源仓库），
  偏好写入 setting.json（唯一持久化所有者），桌面限定渲染。
- 入口/弹窗文案键在 i18n locales 的 `update.*` / `updateReady.*` / `updateDialog.*` /
  `settings.update.*` 命名空间。
