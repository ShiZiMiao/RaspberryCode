/**
 * 客户端 GitHub 自更新服务（spec：specs/client-github-self-update.md）。
 *
 * 更新状态机（idle → checking → update-available → download-progress → update-downloaded）
 * 的唯一所有者：renderer 只消费 `UpdateStatePayload` 快照广播并下发命令，不派生第二份事实。
 * 更新源为 GitHub Releases（electron-updater 内置 github provider），默认仓库
 * ShiZiMiao/RaspberryCode，用户可在设置页覆盖 owner/repo。
 */
import { app } from "electron";
import { createRequire } from "node:module";
import { CancellationToken, type ProgressInfo, type UpdateDownloadedEvent, type UpdateInfo } from "electron-updater";

/**
 * 修复：electron-updater 的 `autoUpdater` 是 CJS 惰性 getter
 * （`Object.defineProperty(exports, "autoUpdater", { get: () => _autoUpdater || doLoadAutoUpdater() })`），
 * 且该模块只在 Electron 运行时才导出这个键。打包产物是 ESM，`import x from` / `import { autoUpdater }`
 * 在 Electron 的 ESM 互操作下都拿不到 getter 求值结果——此前拿到的是命名空间包装对象，
 * `updater.on(...)` 抛 `TypeError: ae.on is not a function`，把整条 app.whenReady() 启动链
 * 打断在首窗口之前（v0.1.0 Windows 实机：进程活着、窗口永不创建、点图标无反应）。
 * 用 createRequire 走 CJS 通路读取，getter 会被正确求值，拿到真正的 NsisUpdater 实例。
 */
const requireFromHere = createRequire(import.meta.url);

/**
 * 生产缺省的 updater 解析器；测试可通过 __setBundledAutoUpdaterResolverForTest 替换，
 * 避免 vi.mock 无法拦截 createRequire 的 CJS 通路（真实模块在无 electron 环境下会崩）。
 */
let bundledAutoUpdaterResolver = (): AutoUpdaterLike => {
  const module_ = requireFromHere("electron-updater") as { autoUpdater?: AutoUpdaterLike };
  const instance = module_.autoUpdater;
  if (!instance || typeof (instance as { on?: unknown }).on !== "function") {
    // 明确报错而不是把半个对象塞进启动链：调用方已有 try/catch 兜底为 non-fatal。
    throw new Error("electron-updater autoUpdater unavailable (missing .on)");
  }
  return instance;
};

/** 仅测试使用：替换生产缺省 upater 解析器，返回还原函数。 */
export function __setBundledAutoUpdaterResolverForTest(
  resolver: (() => AutoUpdaterLike) | null,
): () => void {
  const previous = bundledAutoUpdaterResolver;
  bundledAutoUpdaterResolver =
    resolver ??
    (() => {
      throw new Error("bundled auto updater resolver not configured");
    });
  return () => {
    bundledAutoUpdaterResolver = previous;
  };
}

function resolveBundledAutoUpdater(): AutoUpdaterLike {
  return bundledAutoUpdaterResolver();
}
import type {
  AppSettings,
  AutoUpdatePreferences,
  PostUpdateReleaseNotesPayload,
  UpdateCheckResultPayload,
  UpdateStatePayload,
} from "@raspberrycode/shared";
import { DEFAULT_UPDATE_FEED_GITHUB } from "@raspberrycode/shared";
import { logger } from "../logger.js";
import type {
  AutoUpdaterLike,
  GithubFeedOptions,
  InitAutoUpdateServiceOptions,
  SettingServiceLike,
} from "./contract.js";
import { buildManualDownloadUrl, UpdateDownloadFallback } from "./updateMirror.js";

/** 单通道语义：跳过版本沿用 skippedElectronUpdateVersions.stable（读写兼容既有字段）。 */
const SKIP_VERSION_CHANNEL = "stable" as const;

/** 「自动更新」模式缓存（偏好事实仍在 setting.json，见 readPreferences）。 */
let autoUpdateMode = false;

/**
 * 是否处于「自动更新」静默模式（spec：specs/client-github-self-update.md 产品规则 7）。
 * 开启时：启动检查→自动差量下载→退出静默安装，UI 不出入口/动态菜单/提示。
 */
export function isAutoUpdateMode(): boolean {
  return autoUpdateMode;
}

