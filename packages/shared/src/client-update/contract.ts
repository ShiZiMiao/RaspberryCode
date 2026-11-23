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
 * GitHub 下载镜像候选前缀（按速度排序，最多 3 个）——**两条下载链路的唯一事实源**。
 *
 * 为什么放在 shared 而不是各自的包里：客户端自更新（`desktop/.../updateMirror.ts`）
 * 与远程资产下载（`server/src/remote/remoteAssetCdn.ts`）是两个包、两个进程、两套网络栈
 * （前者走 Electron `webRequest`，后者走 Host 子进程 undici，`Session.setProxy` 影响不到它），
 * 代码无法复用，但它们面对的是**同一个网络问题**（GitHub release 下载在部分网络下不可用）。
 * 若各自维护一份，必然出现「一边已切换到新镜像、另一边还在用已失效的旧镜像」。
 *
 * 取值由 `node scripts/probe-update-mirrors.mjs` 在**每次发版前**实测 30+ 家公开镜像生成：
 * 三条硬条件全过 → 按速度排序 → 取前 3（不足 3 个有几个算几个）。
 * GitHub 直连不占名额，它是候选全挂后的下一级兜底。
 *
 * 入选三条硬条件（缺一不可，全部来自实测踩坑）：
 *   1. 能代理 `releases.atom`，且**响应体是真实 Atom XML**（≥2000 字节、含 `<feed>`）。
 *      只回 200 不算：`gh.acmsz.top` 曾返回 200 但 body 只有 2–3 字节 `ok`，
 *      electron-updater 会在 parseXml 阶段抛 `ERR_UPDATER_INVALID_RELEASE_FEED`。
 *   2. 支持单 Range（206 且长度等于请求区间）。回 200 全量会让差量静默退化为整包。
 *   3. 能正确返回含 `version` + `sha512` 的 `latest.yml`。
 *
 * ⚠️ 这是**快照**，不是长期结论。实测同一天内镜像速度可在 0.05–14MB/s 间波动，
 * 数十家「正常」站里常只有 5 家左右能通过上述判据。因此：
 *   - 排序只代表「最近一次探测时谁快」，不要据此推断长期可用性；
 *   - 发版必须重跑探测（已接进 `release-gate.mjs`），否则候选可能已全部失效；
 *   - 真正保证下载可用的是「候选轮换 → 直连 → 手动下载」这级联回退，不是候选本身。
 *
 * 第 1 条对远程资产链路是**冗余**的（它只下 `releases/download/...`，不请求 atom），
 * 但两条链路共用一份列表，取交集可以避免「一边能用一边不能用」的判定分歧。
 */
export const DEFAULT_UPDATE_MIRROR_CANDIDATES: readonly string[] = [
  "https://xsadwsd.kdns.fr/",
  "https://gitproxy.127731.xyz/",
  "https://cdn.akaere.online/",
];

/**
 * 默认镜像前缀 = 候选首项，仅作为「没有候选信息时的起点」。
 *
 * 空数组兜底：`CANDIDATES[0]` 的类型是 `string | undefined`（TS 不做非空推断）。
 * 列表为空只可能发生在有人误删内容时——那时返回空串，语义是「禁用镜像、只走直连」，
 * 正好是这种情况最安全的降级，而不是留 undefined 让请求拼出 `undefinedhttps://...`。
 */
export const DEFAULT_UPDATE_MIRROR_PREFIX: string = DEFAULT_UPDATE_MIRROR_CANDIDATES[0] ?? "";
