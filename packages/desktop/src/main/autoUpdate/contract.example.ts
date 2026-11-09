import type {
  AutoUpdaterLike,
  InitAutoUpdateServiceOptions,
  SettingServiceLike,
} from "./contract.js";

/**
 * 端口用法示例：组装一次初始化选项（真实组装在 index.ts）。
 * 仅作类型示范（contract.example.ts 参与类型检查，不进入运行时）。
 */
export function exampleInitOptions(
  settingService: SettingServiceLike,
  updater: AutoUpdaterLike,
): InitAutoUpdateServiceOptions {
  return {
    settingService,
    updater,
    isPackaged: true,
    silentCheckDelayMs: 10_000,
  };
}