/**
 * 强制单 Range 顺序差分：electron-updater 的 github 分支忽略 useMultipleRangeRequest，
 * 且 createProviderRuntimeOptions 硬编码 isUseMultipleRangeRequest=true；GitHub 资产存储
 * 不支持 multipart/byteranges，多 Range 探测会回退整包下载。这里覆盖 runtime 选项，
 * 保证差量更新走「单 Range 顺序拉取差异块」路径（约 15MB 级差异包而非 300MB+ 全量包）。
 */
function patchSingleRangeDifferential(target: AutoUpdaterLike): void {
  const patched = target as AutoUpdaterLike & {
    createProviderRuntimeOptions?: () => Record<string, unknown>;
    raspberrycodeSingleRangePatched?: boolean;
  };
  if (
    typeof patched.createProviderRuntimeOptions !== "function" ||
    patched.raspberrycodeSingleRangePatched
  ) {
    return;
  }
  const original = patched.createProviderRuntimeOptions.bind(patched);
  patched.createProviderRuntimeOptions = () => ({
    ...original(),
    isUseMultipleRangeRequest: false,
  });
  patched.raspberrycodeSingleRangePatched = true;
}

let settingService: SettingServiceLike | null = null;
let updater: AutoUpdaterLike | null = null;
let broadcastState: ((state: UpdateStatePayload) => void) | undefined;
let onBeforeQuitAndInstall: (() => void | Promise<void>) | undefined;
let enabled = false;
let currentVersion = "0.0.0";
let state: UpdateStatePayload = { kind: "idle", enabled: false };
/** 安装目标锁：非 idle 后迟到的检查/下载不得替换用户已选择的安装目标。 */
let quitAndInstallState: "idle" | "preparing" | "installing" | "recovering" = "idle";
let downloadCancellationToken: CancellationToken | null = null;
let downloadingVersion: string | null = null;
let availableUpdate: { version: string; releaseNotes?: PostUpdateReleaseNotesPayload } | null = null;
let silentCheckTimer: ReturnType<typeof setTimeout> | null = null;

/** 下载镜像三级回退状态（mirror → direct → manual）；由 webRequest 层读取。 */
const downloadFallback = new UpdateDownloadFallback();
/** 当前生效的更新源仓库，供 manual 回退时拼 release 页面地址。 */
let feedOwner: string = DEFAULT_UPDATE_FEED_GITHUB.owner;
let feedRepo: string = DEFAULT_UPDATE_FEED_GITHUB.repo;

/** 下载阶段的回退状态查询入口（updateMirrorSession 接线时注入）。 */
export function getUpdateDownloadRoute() {
  return downloadFallback.currentRoute;
}

// ---------------------------------------------------------------------------
// 纯函数（可单测）
// ---------------------------------------------------------------------------

/** 解析 GitHub 更新源：空值回退默认仓库，只消费正式 release，差量走单 Range。 */
export function resolveGithubFeedOptions(
  owner?: string,
  repo?: string,
): GithubFeedOptions {
  return {
    provider: "github",
    owner: owner?.trim() || DEFAULT_UPDATE_FEED_GITHUB.owner,
    repo: repo?.trim() || DEFAULT_UPDATE_FEED_GITHUB.repo,
    releaseType: "release",
    useMultipleRangeRequest: false,
  };
}

/** 跳过版本判定：单通道语义，只读 skippedElectronUpdateVersions.stable。 */
export function isVersionSkipped(version: string, settings: AppSettings): boolean {
  return settings.skippedElectronUpdateVersions?.[SKIP_VERSION_CHANNEL]?.trim() === version.trim();
}

/** GitHub release → 更新日志载荷；标题取 release name（缺省回退版本号）。 */
export function buildReleaseNotesPayload(
  info: Pick<UpdateInfo, "version" | "releaseName" | "releaseNotes" | "releaseDate">,
): PostUpdateReleaseNotesPayload {
  const markdown =
    typeof info.releaseNotes === "string"
      ? info.releaseNotes
      : Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map((note) => note.note ?? "").join("\n\n")
        : "";
  return {
    version: info.version,
    title: info.releaseName?.trim() || `v${info.version}`,
    markdown,
    ...(info.releaseDate ? { releaseDate: info.releaseDate } : {}),
  };
}

