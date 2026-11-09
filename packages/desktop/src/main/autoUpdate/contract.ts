/**
 * client-update-runtime 模块契约（spec：specs/client-github-self-update.md）。
 *
 * 更新状态机的可注入端口：生产注入 electron-updater 单例与 mainSettingService，
 * 测试注入假实现。行为实现见 autoUpdateService.ts（状态机唯一所有者）。
 */
import type {
  CancellationToken,
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo,
} from "electron-updater";
import type { AppSettings, UpdateStatePayload } from "@raspberrycode/shared";

/** electron-updater GitHub provider 的最小配置面（运行时 setFeedURL 覆盖打包期 publish）。 */
export interface GithubFeedOptions {
  provider: "github";
  owner: string;
  repo: string;
  releaseType: "release";
  /**
   * 差量下载 Range 策略。GitHub 资产存储不支持 multipart/byteranges，多 Range 会回退整包；
   * 恒为 false（单 Range 顺序差分）。electron-updater 的 github 分支忽略该字段，
   * 实际开关由运行时的 createProviderRuntimeOptions 补丁强制（见 autoUpdateService.ts）。
   */
  useMultipleRangeRequest?: false;
}

/** 可注入的 electron-updater 最小接口；生产传内置单例，测试传假实现。 */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  setFeedURL(options: GithubFeedOptions): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(cancellationToken?: CancellationToken): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-available", listener: (info: UpdateInfo) => void): unknown;
  on(event: "update-not-available", listener: (info: UpdateInfo) => void): unknown;
  on(event: "download-progress", listener: (progress: ProgressInfo) => void): unknown;
  on(event: "update-downloaded", listener: (event: UpdateDownloadedEvent) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/** setting.json 读写端口（偏好与跳过版本的唯一持久化所有者是 SettingService）。 */
export interface SettingServiceLike {
  get(): Promise<AppSettings>;
  update(patch: Partial<AppSettings>): Promise<unknown>;
}

export interface InitAutoUpdateServiceOptions {
  settingService: SettingServiceLike;
  /** 退出安装前置准备（稳定性标记 + 退出屏障 + win32 资源锁清理）；失败不得启动安装器。 */
  onBeforeQuitAndInstall?: () => void | Promise<void>;
  /** 状态快照广播（index 负责同步窗口与原生菜单标签）。 */
  broadcastState?: (state: UpdateStatePayload) => void;
  /** 测试注入；生产缺省使用 electron-updater 单例。 */
  updater?: AutoUpdaterLike;
  /** 测试注入；生产缺省 app.isPackaged。仅打包态启用更新。 */
  isPackaged?: boolean;
  /** 测试注入；生产缺省 app.getVersion()。 */
  currentVersion?: string;
  /** 启动静默检查延迟；测试注入 0。 */
  silentCheckDelayMs?: number;
}
