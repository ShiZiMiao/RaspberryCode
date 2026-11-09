# client-update-contract

客户端 GitHub 自更新的跨进程类型契约（spec：specs/client-github-self-update.md）。
纯类型与常量，不含行为与 IO。

- `UpdateStatePayload` 是更新状态机快照；事实唯一所有者是 desktop main 的
  auto-update 运行时模块，renderer 只持有订阅副本。
- `UpdateCheckResultPayload` 仅供手动「检查更新」的结果 toast，不与静默检查混用。
- `AutoUpdatePreferences` 是偏好读写载荷；持久化事实由 SettingService（setting.json）持有。
- `DEFAULT_UPDATE_FEED_GITHUB` 是默认更新源仓库，与设置字段 `updateFeedGithub*` 的
  空值回退语义一致。
- 本契约自包含（Locale 与 shared protocol 结构同构），供 shared channels/platform、
  desktop 运行时与 ui 模块共同引用。
