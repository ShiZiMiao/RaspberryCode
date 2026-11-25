/**
 * 自更新链路的**纯函数**载荷构造与状态判定。
 *
 * 从 autoUpdateService.ts 拆出（该文件触及 800 行架构上限）。
 * 这里只放没有 IO、没有 electron-updater 运行时依赖的纯逻辑，
 * 便于单测，也避免主服务文件继续膨胀。
 *
 * 导入路径保持不变：autoUpdateService.ts 仍然 re-export 这些符号，
 * 既有调用方与测试无需改动。
 */
import type {
  AppSettings,
  PostUpdateReleaseNotesPayload,
  UpdateCheckResultPayload,
  UpdateStatePayload,
} from "@raspberrycode/shared";
import type { UpdateInfo } from "electron-updater";

/** 跳过版本判定的通道。单通道语义（stable 之外的历史通道值只做读兼容）。 */
export const SKIP_VERSION_CHANNEL = "stable" as const;

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

/** 从设置解析出的镜像判定结果（纯数据，无 IO）。 */
export interface ResolvedMirrorConfig {
  mirrorPrefix: string;
  mirrorCandidates: readonly string[];
}

/**
 * 解析镜像前缀与候选列表。**语义区分是协议的一部分**，不要在调用处重新判断：
 *   undefined → 用户没配置过，采用内置候选列表（便于未来追加候选而无需改代码）
 *   ""        → 用户/构建期显式禁用镜像，只走直连
 *   非空串     → 用户指定，只尊重这一家
 *
 * 第三方公益镜像存活率极低（同一天 0.05–14MB/s 都出现过），
 * 因此候选必须由配置/探测决定，不能写死在代码里。
 */
export function resolveMirrorConfig(
  configuredMirror: string | undefined,
  defaults: { prefix: string; candidates: readonly string[] },
): ResolvedMirrorConfig {
  const hasExplicitMirror = typeof configuredMirror === "string";
  const mirrorPrefix = hasExplicitMirror ? configuredMirror.trim() : defaults.prefix;
  const mirrorCandidates: readonly string[] = hasExplicitMirror
    ? mirrorPrefix
      ? [mirrorPrefix]
      : []
    : defaults.candidates;
  return { mirrorPrefix, mirrorCandidates };
}
