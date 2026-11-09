/**
 * 客户端 GitHub 自更新契约（spec：specs/client-github-self-update.md）。
 *
 * 状态机唯一所有者是 desktop main 的 autoUpdateService；本文件只定义
 * main ↔ renderer 之间传输的只读快照与命令结果类型，不含任何行为。
 * 契约自包含（不引用 legacy shared），与 shared 的 Locale 保持结构同构。
 */

type Locale = "zh-CN" | "en-US";

/** 更新日志载荷；GitHub 方案下正文来自 release body，标题来自 release name。 */
export interface PostUpdateReleaseNotesPayload {
  version: string;
  title: string;
  markdown: string;
  releaseDate?: string;
  releaseNotesByLocale?: Partial<
    Record<Locale, { title: string; markdown: string }>
  >;
}

/**
 * 用户手动点击「检查更新」后，main 进程回传给 renderer 的结果。
 * Renderer 根据 kind 展示对应的 toast；不要与启动时的自动 check 混用。
 */
export type UpdateCheckResultPayload =
  | { kind: "up-to-date"; currentVersion: string }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string }
  | { kind: "already-downloading"; version: string; progress: string }
  | { kind: "ready"; version: string }
  | { kind: "dev-skipped" }
  | { kind: "error"; message: string };

/**
 * 桌面自动更新器的持续状态快照，用于同步原生菜单和标题栏更新入口。
 * `enabled: false` 表示当前运行态不可更新（如开发态），入口与菜单命令均禁用。
 */
export type UpdateStatePayload =
  | { kind: "idle"; enabled: boolean }
  | { kind: "checking"; enabled: boolean }
  | {
      kind: "update-available";
      enabled: boolean;
      version: string;
      releaseNotes?: PostUpdateReleaseNotesPayload;
    }
  | {
      kind: "download-progress";
      enabled: boolean;
      /** 0-100 的下载百分比（electron-updater percent 取整）。 */
      progress: number;
      version?: string;
      transferredBytes?: number;
      totalBytes?: number;
      releaseNotes?: PostUpdateReleaseNotesPayload;
    }
  | {
      kind: "update-downloaded";
      enabled: boolean;
      version: string;
      releaseNotes?: PostUpdateReleaseNotesPayload;
    };

/** 自动更新偏好；读写均经 autoUpdateService → SettingService 落盘。 */
export interface AutoUpdatePreferences {
  /** 发现更新后自动下载并随退出安装。 */
  autoDownloadAndInstallUpdates: boolean;
  /** 用户「跳过此版本」记录的版本号（单通道语义）。 */
  skippedUpdateVersion: string | null;
  /** GitHub 更新源；空字符串表示使用默认仓库。 */
  updateFeedGithubOwner: string;
  updateFeedGithubRepo: string;
}

/** 默认 GitHub 更新源仓库（spec 产品规则 1）。 */
export const DEFAULT_UPDATE_FEED_GITHUB = {
  owner: "ShiZiMiao",
  repo: "RaspberryCode",
} as const;
