import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  PluginSyncComponentType,
  PluginSyncMarketplaceMirrorInspection,
} from "@raspberrycode/shared";
import { PLUGIN_DATA_SYNC_MAX_ITEM_BYTES } from "@raspberrycode/shared";
import type { IPluginSyncService } from "./pluginSync.js";
import {
  CrossMarketplaceDependencyError,
  exportMarketplaceSourceArchiveInternal,
  importMarketplaceSourceArchiveInternal,
  loadMarketplaceSource,
  resolveMarketplacePluginClosure,
} from "./pluginSyncMarketplace.js";
import { normalizePluginSyncRelativePath } from "./pluginSyncPath.js";
import { createInlinePluginDataSyncMethods } from "../data-sync/node.js";

export interface PluginManifestInfo {
  name: string;
  pluginId: string;
  description?: string;
  version?: string;
  /** manifest 的 userConfig（options schema），原样保留。 */
  userConfig: Record<string, unknown>;
  /** 该插件实际包含的组件类型（skills/commands/hooks/mcp），用于远端同步时展示同步范围。 */
  componentTypes: PluginSyncComponentType[];
}

interface UserPluginConfigState {
  dirs: string[];
  enabledOverrides: Map<string, boolean>;
  /** plugins.options，按 pluginId 原样保留大小写。 */
  options: Record<string, unknown>;
}
export const INLINE_PLUGIN_MARKETPLACE = "inline";
const DEFAULT_MAX_ARCHIVE_BYTES = PLUGIN_DATA_SYNC_MAX_ITEM_BYTES;
export const MARKETPLACE_SOURCE_ROOT_DIRECTORY = "marketplace-sources";
export const MIRRORED_MARKETPLACE_PLUGIN_ROOT = "plugins";
export const PLUGIN_MANIFEST_RELATIVE_PATHS = [
  [".raspberrycode-plugin", "plugin.json"],
  [".claude-plugin", "plugin.json"],
  [".codex-plugin", "plugin.json"],
] as const;

export function createPluginSyncService(options?: {
  maxArchiveBytes?: number;
}): IPluginSyncService {
  const maxArchiveBytes = options?.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  return {
    // 数据同步：单个 inline 插件目录上限 50MB；marketplace 来源镜像归档也用同一上限。
    ...createInlinePluginDataSyncMethods({ maxItemBytes: maxArchiveBytes }),
    async exportMarketplaceSourceArchive(params) {
      const result = await exportMarketplaceSourceArchiveInternal(params, maxArchiveBytes);
      if (result.archive.byteLength > maxArchiveBytes) {
        throw new Error(
          `plugin marketplace source archive exceeds limit: ${result.archive.byteLength}/${maxArchiveBytes}`,
        );
      }
      return result;
    },
    async inspectMarketplaceSourceMirror(params) {
      const marketplaceId = normalizeMarketplaceId(params.marketplaceId);
      const loaded = await loadMarketplaceSource(params.source);
      const blocked: PluginSyncMarketplaceMirrorInspection["blocked"] = {};
      for (const pluginName of new Set(params.pluginNames)) {
        try {
          resolveMarketplacePluginClosure(loaded.manifest, marketplaceId, [pluginName]);
        } catch (error) {
          if (error instanceof CrossMarketplaceDependencyError) {
            blocked[pluginName] = "cross-marketplace-dependency";
          }
          // 其他错误（插件不在清单中等）留到推送时由镜像导出报告，不在列表阶段猜测。
        }
      }
      return { blocked };
    },
    async importMarketplaceSourceArchive(params) {
      if (params.overwrite) {
        throw new Error("plugin marketplace source overwrite is not supported");
      }
      if (params.archive.byteLength > maxArchiveBytes) {
        throw new Error(
          `plugin marketplace source archive exceeds limit: ${params.archive.byteLength}/${maxArchiveBytes}`,
        );
      }
      return await importMarketplaceSourceArchiveInternal(params.archive, maxArchiveBytes);
    },
  };
}

export function resolveUserHomeDir(): string {
  return process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir();
}

export function getUserRaspberrycodeConfigPath(): string {
  return join(resolveUserHomeDir(), ".raspberrycode", "cli", "config.json");
}

export function getUserRaspberrycodePluginRoot(): string {
  return join(resolveUserHomeDir(), ".raspberrycode", "plugins");
}


