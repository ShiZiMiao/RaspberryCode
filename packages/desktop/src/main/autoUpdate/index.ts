/**
 * client-update-runtime 公共入口（architecture-governance managed 模块）。
 * 状态机实现见 autoUpdateService.ts，端口契约见 contract.ts 与 CONTRACT.md。
 */
export * from "./autoUpdateService.js";
export type {
  AutoUpdaterLike,
  GithubFeedOptions,
  InitAutoUpdateServiceOptions,
  SettingServiceLike,
} from "./contract.js";
