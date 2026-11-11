/**
 * Marketplace 插件来源的归档导出/导入与镜像预检。
 *
 * 与 pluginSyncService 分开维护，避免单文件超出工程行数上限；
 * 这里只做「Personal Source 本地目录 ↔ 镜像归档」的读写与依赖闭包解析。
 */
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createPluginSyncArchive,
  extractPluginSyncArchive,
  PLUGIN_SYNC_METADATA_ARCHIVE_PATH,
} from "./pluginSyncArchive.js";
import { normalizePluginSyncRelativePath, resolvePluginSyncPathWithin } from "./pluginSyncPath.js";
import {
  computeRecursiveContentFingerprint,
  normalizeMarketplaceId,
  readUserPluginConfigState,
  computeRecursiveSize,
  createShortHash,
  isRecord,
  normalizePluginId,
  normalizePluginIdKey,
  readJsonFileOrEmpty,
  readPluginManifestInfo,
  readRequiredString,
  toSafeDirectoryName,
  directoryExists,
  getUserRaspberrycodePluginRoot,
  INLINE_PLUGIN_MARKETPLACE,
  MARKETPLACE_SOURCE_ROOT_DIRECTORY,
  MIRRORED_MARKETPLACE_PLUGIN_ROOT,
  PLUGIN_MANIFEST_RELATIVE_PATHS,
} from "./pluginSyncService.js";

interface MarketplaceManifestInfo {
  name: string;
  description?: string;
  pluginRoot?: string;
  plugins: MarketplacePluginEntryInfo[];
  raw: Record<string, unknown>;
}

interface MarketplacePluginEntryInfo {
  name: string;
  dependencies: string[];
  raw: Record<string, unknown>;
  source?: unknown;
}

interface MarketplaceSourceLoadResult {
  manifest: MarketplaceManifestInfo;
  sourceRoot?: string;
}

interface MarketplaceSourceMirrorEntry {
  entry: MarketplacePluginEntryInfo;
  mirroredSourcePath?: string;
  mirroredSourceRelativePath?: string;
}

export async function exportMarketplaceSourceArchiveInternal(
  params: {
    marketplaceId: string;
    pluginNames: string[];
    source: Record<string, unknown>;
  },
  maxArchiveBytes: number,
) {
  const marketplaceId = normalizeMarketplaceId(params.marketplaceId);
  const pluginNames = Array.from(
    new Set(params.pluginNames.map((name) => readRequiredString(name, "plugin name"))),
  );
  if (pluginNames.length === 0) {
    throw new Error("missing marketplace plugin names");
  }
  const loaded = await loadMarketplaceSource(params.source);
  if (loaded.manifest.name !== marketplaceId) {
    throw new Error(`marketplace id mismatch: ${loaded.manifest.name} !== ${marketplaceId}`);
  }
  const closure = resolveMarketplacePluginClosure(loaded.manifest, marketplaceId, pluginNames);
  const mirrorEntries = await Promise.all(
    closure.map((entry) => buildMarketplaceSourceMirrorEntry(loaded, entry)),
  );
  const manifest = buildMirroredMarketplaceManifest(loaded.manifest, mirrorEntries);
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  const selectedBytes =
    Buffer.byteLength(manifestContent, "utf-8") +
    (
      await Promise.all(
        mirrorEntries.map((entry) =>
          entry.mirroredSourcePath ? computeRecursiveSize(entry.mirroredSourcePath) : 0,
        ),
      )
    ).reduce((total, bytes) => total + bytes, 0);
  if (selectedBytes > maxArchiveBytes) {
    throw new Error(
      `plugin marketplace source archive exceeds limit: ${selectedBytes}/${maxArchiveBytes}`,
    );
  }
  const sourceFingerprints = await Promise.all(
    mirrorEntries.map((entry) =>
      entry.mirroredSourcePath
        ? computeRecursiveContentFingerprint(entry.mirroredSourcePath)
        : null,
    ),
  );
  const directoryName = createMarketplaceSourceDirectoryName(
    marketplaceId,
    manifestContent,
    sourceFingerprints,
  );
  const entries = [
    {
      archivePath: `${directoryName}/marketplace.json`,
      content: manifestContent,
    },
    ...mirrorEntries
      .filter(
        (
          entry,
        ): entry is MarketplaceSourceMirrorEntry & {
          mirroredSourcePath: string;
          mirroredSourceRelativePath: string;
        } => Boolean(entry.mirroredSourcePath && entry.mirroredSourceRelativePath),
      )
      .map((entry) => ({
        archivePath: `${directoryName}/${entry.mirroredSourceRelativePath}`,
        sourcePath: entry.mirroredSourcePath,
      })),
  ];
  const archive = await createPluginSyncArchive({
    entries,
    metadata: {
      plugins: [],
      marketplaceSources: [
        {
          marketplaceId,
          directoryName,
        },
      ],
    },
  });
  return {
    archive,
    archiveBytes: archive.byteLength,
    marketplaceId,
    pluginNames: closure.map((entry) => entry.name),
  };
}