/** 手动检查在已有状态上的短路结果；只有需要真实检查时才返回 null。 */
export function deriveManualCheckResultFromState(
  snapshot: UpdateStatePayload,
): UpdateCheckResultPayload | null {
  switch (snapshot.kind) {
    case "update-downloaded":
      return { kind: "ready", version: snapshot.version };
    case "download-progress":
      return {
        kind: "already-downloading",
        version: snapshot.version ?? "",
        progress: `${snapshot.progress}%`,
      };
    case "update-available":
      return { kind: "available", version: snapshot.version };
    default:
      return null;
  }
}

function isCancellationError(error: unknown): boolean {
  return error instanceof Error && error.name === "CancellationError";
}

// ---------------------------------------------------------------------------
// 状态机内部
// ---------------------------------------------------------------------------

function nextState(next: UpdateStatePayload): void {
  state = next;
  broadcastState?.(next);
}

function releaseUpdateTargetLockForFailure(): void {
  // 只有安装准备/安装中的失败才需要恢复语义；普通检查失败不碰安装锁。
  if (quitAndInstallState === "preparing" || quitAndInstallState === "installing") {
    logger.warn(`[auto-update] update install failed at stage=${quitAndInstallState}`);
  }
}

async function readPreferences(): Promise<{
  autoDownloadAndInstallUpdates: boolean;
  skippedVersion: string | null;
  owner: string;
  repo: string;
}> {
  const settings = (await settingService?.get()) ?? ({} as AppSettings);
  // 偏好事实的唯一所有者是 setting.json；这里顺带刷新同步缓存供菜单投影使用。
  autoUpdateMode = settings.autoDownloadAndInstallUpdates === true;
  return {
    autoDownloadAndInstallUpdates: autoUpdateMode,
    skippedVersion: settings.skippedElectronUpdateVersions?.[SKIP_VERSION_CHANNEL]?.trim() ?? null,
    owner: settings.updateFeedGithubOwner ?? "",
    repo: settings.updateFeedGithubRepo ?? "",
  };
}

function applyFeed(owner: string, repo: string): void {
  const feed = resolveGithubFeedOptions(owner, repo);
  updater?.setFeedURL(feed);
  // 记录当前仓库：下载回退到 manual 时要用它拼 release 页面地址。
  feedOwner = feed.owner;
  feedRepo = feed.repo;
  logger.info(`[auto-update] github feed applied owner=${feed.owner} repo=${feed.repo}`);
}

function handleUpdateAvailable(info: UpdateInfo): void {
  if (quitAndInstallState !== "idle") {
    logger.warn(`[auto-update] ignore update-available: install target locked (${quitAndInstallState})`);
    return;
  }
  const releaseNotes = buildReleaseNotesPayload(info);
  availableUpdate = { version: info.version, releaseNotes };
  nextState({
    kind: "update-available",
    enabled,
    version: info.version,
    releaseNotes,
  });
  // 跳过版本与自动下载都以设置为准；两者都可能在同一事件里改变后续路径。
  void (async () => {
    const preferences = await readPreferences();
    if (isVersionSkipped(info.version, { skippedElectronUpdateVersions: { [SKIP_VERSION_CHANNEL]: preferences.skippedVersion ?? undefined } } as AppSettings)) {
      logger.info(`[auto-update] skipped version ignored: ${info.version}`);
      availableUpdate = null;
      nextState({ kind: "idle", enabled });
      return;
    }
    if (preferences.autoDownloadAndInstallUpdates) {
      downloadAvailableUpdate("auto");
    }
  })();
}

function handleDownloadProgress(progress: ProgressInfo): void {
  if (quitAndInstallState !== "idle") return;
  downloadingVersion = progress.total > 0 ? downloadingVersion : downloadingVersion;
  // 收到有效字节即视为当前路线可用，锁定不再降级（避免中途换源导致文件拼接损坏）。
  if (progress.transferred > 0) downloadFallback.markSucceeded();
  nextState({
    kind: "download-progress",
    enabled,
    progress: Math.max(0, Math.min(100, Math.round(progress.percent))),
    version: availableUpdate?.version,
    transferredBytes: progress.transferred,
    totalBytes: progress.total,
    releaseNotes: availableUpdate?.releaseNotes,
  });
}

function handleUpdateDownloaded(event: UpdateDownloadedEvent): void {
  // electron-updater 的 UpdateDownloadedEvent 直接 extends UpdateInfo，不带 info 包装。
  const releaseNotes = buildReleaseNotesPayload(event);
  availableUpdate = { version: event.version, releaseNotes };
  downloadingVersion = null;
  downloadCancellationToken = null;
  nextState({
    kind: "update-downloaded",
    enabled,
    version: event.version,
    releaseNotes,
  });
}

