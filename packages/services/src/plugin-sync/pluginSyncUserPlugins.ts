/**
 * 用户插件目录的候选枚举与归档导入/导出：插件同步服务的目录侧实现。
 *
 * 与 pluginSyncService 分开维护，避免单文件超出工程行数上限；
 * 这里只做「本端插件根 ↔ 归档」的读写，不持有服务状态。
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { PluginSyncCandidate, PluginSyncImportResult } from "@raspberrycode/shared";
import type { PluginSyncArchiveMetadata } from "./pluginSyncArchive.js";
import {
  createPluginSyncArchive,
  extractPluginSyncArchive,
  PLUGIN_SYNC_METADATA_ARCHIVE_PATH,
} from "./pluginSyncArchive.js";
import { normalizePluginSyncRelativePath, resolvePluginSyncPathWithin } from "./pluginSyncPath.js";
import {
  createShortHash,
  getUserRaspberrycodeConfigPath,
  getUserRaspberrycodePluginRoot,
  isRecord,
  normalizePluginId,
  normalizePluginIdKey,
  readJsonFileOrEmpty,
  readPluginManifestInfo,
  readRequiredString,
  readStringArray,
  readUserPluginConfigState,
  toSafeDirectoryName,
} from "./pluginSyncService.js";
import { computeRecursiveSize } from "./pluginSyncService.js";


/** 目录名去重：同名插件目录按路径哈希后缀区分，保证同步目标端不互相覆盖。 */
export function createUniqueDirectoryName(
  directoryBasename: string,
  pluginName: string,
  pluginRoot: string,
  usedDirectoryNames: Set<string>,
): string {
  const baseName = toSafeDirectoryName(directoryBasename || pluginName);
  if (!usedDirectoryNames.has(baseName)) {
    usedDirectoryNames.add(baseName);
    return baseName;
  }
  const dedupedName = toSafeDirectoryName(`${baseName}-${createShortHash(pluginRoot).slice(0, 8)}`);
  usedDirectoryNames.add(dedupedName);
  return dedupedName;
}

export function createCandidateId(pluginId: string, pluginRoot: string): string {
  return createShortHash(`${pluginId}:${pluginRoot}`);
}

/**
 * 本端用户插件候选：遍历已配置插件目录，读 manifest 并测量体积。
 * 同一真实路径只计一次（符号链接/重复配置不重复同步）。
 */
export async function collectLocalUserPluginCandidates(): Promise<PluginSyncCandidate[]> {
  const config = await readUserPluginConfigState();
  const candidates: PluginSyncCandidate[] = [];
  const seenRealpaths = new Set<string>();
  const usedDirectoryNames = new Set<string>();

  for (const rawDir of config.dirs) {
    const pluginRoot = resolve(rawDir);
    const canonicalRoot = await realpath(pluginRoot).catch(() => pluginRoot);
    if (seenRealpaths.has(canonicalRoot)) {
      continue;
    }
    seenRealpaths.add(canonicalRoot);
    const manifest = await readPluginManifestInfo(canonicalRoot);
    if (!manifest) {
      continue;
    }
    const enabledOverride = config.enabledOverrides.get(normalizePluginIdKey(manifest.pluginId));
    const directoryName = createUniqueDirectoryName(
      basename(canonicalRoot),
      manifest.name,
      canonicalRoot,
      usedDirectoryNames,
    );
    candidates.push({
      id: createCandidateId(manifest.pluginId, canonicalRoot),
      name: manifest.name,
      pluginId: manifest.pluginId,
      directoryName,
      ...(manifest.description ? { description: manifest.description } : {}),
      ...(manifest.version ? { version: manifest.version } : {}),
      path: canonicalRoot,
      sizeBytes: await computeRecursiveSize(canonicalRoot),
      enabled: enabledOverride ?? true,
      ...(enabledOverride !== undefined ? { enabledOverride } : {}),
      componentTypes: manifest.componentTypes,
    });
  }

  return candidates.sort((left, right) => left.name.localeCompare(right.name));
}

/** pluginId（小写）→ 已配置内联插件目录，用于判定目标端是否已有同一插件的其他目录。 */
export async function collectConfiguredInlinePluginPathById(): Promise<Map<string, string>> {
  const config = await readUserPluginConfigState();
  const byId = new Map<string, string>();
  for (const rawDir of config.dirs) {
    const pluginRoot = resolve(rawDir);
    const manifest = await readPluginManifestInfo(pluginRoot);
    if (!manifest) continue;
    byId.set(normalizePluginIdKey(manifest.pluginId), manifestPathOrRoot(pluginRoot));
  }
  return byId;
}

