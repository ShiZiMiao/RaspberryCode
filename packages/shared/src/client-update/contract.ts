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
      /**
       * 镜像与直连都失败后置为 true：本次自动下载不可用，UI 需提供「手动下载」入口
       * （打开 release 页面，交给浏览器/下载工具）。重试或换网络后会自动清除。
       */
      manualDownloadRequired?: boolean;
      /** 手动下载目标页（GitHub release 详情页），仅 manualDownloadRequired 时有值。 */
      manualDownloadUrl?: string;
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

/**
 * 默认更新镜像前缀——**两条下载链路的唯一事实源**。
 *
 * 形态是「前缀 + 完整原 URL」：`https://cdn.akaere.online/https://github.com/...`。
 * 只对 GitHub 的 release 资产与元数据请求有效，自建 CDN 不加。
 *
 * 为什么放在 shared 而不是各自的包里：客户端自更新（`desktop/.../updateMirror.ts`）
 * 与远程资产下载（`server/src/remote/remoteAssetCdn.ts`）是两个包、两个进程、两套网络栈
 * （前者走 Electron `webRequest`，后者走 Host 子进程 undici，`Session.setProxy` 影响不到它），
 * 代码无法复用，但它们面对的是**同一个网络问题**（GitHub release 下载在部分网络下不可用）。
 * 若各自维护一份，必然出现「一边已切换到新镜像、另一边还在用旧镜像」的错位。
 *
 * 为什么固定一家：维护「发版前探测 30+ 家 → 按速度取前 3 → 运行时候选轮换」的
 * 成本高于收益。2026-11-26 实测 `https://cdn.akaere.online/` 通过四项硬条件：
 *   1. 能代理 `releases.atom`，且响应体是真实 Atom XML（含 `<feed>`）；
 *   2. 能代理 `releases/latest`，且带 `Accept: application/json` 时返回含
 *      `tag_name` 的 JSON（electron-updater 的 GitHubProvider 靠它取最新 tag）；
 *   3. 支持单 Range（206 且长度等于请求区间）；
 *   4. 能正确返回含 `version` + `sha512` 的 `latest.yml`。
 *
 * 第 2 条是 0.2.9 的回归点：`gh-proxy.org` 对 `releases/latest` 会 301 到
 * `gh-proxy.com/https:/github.com/...`（单斜杠）并返回镜像首页 HTML，
 * GitHubProvider 解析 JSON 失败，检查更新直接报错。选镜像时必须实测这一条，
 * 只看状态码 200 不够。
 *
 * 失败链路固定为 `mirror → direct → manual`：镜像失败直接走 GitHub 直连，
 * 直连也失败才进入手动下载。镜像失效时可通过 setting.json 的
 * `updateMirrorPrefix` 覆盖或设为空串（只走直连），无需发版。
 */
export const DEFAULT_UPDATE_MIRROR_PREFIX = "https://cdn.akaere.online/";