function handleUpdaterError(error: Error): void {
  if (isCancellationError(error)) {
    logger.info("[auto-update] download cancelled by user");
    downloadingVersion = null;
    downloadCancellationToken = null;
    downloadFallback.reset();
    if (availableUpdate && quitAndInstallState === "idle") {
      nextState({
        kind: "update-available",
        enabled,
        version: availableUpdate.version,
        releaseNotes: availableUpdate.releaseNotes,
      });
    }
    return;
  }
  releaseUpdateTargetLockForFailure();

  // 下载阶段失败且尚有下一级可退时，自动降级重试：
  //   mirror（ghfast）→ direct（github 原站）→ manual（交给用户手动下载）。
  // 仅在「正在下载」语义下降级：检查失败不该被当成下载失败反复重试。
  if (state.kind === "download-progress" && downloadFallback.currentAttemptKey && !downloadFallback.hasSucceeded) {
    const failedRoute = downloadFallback.currentRoute;
    const nextRoute = downloadFallback.advance();
    if (nextRoute !== "manual" && availableUpdate) {
      logger.warn(
        `[auto-update] download failed on ${failedRoute} (${error.message}); retry via ${nextRoute}`,
      );
      downloadingVersion = availableUpdate.version;
      downloadCancellationToken = new CancellationToken();
      void updater?.downloadUpdate(downloadCancellationToken).catch((retryError: unknown) => {
        if (!isCancellationError(retryError)) {
          logger.warn(`[auto-update] retry downloadUpdate rejected: ${String(retryError)}`);
        }
      });
      return;
    }
    // 降级到 manual：保留 update-available 语义并标记需要手动下载。
    if (nextRoute === "manual" && availableUpdate) {
      logger.warn(
        `[auto-update] download failed on ${failedRoute} (${error.message}); manual download required`,
      );
      downloadingVersion = null;
      downloadCancellationToken = null;
      if (quitAndInstallState === "idle") {
        nextState({
          kind: "update-available",
          enabled,
          version: availableUpdate.version,
          releaseNotes: availableUpdate.releaseNotes,
          manualDownloadRequired: true,
          manualDownloadUrl: buildManualDownloadUrl(feedOwner, feedRepo, availableUpdate.version),
        });
      }
      return;
    }
  }

  logger.warn(`[auto-update] updater error: ${error.message}`);
  if (quitAndInstallState === "idle") {
    downloadingVersion = null;
    downloadCancellationToken = null;
    downloadFallback.reset();
    nextState({ kind: "idle", enabled });
  }
}

async function runCheck(reason: "startup" | "manual"): Promise<void> {
  if (!updater || !enabled) return;
  if (quitAndInstallState !== "idle") {
    logger.info(`[auto-update] skip ${reason} check: install target locked`);
    return;
  }
  // 下载/就绪期间不重复检查，避免迟到结果把下载中/已下载状态打回。
  if (state.kind === "download-progress" || state.kind === "update-downloaded") {
    logger.info(`[auto-update] skip ${reason} check: state=${state.kind}`);
    return;
  }
  const preferences = await readPreferences();
  applyFeed(preferences.owner, preferences.repo);
  nextState({ kind: "checking", enabled });
  try {
    await updater.checkForUpdates();
    // electron-updater 在 promise 收口前已发 update-available/not-available 事件；
    // 若事件缺失（异常 provider 行为）这里兜底回 idle，不悬挂 checking。
    if (state.kind === "checking") {
      nextState({ kind: "idle", enabled });
    }
  } catch (error) {
    handleUpdaterError(error instanceof Error ? error : new Error(String(error)));
    if (state.kind === "checking") {
      nextState({ kind: "idle", enabled });
    }
  }
}

// ---------------------------------------------------------------------------
// 对外命令
// ---------------------------------------------------------------------------