function manifestPathOrRoot(pluginRoot: string): string {
  return pluginRoot;
}

/** 读取归档内的插件元数据清单（同步时用于对照目标端已有配置）。 */
async function readArchiveMetadata(tempRoot: string): Promise<PluginSyncArchiveMetadata> {
  const raw = await readFile(join(tempRoot, PLUGIN_SYNC_METADATA_ARCHIVE_PATH), "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.plugins)) {
    throw new Error("invalid plugin sync archive metadata");
  }
  const plugins: PluginSyncArchiveMetadata["plugins"] = [];
  for (const item of parsed.plugins) {
    if (!isRecord(item)) {
      throw new Error("invalid plugin sync archive plugin metadata");
    }
    const name = readRequiredString(item.name, "plugin metadata name");
    const pluginId = normalizePluginId(readRequiredString(item.pluginId, "plugin metadata id"));
    const directoryName = normalizePluginSyncRelativePath(
      readRequiredString(item.directoryName, "plugin metadata directory"),
    );
    plugins.push({
      name,
      pluginId,
      directoryName,
      ...(typeof item.enabled === "boolean" ? { enabled: item.enabled } : {}),
    });
  }
  return { plugins };
}

/**
 * 解包插件归档到本端插件根：同名目录已存在则跳过（不覆盖），
 * 解包成功后把新目录登记进 config.json 的 plugins.dirs，保留来源端的启用态。
 */
export async function importPluginsArchive(
  archive: Uint8Array,
  maxArchiveBytes: number,
): Promise<PluginSyncImportResult> {
  const tempRoot = join(tmpdir(), `raspberrycode-plugin-sync-${randomUUID()}`);
  try {
    await extractPluginSyncArchive(archive, tempRoot, {
      maxExtractedBytes: maxArchiveBytes,
    });
    const metadata = await readArchiveMetadata(tempRoot);
    const targetRoot = getUserRaspberrycodePluginRoot();
    await mkdir(targetRoot, { recursive: true });
    const results: PluginSyncImportResult["results"] = [];
    for (const plugin of metadata.plugins) {
      const targetPath = resolvePluginSyncPathWithin(targetRoot, plugin.directoryName);
      if (existsSync(targetPath)) {
        results.push({
          name: plugin.name,
          pluginId: plugin.pluginId,
          directoryName: plugin.directoryName,
          status: "skipped",
          path: targetPath,
        });
        continue;
      }
      const sourcePath = join(tempRoot, plugin.directoryName);
      if (!existsSync(sourcePath)) {
        results.push({
          name: plugin.name,
          pluginId: plugin.pluginId,
          directoryName: plugin.directoryName,
          status: "failed",
          error: "plugin directory missing in archive",
        });
        continue;
      }
      try {
        await cp(sourcePath, targetPath, { recursive: true });
        await addPluginDirToUserConfig(targetPath, plugin.pluginId, plugin.enabled);
        results.push({
          name: plugin.name,
          pluginId: plugin.pluginId,
          directoryName: plugin.directoryName,
          status: "synced",
          path: targetPath,
        });
      } catch (error) {
        results.push({
          name: plugin.name,
          pluginId: plugin.pluginId,
          directoryName: plugin.directoryName,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { results };
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 把插件目录写回 config.json 的 plugins.dirs，并按需写入启用态覆盖。 */
async function addPluginDirToUserConfig(
  pluginPath: string,
  pluginId: string,
  enabledOverride: boolean | undefined,
): Promise<void> {
  const filePath = getUserRaspberrycodeConfigPath();
  const parsed = await readJsonFileOrEmpty(filePath);
  const plugins = isRecord(parsed.plugins) ? parsed.plugins : {};
  const resolvedPluginPath = resolve(pluginPath);
  const dirs = readStringArray(plugins.dirs);
  const nextDirs = dirs.map((item) => resolve(item)).includes(resolvedPluginPath)
    ? dirs
    : [...dirs, resolvedPluginPath];
  const enabledPlugins = isRecord(plugins.enabledPlugins) ? plugins.enabledPlugins : {};
  await writeJsonFileAtomic(filePath, {
    ...parsed,
    plugins: {
      ...plugins,
      dirs: nextDirs,
      ...(enabledOverride !== undefined
        ? {
            enabledPlugins: {
              ...enabledPlugins,
              [pluginId]: enabledOverride,
            },
          }
        : Object.keys(enabledPlugins).length > 0
          ? { enabledPlugins }
          : {}),
    },
  });
}

async function writeJsonFileAtomic(
  filePath: string,
  value: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = join(dirname(filePath), `.tmp-${basename(filePath)}-${randomUUID()}`);
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  await rename(tempPath, filePath);
}