export async function importMarketplaceSourceArchiveInternal(
  archive: Uint8Array,
  maxArchiveBytes: number,
) {
  const tempRoot = join(tmpdir(), `raspberrycode-plugin-marketplace-source-${randomUUID()}`);
  try {
    await extractPluginSyncArchive(archive, tempRoot, {
      maxExtractedBytes: maxArchiveBytes,
    });
    const metadata = await readMarketplaceSourceArchiveMetadata(tempRoot);
    const directoryName = normalizePluginSyncRelativePath(metadata.directoryName);
    const extractedPath = resolvePluginSyncPathWithin(tempRoot, directoryName);
    const manifest = await readMarketplaceManifest(join(extractedPath, "marketplace.json"));
    if (manifest.name !== metadata.marketplaceId) {
      throw new Error(
        `marketplace source archive id mismatch: ${manifest.name} !== ${metadata.marketplaceId}`,
      );
    }
    const targetRoot = join(getUserRaspberrycodePluginRoot(), MARKETPLACE_SOURCE_ROOT_DIRECTORY);
    const targetPath = resolvePluginSyncPathWithin(targetRoot, directoryName);
    if (existsSync(targetPath)) {
      return {
        marketplaceId: metadata.marketplaceId,
        path: targetPath,
        status: "skipped" as const,
      };
    }
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(extractedPath, targetPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    return {
      marketplaceId: metadata.marketplaceId,
      path: targetPath,
      status: "synced" as const,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function readMarketplaceSourceArchiveMetadata(tempRoot: string): Promise<{
  directoryName: string;
  marketplaceId: string;
}> {
  const raw = await readFile(join(tempRoot, PLUGIN_SYNC_METADATA_ARCHIVE_PATH), "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.marketplaceSources)) {
    throw new Error("invalid plugin marketplace source archive metadata");
  }
  if (parsed.marketplaceSources.length !== 1) {
    throw new Error("plugin marketplace source archive must contain one marketplace");
  }
  const item = parsed.marketplaceSources[0];
  if (!isRecord(item)) {
    throw new Error("invalid plugin marketplace source metadata");
  }
  return {
    marketplaceId: normalizeMarketplaceId(
      readRequiredString(item.marketplaceId, "marketplace source id"),
    ),
    directoryName: normalizePluginSyncRelativePath(
      readRequiredString(item.directoryName, "marketplace source directory"),
    ),
  };
}

export async function loadMarketplaceSource(
  source: Record<string, unknown>,
): Promise<MarketplaceSourceLoadResult> {
  const sourceKind = typeof source.source === "string" ? source.source : "";
  if (sourceKind === "file") {
    const filePath = readRequiredString(source.path, "marketplace source file path");
    return {
      manifest: await readMarketplaceManifest(filePath),
      sourceRoot: dirname(filePath),
    };
  }
  if (sourceKind === "directory") {
    const sourceRoot = readRequiredString(source.path, "marketplace source directory path");
    const manifestPath = findMarketplaceManifestPath(sourceRoot);
    if (!manifestPath) {
      throw new Error(`marketplace manifest not found in directory: ${sourceRoot}`);
    }
    return {
      manifest: await readMarketplaceManifest(manifestPath),
      sourceRoot,
    };
  }
  if (sourceKind === "settings") {
    if (!isRecord(source.marketplace)) {
      throw new Error("settings marketplace source is missing marketplace manifest");
    }
    return {
      manifest: parseMarketplaceManifest(source.marketplace),
    };
  }
  throw new Error(`unsupported marketplace source for SSH sync: ${sourceKind || "unknown"}`);
}

async function readMarketplaceManifest(filePath: string): Promise<MarketplaceManifestInfo> {
  const parsed = JSON.parse(await readFile(filePath, "utf-8")) as unknown;
  return parseMarketplaceManifest(parsed);
}

function parseMarketplaceManifest(value: unknown): MarketplaceManifestInfo {
  if (!isRecord(value)) {
    throw new Error("marketplace manifest is invalid");
  }
  const name = readRequiredString(value.name, "marketplace name");
  const rawPlugins = value.plugins;
  const pluginValues = Array.isArray(rawPlugins)
    ? rawPlugins
    : isRecord(rawPlugins)
      ? Object.entries(rawPlugins).map(([pluginName, plugin]) =>
          isRecord(plugin) ? { name: pluginName, ...plugin } : { name: pluginName },
        )
      : [];
  const plugins = pluginValues.filter(isRecord).map((plugin): MarketplacePluginEntryInfo => {
    const pluginName = readRequiredString(plugin.name, "marketplace plugin name");
    const dependencies = Array.isArray(plugin.dependencies)
      ? plugin.dependencies.filter(
          (dependency): dependency is string =>
            typeof dependency === "string" && dependency.trim().length > 0,
        )
      : [];
    return {
      name: pluginName,
      dependencies,
      raw: plugin,
      ...(plugin.source !== undefined ? { source: plugin.source } : {}),
    };
  });
  return {
    name,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...readMarketplacePluginRoot(value),
    plugins,
    raw: value,
  };
}

function readMarketplacePluginRoot(value: Record<string, unknown>): { pluginRoot?: string } {
  if (typeof value.pluginRoot === "string" && value.pluginRoot.trim()) {
    return { pluginRoot: value.pluginRoot.trim() };
  }
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  if (typeof metadata.pluginRoot === "string" && metadata.pluginRoot.trim()) {
    return { pluginRoot: metadata.pluginRoot.trim() };
  }
  return {};
}

function findMarketplaceManifestPath(sourceRoot: string): string | null {
  const candidates = [
    join(sourceRoot, "marketplace.json"),
    join(sourceRoot, ".claude-plugin", "marketplace.json"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function resolveMarketplacePluginClosure(
  manifest: MarketplaceManifestInfo,
  marketplaceId: string,
  pluginNames: readonly string[],
): MarketplacePluginEntryInfo[] {
  const byName = new Map(manifest.plugins.map((entry) => [entry.name, entry]));
  const visited = new Set<string>();
  const result: MarketplacePluginEntryInfo[] = [];
  const visit = (pluginName: string, requiredBy: string) => {
    const normalizedName = readRequiredString(pluginName, "marketplace plugin name");
    if (visited.has(normalizedName)) {
      return;
    }
    const entry = byName.get(normalizedName);
    if (!entry) {
      throw new Error(`marketplace plugin not found: ${normalizedName}`);
    }
    visited.add(normalizedName);
    result.push(entry);
    for (const dependency of entry.dependencies) {
      visit(normalizeMarketplaceDependency(dependency, marketplaceId, requiredBy), entry.name);
    }
  };
  for (const pluginName of pluginNames) {
    visit(pluginName, pluginName);
  }
  return result;
}

function normalizeMarketplaceDependency(
  dependency: string,
  marketplaceId: string,
  requiredBy: string,
): string {
  const trimmed = dependency.trim();
  const separatorIndex = trimmed.lastIndexOf("@");
  if (separatorIndex < 0) {
    return trimmed;
  }
  const name = trimmed.slice(0, separatorIndex);
  const marketplace = trimmed.slice(separatorIndex + 1);
  if (marketplace === marketplaceId) {
    return name;
  }
  throw new CrossMarketplaceDependencyError(dependency, requiredBy);
}

export class CrossMarketplaceDependencyError extends Error {
  constructor(dependency: string, requiredBy: string) {
    super(
      `cross-marketplace dependency is not supported for SSH source mirror: ${dependency} required by ${requiredBy}`,
    );
    this.name = "CrossMarketplaceDependencyError";
  }
}

async function buildMarketplaceSourceMirrorEntry(
  loaded: MarketplaceSourceLoadResult,
  entry: MarketplacePluginEntryInfo,
): Promise<MarketplaceSourceMirrorEntry> {
  if (isRemoteMarketplacePluginSource(entry.source)) {
    return { entry };
  }
  const sourcePath = await resolveLocalMarketplacePluginSource(loaded, entry);
  const sourceDirectoryName = toSafeDirectoryName(entry.name);
  return {
    entry,
    mirroredSourcePath: sourcePath,
    mirroredSourceRelativePath: `${MIRRORED_MARKETPLACE_PLUGIN_ROOT}/${sourceDirectoryName}`,
  };
}

function isRemoteMarketplacePluginSource(source: unknown): boolean {
  if (!isRecord(source)) {
    return false;
  }
  const sourceKind = typeof source.source === "string" ? source.source : "";
  return ["github", "git", "url", "git-subdir", "npm", "pip"].includes(sourceKind);
}

async function resolveLocalMarketplacePluginSource(
  loaded: MarketplaceSourceLoadResult,
  entry: MarketplacePluginEntryInfo,
): Promise<string> {
  if (typeof entry.source === "string") {
    return await resolveLocalMarketplacePluginSourcePath(
      loaded,
      entry.source,
      `${entry.name} source`,
    );
  }
  if (isRecord(entry.source)) {
    const sourceKind = typeof entry.source.source === "string" ? entry.source.source : "";
    if (sourceKind === "directory" && typeof entry.source.path === "string") {
      return await resolveLocalMarketplacePluginSourcePath(
        loaded,
        entry.source.path,
        `${entry.name} directory source`,
        { allowSettingsAbsoluteDirectorySource: !loaded.sourceRoot },
      );
    }
    return await resolveLocalMarketplacePluginFallback(loaded, entry);
  }
  return await resolveLocalMarketplacePluginFallback(loaded, entry);
}

async function resolveLocalMarketplacePluginFallback(
  loaded: MarketplaceSourceLoadResult,
  entry: MarketplacePluginEntryInfo,
): Promise<string> {
  if (!loaded.sourceRoot) {
    throw new Error(
      `cannot mirror local marketplace plugin source without source root: ${entry.name}`,
    );
  }
  const pluginBaseDir = resolveMarketplacePluginBaseDir(loaded);
  const fallbackPath = resolvePluginSyncPathWithin(pluginBaseDir, entry.name, {
    unsafePathLabel: "unsafe marketplace plugin source path",
  });
  if (await directoryExists(fallbackPath)) {
    return await assertLocalMarketplacePluginSourceRoot(fallbackPath);
  }
  throw new Error(`local marketplace plugin source does not exist: ${fallbackPath}`);
}

async function resolveLocalMarketplacePluginSourcePath(
  loaded: MarketplaceSourceLoadResult,
  sourcePath: string,
  label: string,
  options: { allowSettingsAbsoluteDirectorySource?: boolean } = {},
): Promise<string> {
  const requestedPath = readRequiredString(sourcePath, label);
  const relativeSourcePath = requestedPath.replace(/^\.\//u, "");
  if (!loaded.sourceRoot && options.allowSettingsAbsoluteDirectorySource) {
    if (!isAbsolute(requestedPath)) {
      throw new Error(
        `cannot mirror local marketplace plugin source without source root: ${sourcePath}`,
      );
    }
    const absolutePath = resolve(requestedPath);
    if (await directoryExists(absolutePath)) {
      return await assertLocalMarketplacePluginSourceRoot(absolutePath);
    }
    throw new Error(`local marketplace plugin source does not exist: ${sourcePath}`);
  }
  if (!loaded.sourceRoot) {
    throw new Error(
      `cannot mirror local marketplace plugin source without source root: ${sourcePath}`,
    );
  }
  const pluginBaseDir = resolveMarketplacePluginBaseDir(loaded);
  const relativePath = resolvePluginSyncPathWithin(pluginBaseDir, relativeSourcePath, {
    unsafePathLabel: "unsafe marketplace plugin source path",
  });
  if (await directoryExists(relativePath)) {
    return await assertLocalMarketplacePluginSourceRoot(relativePath);
  }
  throw new Error(`local marketplace plugin source does not exist: ${sourcePath}`);
}

async function assertLocalMarketplacePluginSourceRoot(pluginRoot: string): Promise<string> {
  const manifest = await readPluginManifestInfo(pluginRoot);
  if (!manifest) {
    // marketplace source mirror 只能复制选中插件目录。先验证 plugin manifest，避免被篡改的 marketplace entry
    // 指向普通目录后，把本机敏感文件作为“插件源码”打包发送到 SSH 远端。
    throw new Error(`local marketplace plugin source is missing plugin manifest: ${pluginRoot}`);
  }
  return pluginRoot;
}

function resolveMarketplacePluginBaseDir(loaded: MarketplaceSourceLoadResult): string {
  const sourceRoot = loaded.sourceRoot;
  if (!sourceRoot) {
    throw new Error("cannot resolve marketplace plugin source root");
  }
  if (!loaded.manifest.pluginRoot) {
    return sourceRoot;
  }
  const pluginRoot = resolvePluginSyncPathWithin(sourceRoot, loaded.manifest.pluginRoot, {
    unsafePathLabel: "unsafe marketplace pluginRoot",
  });
  return existsSync(pluginRoot) ? pluginRoot : sourceRoot;
}

function buildMirroredMarketplaceManifest(
  manifest: MarketplaceManifestInfo,
  entries: readonly MarketplaceSourceMirrorEntry[],
): Record<string, unknown> {
  const hasMirroredLocalSource = entries.some((entry) => entry.mirroredSourceRelativePath);
  const rawMetadata = isRecord(manifest.raw.metadata) ? manifest.raw.metadata : {};
  const rawManifest = { ...manifest.raw };
  delete rawManifest.pluginRoot;
  return {
    ...rawManifest,
    name: manifest.name,
    ...(manifest.description ? { description: manifest.description } : {}),
    ...(hasMirroredLocalSource
      ? {
          // agent marketplace 解析只读取 metadata.pluginRoot。
          // 远端镜像 manifest 如果写顶层 pluginRoot，会把 ./hello-world 误解析到市场根目录。
          metadata: {
            ...rawMetadata,
            pluginRoot: MIRRORED_MARKETPLACE_PLUGIN_ROOT,
          },
        }
      : {}),
    plugins: entries.map((entry) => {
      const raw: Record<string, unknown> = { ...entry.entry.raw, name: entry.entry.name };
      if (entry.mirroredSourceRelativePath) {
        raw.source = `./${entry.mirroredSourceRelativePath.split("/").slice(1).join("/")}`;
      }
      return raw;
    }),
  };
}

function createMarketplaceSourceDirectoryName(
  marketplaceId: string,
  manifestContent: string,
  sourceFingerprints: readonly (string | null)[],
): string {
  const hashInput = JSON.stringify({
    manifestContent,
    sourceFingerprints,
  });
  return `${toSafeDirectoryName(marketplaceId)}-${createShortHash(hashInput).slice(0, 12)}`;
}