/** 初始化更新服务并调度启动静默检查；仅打包态启用。 */
export function initAutoUpdateService(options: InitAutoUpdateServiceOptions): void {
  settingService = options.settingService;
  broadcastState = options.broadcastState;
  onBeforeQuitAndInstall = options.onBeforeQuitAndInstall;
  enabled = options.isPackaged ?? app.isPackaged;
  currentVersion = options.currentVersion ?? app.getVersion();
  quitAndInstallState = "idle";
  availableUpdate = null;
  downloadingVersion = null;
  downloadCancellationToken = null;

  if (!enabled) {
    // 开发态更新器不初始化：无静默检查、无入口（spec 产品规则 2）。
    updater = null;
    nextState({ kind: "idle", enabled: false });
    return;
  }

  // 生产缺省注入 electron-updater 单例（bugfix：此前 options.updater 缺省时误走禁用分支，
  // 打包态更新器从未激活；只有测试显式注入假更新器才能工作）。
  updater = options.updater ?? resolveBundledAutoUpdater();
  updater.autoDownload = false; // 下载由命令显式驱动，跳过版本/静默模式依赖该裁决点
  updater.allowDowngrade = false;
  patchSingleRangeDifferential(updater);
  void readPreferences()
    .then((preferences) => {
      // 静默增量语义：自动模式下下载完成后随应用退出静默安装（NSIS install(true,false)，
      // 不拉起应用），用户下次启动即新版本（spec 产品规则 7）。
      if (updater) updater.autoInstallOnAppQuit = preferences.autoDownloadAndInstallUpdates;
    })
    .catch((error: unknown) => {
      // 浮动 promise 必须收口，否则污染 unhandledRejection 通道掩盖真实启动错误。
      logger.warn("[auto-update] read preferences failed", error);
    });

  updater.on("checking-for-update", () => {
    if (quitAndInstallState === "idle" && state.kind !== "download-progress" && state.kind !== "update-downloaded") {
      nextState({ kind: "checking", enabled });
    }
  });
  updater.on("update-available", handleUpdateAvailable);
  updater.on("update-not-available", () => {
    if (quitAndInstallState === "idle" && state.kind !== "download-progress" && state.kind !== "update-downloaded") {
      availableUpdate = null;
      nextState({ kind: "idle", enabled });
    }
  });
  updater.on("download-progress", handleDownloadProgress);
  updater.on("update-downloaded", handleUpdateDownloaded);
  updater.on("error", handleUpdaterError);

  nextState({ kind: "idle", enabled });
  const delayMs = options.silentCheckDelayMs ?? 10_000;
  silentCheckTimer = setTimeout(() => {
    silentCheckTimer = null;
    void runCheck("startup");
  }, delayMs);
}

/** 释放启动检查定时器（应用退出路径调用）。 */
export function disposeAutoUpdateService(): void {
  if (silentCheckTimer) {
    clearTimeout(silentCheckTimer);
    silentCheckTimer = null;
  }
}

export function getUpdateState(): UpdateStatePayload {
  return state;
}

/** 手动「检查更新」：已有可观察状态直接短路，否则发起一次真实检查并映射结果。 */
export async function checkForUpdateManually(): Promise<UpdateCheckResultPayload> {
  if (!enabled) {
    return { kind: "dev-skipped" };
  }
  const shortcut = deriveManualCheckResultFromState(state);
  if (shortcut) {
    return shortcut;
  }
  if (quitAndInstallState !== "idle") {
    return { kind: "error", message: "update install in progress" };
  }
  await runCheck("manual");
  switch (state.kind) {
    case "update-available":
      return { kind: "available", version: state.version };
    case "download-progress":
      return {
        kind: "already-downloading",
        version: state.version ?? "",
        progress: `${state.progress}%`,
      };
    case "update-downloaded":
      return { kind: "ready", version: state.version };
    case "idle":
      return { kind: "up-to-date", currentVersion };
    default:
      return { kind: "error", message: `unexpected update state: ${state.kind}` };
  }
}

/** 下载当前已发现的更新；幂等（下载中/已下载直接返回）。 */
export function downloadAvailableUpdate(reason = "renderer"): void {
  if (!updater || !enabled) return;
  if (state.kind === "download-progress" || state.kind === "update-downloaded") return;
  if (state.kind !== "update-available") {
    logger.warn(`[auto-update] ignore download request (${reason}): state=${state.kind}`);
    return;
  }
  if (quitAndInstallState !== "idle") return;
  downloadingVersion = state.version;
  downloadCancellationToken = new CancellationToken();
  // 每次新下载都从镜像是重试：不让上一次直连成功永久跳过镜像。
  downloadFallback.beginAttempt(state.version);
  logger.info(`[auto-update] download started (${reason}) version=${state.version} route=${downloadFallback.currentRoute}`);
  void updater.downloadUpdate(downloadCancellationToken).catch((error: unknown) => {
    // 真实失败由 error 事件统一收口；这里只防空拒绝未处理。
    if (!isCancellationError(error)) {
      logger.warn(`[auto-update] downloadUpdate rejected: ${String(error)}`);
    }
  });
}