export async function readPluginManifestInfo(
  pluginRoot: string,
): Promise<PluginManifestInfo | null> {
  for (const segments of PLUGIN_MANIFEST_RELATIVE_PATHS) {
    const manifestPath = join(pluginRoot, ...segments);
    let raw: string;
    try {
      raw = await readFile(manifestPath, "utf-8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
    if (!isRecord(parsed)) {
      return null;
    }
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name) {
      return null;
    }
    return {
      name,
      pluginId: `${name}@${INLINE_PLUGIN_MARKETPLACE}`,
      ...(typeof parsed.description === "string" && parsed.description.trim()
        ? { description: parsed.description.trim() }
        : {}),
      ...(typeof parsed.version === "string" && parsed.version.trim()
        ? { version: parsed.version.trim() }
        : {}),
      userConfig: isRecord(parsed.userConfig) ? parsed.userConfig : {},
      componentTypes: await resolvePluginComponentTypes(pluginRoot, parsed),
    };
  }
  return null;
}

/** 判定插件实际包含的组件类型：manifest 显式声明优先，否则按约定目录/文件名探测。 */
async function resolvePluginComponentTypes(
  pluginRoot: string,
  manifest: Record<string, unknown>,
): Promise<PluginSyncComponentType[]> {
  const componentTypes: PluginSyncComponentType[] = [];
  if ("skills" in manifest || (await pathExists(join(pluginRoot, "skills")))) {
    componentTypes.push("skills");
  }
  if ("commands" in manifest || (await pathExists(join(pluginRoot, "commands")))) {
    componentTypes.push("commands");
  }
  if ("hooks" in manifest || (await pathExists(join(pluginRoot, "hooks", "hooks.json")))) {
    componentTypes.push("hooks");
  }
  if ("mcpServers" in manifest || (await pathExists(join(pluginRoot, ".mcp.json")))) {
    componentTypes.push("mcp");
  }
  return componentTypes;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function computeRecursiveSize(path: string): Promise<number> {
  const pathStat = await lstat(path);
  if (pathStat.isFile()) {
    return pathStat.size;
  }
  if (!pathStat.isDirectory()) {
    return 0;
  }
  let total = 0;
  for (const entry of await readdir(path)) {
    total += await computeRecursiveSize(join(path, entry));
  }
  return total;
}

export async function computeRecursiveContentFingerprint(path: string): Promise<string> {
  const pathStat = await lstat(path);
  const hash = createHash("sha256");
  if (pathStat.isFile()) {
    hash.update("file\0");
    hash.update(await readFile(path));
    return hash.digest("hex");
  }
  if (!pathStat.isDirectory()) {
    throw new Error(`unsupported plugin archive source: ${path}`);
  }
  hash.update("dir\0");
  const children = (await readdir(path, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const child of children) {
    hash.update(child.name);
    hash.update("\0");
    hash.update(await computeRecursiveContentFingerprint(join(path, child.name)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function toSafeDirectoryName(value: string): string {
  const sanitized = value.trim().replace(/[\\/:]/gu, "-") || "plugin";
  try {
    return normalizePluginSyncRelativePath(sanitized);
  } catch {
    return `plugin-${createShortHash(value).slice(0, 8)}`;
  }
}

export function createShortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizePluginId(pluginId: string): string {
  const normalized = pluginId.trim();
  if (!normalized || normalized.includes("/") || normalized.includes("\\")) {
    throw new Error(`invalid plugin id: ${pluginId}`);
  }
  return normalized;
}

export function normalizeMarketplaceId(marketplaceId: string): string {
  return normalizePluginId(marketplaceId);
}

export function normalizePluginIdKey(pluginId: string): string {
  return normalizePluginId(pluginId).toLowerCase();
}

export function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`missing ${label}`);
  }
  return value.trim();
}

export async function readJsonFileOrEmpty(filePath: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`invalid json object: ${filePath}`);
  }
  return parsed;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function readUserPluginConfigState(): Promise<UserPluginConfigState> {
  const parsed = await readJsonFileOrEmpty(getUserRaspberrycodeConfigPath());
  const plugins = isRecord(parsed.plugins) ? parsed.plugins : {};
  const enabledPlugins = isRecord(plugins.enabledPlugins) ? plugins.enabledPlugins : {};
  const enabledOverrides = new Map<string, boolean>();
  for (const [pluginId, enabled] of Object.entries(enabledPlugins)) {
    if (typeof enabled === "boolean") {
      enabledOverrides.set(normalizePluginIdKey(pluginId), enabled);
    }
  }
  return {
    dirs: readStringArray(plugins.dirs),
    enabledOverrides,
    options: isRecord(plugins.options) ? plugins.options : {},
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