/** 取消正在下载的更新；状态回到 update-available。 */
export function cancelUpdateDownload(): void {
  if (!downloadCancellationToken || state.kind !== "download-progress") return;
  logger.info("[auto-update] cancel download requested");
  downloadCancellationToken.cancel();
}

/** 跳过版本：落盘 stable 通道记录，撤下入口与进行中的下载。 */
export async function skipAvailableUpdateVersion(version: string): Promise<void> {
  if (!settingService) return;
  const trimmed = version.trim();
  if (!trimmed) return;
  if (state.kind === "download-progress") {
    cancelUpdateDownload();
  }
  const settings = await settingService.get();
  await settingService.update({
    skippedElectronUpdateVersions: {
      ...settings.skippedElectronUpdateVersions,
      [SKIP_VERSION_CHANNEL]: trimmed,
    },
  });
  logger.info(`[auto-update] skipped version persisted: ${trimmed}`);
  availableUpdate = null;
  downloadingVersion = null;
  if (quitAndInstallState === "idle") {
    nextState({ kind: "idle", enabled });
  }
}

/**
 * 退出并安装已下载的更新。
 * 顺序（spec 事件顺序）：锁安装目标 → 退出准备（稳定性标记 + 退出屏障 + win32 资源锁清理）
 * → autoUpdater.quitAndInstall()。退出准备失败不得启动安装器。
 */
export async function quitAndInstallUpdate(): Promise<void> {
  if (!updater) {
    throw new Error("update service is not initialized");
  }
  if (state.kind !== "update-downloaded") {
    throw new Error(`update is not ready to install: state=${state.kind}`);
  }
  if (quitAndInstallState !== "idle") {
    logger.warn(`[auto-update] ignore quitAndInstall request: stage=${quitAndInstallState}`);
    return;
  }
  quitAndInstallState = "preparing";
  logger.info("[auto-update] user requested quit and install");
  try {
    await onBeforeQuitAndInstall?.();
  } catch (error) {
    // 退出准备是释放 host/agent 与随包资源文件锁的硬前置条件；失败后不得启动安装器，
    // 否则 Windows 可能在资源仍被占用时覆盖安装目录，形成半更新。
    quitAndInstallState = "idle";
    logger.warn(`[auto-update] prepare quit and install failed: ${String(error)}`);
    throw error instanceof Error ? error : new Error(String(error));
  }
  quitAndInstallState = "installing";
  try {
    updater.quitAndInstall();
    // 成功交接后保留 installing 标记直到进程退出，避免退出监听器重入安装。
  } catch (error) {
    quitAndInstallState = "idle";
    logger.warn(`[auto-update] quit and install failed: ${String(error)}`);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function getAutoUpdatePreferences(): Promise<AutoUpdatePreferences> {
  const preferences = await readPreferences();
  return {
    autoDownloadAndInstallUpdates: preferences.autoDownloadAndInstallUpdates,
    skippedUpdateVersion: preferences.skippedVersion,
    updateFeedGithubOwner: preferences.owner,
    updateFeedGithubRepo: preferences.repo,
  };
}

export async function setAutoDownloadAndInstallUpdates(enabled: boolean): Promise<void> {
  if (!settingService) return;
  await settingService.update({ autoDownloadAndInstallUpdates: enabled });
  autoUpdateMode = enabled;
  if (updater) updater.autoInstallOnAppQuit = enabled;
  logger.info(`[auto-update] auto update mode ${enabled ? "enabled" : "disabled"}`);
  if (enabled && state.kind === "update-available") {
    // 用户开启自动更新时期望当前版本立即进入静默流程；是否下载、缓存命中与状态广播仍由本服务裁决。
    downloadAvailableUpdate("auto-preference");
  }
}

export async function setUpdateFeedGithub(payload: {
  owner: string;
  repo: string;
}): Promise<void> {
  if (!settingService) return;
  await settingService.update({
    updateFeedGithubOwner: payload.owner.trim(),
    updateFeedGithubRepo: payload.repo.trim(),
  });
  const feed = resolveGithubFeedOptions(payload.owner, payload.repo);
  logger.info(`[auto-update] github feed updated owner=${feed.owner} repo=${feed.repo}`);
}
