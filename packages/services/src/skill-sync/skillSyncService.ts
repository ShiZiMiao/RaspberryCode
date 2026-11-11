import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { SKILL_DATA_SYNC_MAX_ITEM_BYTES } from "@raspberrycode/shared";
import type { ISkillSyncService } from "./skillSync.js";
import {
  MAX_SKILL_SCAN_DEPTH,
  shouldWalkSkillDirectoryEntry,
  walkSkillMarkdownPaths,
} from "../skills/skillDiscoveryWalk.js";
import { createSkillDataSyncMethods } from "../data-sync/node.js";
import { createSkillSyncArchive, extractSkillSyncArchive } from "./skillSyncArchive.js";
import { createSkillSyncSizeLimitError } from "./skillSyncErrors.js";
import { normalizeSkillSyncRelativePath, resolveSkillSyncPathWithin } from "./skillSyncPath.js";
import { checkRemoteSyncDirectoryWriteAccess } from "../remote-sync/remoteSyncWriteAccess.js";

const SKILL_FILE_NAME = "SKILL.md";
const DEFAULT_MAX_ARCHIVE_BYTES = SKILL_DATA_SYNC_MAX_ITEM_BYTES;

/** 用户级技能候选：path 指向技能目录下的 SKILL.md。 */
export interface UserSkillCandidate {
  /** 同步候选稳定标识（名称 + 目录派生），用于跨端选择对齐。 */
  id: string;
  name: string;
  directoryName: string;
  description: string;
  path: string;
  /** 该技能目录的递归字节数，用于归档前的体积上限校验。 */
  sizeBytes: number;
}

export function createSkillSyncService(options?: { maxArchiveBytes?: number }): ISkillSyncService {
  const maxArchiveBytes = options?.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  // 数据同步：单个技能目录的大小上限，默认 20MB。
  return {
    ...createSkillDataSyncMethods({ maxItemBytes: maxArchiveBytes }),
    async listLocalUserSkillCandidates() {
      return {
        candidates: await collectUserSkillCandidates(),
        maxArchiveBytes,
      };
    },
    async listRemoteUserSkillStatuses(params) {
      const root = getUserRaspberrycodeSkillRoot();
      const existingSkillPathByName = await collectUserSkillDirectoryPathByName();
      // 服务通过 RPC 暴露给 renderer / remote 客户端：directoryName 不能只信 UI 候选，
      // 必须在服务端限制为 skills 根内的安全相对路径。
      const directoryNames = params.directoryNames.map((directoryName) =>
        normalizeSkillSyncRelativePath(directoryName),
      );
      const requestedSkillNameByDirectory = new Map(
        (params.skills ?? []).map((skill) => [
          normalizeSkillSyncRelativePath(skill.directoryName),
          skill.name,
        ]),
      );
      return {
        statuses: directoryNames.map((directoryName) => {
          const path = resolveSkillSyncPathWithin(root, directoryName);
          if (existsSync(path)) {
            return { directoryName, exists: true, path };
          }
          const requestedName = requestedSkillNameByDirectory.get(directoryName);
          const existingPath = requestedName
            ? existingSkillPathByName.get(normalizeSkillNameKey(requestedName))
            : undefined;
          return existingPath
            ? { directoryName, exists: true, path: existingPath }
            : { directoryName, exists: false };
        }),
      };
    },
    async exportSkillsArchive(params) {
      const candidates = await collectUserSkillCandidates();
      const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const selected = params.skillIds.map((id) => {
        const candidate = candidateById.get(id);
        if (!candidate) {
          throw new Error(`skill sync candidate not found: ${id}`);
        }
        return candidate;
      });
      const archiveEntries = await Promise.all(
        selected.map(async (candidate) => ({
          sourcePath: await realpath(dirname(candidate.path)),
          archivePath: candidate.directoryName,
        })),
      );
      const selectedBytes = selected.reduce((total, candidate) => total + candidate.sizeBytes, 0);
      if (selectedBytes > maxArchiveBytes) {
        throw createSkillSyncSizeLimitError({
          actualBytes: selectedBytes,
          maxBytes: maxArchiveBytes,
          phase: "selected-content",
        });
      }
      const archive = await createSkillSyncArchive(archiveEntries);
      if (archive.byteLength > maxArchiveBytes) {
        throw createSkillSyncSizeLimitError({
          actualBytes: archive.byteLength,
          maxBytes: maxArchiveBytes,
          phase: "archive",
        });
      }
      return {
        archive,
        archiveBytes: archive.byteLength,
        skills: selected.map(({ id, name, directoryName }) => ({ id, name, directoryName })),
      };
    },
    async checkRemoteUserSkillWriteAccess() {
      return checkRemoteSyncDirectoryWriteAccess(getUserRaspberrycodeSkillRoot());
    },
    async importSkillsArchive(params) {
      if (params.overwrite) {
        throw new Error("skill sync overwrite is not supported");
      }
      if (params.archive.byteLength > maxArchiveBytes) {
        throw createSkillSyncSizeLimitError({
          actualBytes: params.archive.byteLength,
          maxBytes: maxArchiveBytes,
          phase: "archive",
        });
      }
      return await importSkillsArchive(params.archive, maxArchiveBytes);
    },
  };
}

/**
 * 解包技能归档到本端技能根：同名目录已存在则跳过（不覆盖），
 * 单个技能解包后仍受总大小限制约束。
 */
async function importSkillsArchive(
  archive: Uint8Array,
  maxArchiveBytes: number,
): Promise<import("@raspberrycode/shared").SkillSyncImportResult> {
  const tempRoot = join(tmpdir(), `raspberrycode-skill-sync-${randomUUID()}`);
  try {
    await extractSkillSyncArchive(archive, tempRoot, { maxExtractedBytes: maxArchiveBytes });
    const targetRoot = getUserRaspberrycodeSkillRoot();
    await mkdir(targetRoot, { recursive: true });
    const results: import("@raspberrycode/shared").SkillSyncImportResult["results"] = [];
    for (const entry of await readdir(tempRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directoryName = normalizeSkillSyncRelativePath(entry.name);
      const targetPath = resolveSkillSyncPathWithin(targetRoot, directoryName);
      if (existsSync(targetPath)) {
        results.push({ name: entry.name, directoryName, status: "skipped", path: targetPath });
        continue;
      }
      try {
        await cp(join(tempRoot, directoryName), targetPath, { recursive: true });
        results.push({ name: entry.name, directoryName, status: "synced", path: targetPath });
      } catch (error) {
        results.push({
          name: entry.name,
          directoryName,
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

/** 已配置技能目录名 → 该技能所在目录，用于判定目标端是否已有同名技能的其他目录。 */
async function collectUserSkillDirectoryPathByName(): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const candidate of await collectUserSkillCandidates()) {
    const key = normalizeSkillNameKey(candidate.name);
    if (!byName.has(key)) byName.set(key, dirname(candidate.path));
  }
  return byName;
}

export function resolveUserHomeDir(): string {
  return process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir();
}

export function getUserRaspberrycodeSkillRoot(): string {
  return join(resolveUserHomeDir(), ".raspberrycode", "skills");
}

function getUserAgentsSkillRoot(): string {
  return join(resolveUserHomeDir(), ".agents", "skills");
}

/**
 * 用户级技能候选：`~/.raspberrycode/skills` 优先，`~/.agents/skills` 中同目录名或同 name 的项剔除，再按 realpath 去重。
 * 文件数与字节签名由数据同步的 list 自己计算。
 */
export async function collectUserSkillCandidates(): Promise<UserSkillCandidate[]> {
  const seenSkillRealpaths = new Set<string>();
  const userRaspberrycodeSkillRoot = getUserRaspberrycodeSkillRoot();
  const rawRaspberrycodeCandidates = await collectUserSkillCandidatesInRoot(
    userRaspberrycodeSkillRoot,
  );
  const raspberrycodeDirectoryNames = await collectCoveredSkillDirectoryNamesInRoot(
    userRaspberrycodeSkillRoot,
  );
  const raspberrycodeSkillNameKeys = new Set(
    rawRaspberrycodeCandidates.map((candidate) => normalizeSkillNameKey(candidate.name)),
  );
  const raspberrycodeCandidates = await dedupeCandidatesByCanonicalSkillPath(
    rawRaspberrycodeCandidates,
    seenSkillRealpaths,
  );
  const agentsCandidates = await dedupeCandidatesByCanonicalSkillPath(
    (await collectUserSkillCandidatesInRoot(getUserAgentsSkillRoot())).filter(
      (candidate) =>
        !raspberrycodeDirectoryNames.has(candidate.directoryName) &&
        !raspberrycodeSkillNameKeys.has(normalizeSkillNameKey(candidate.name)),
    ),
    seenSkillRealpaths,
  );

  return [...raspberrycodeCandidates, ...agentsCandidates].sort((left, right) =>
    left.directoryName.localeCompare(right.directoryName),
  );
}

async function dedupeCandidatesByCanonicalSkillPath(
  candidates: UserSkillCandidate[],
  seenSkillRealpaths: Set<string>,
): Promise<UserSkillCandidate[]> {
  const result: UserSkillCandidate[] = [];
  for (const candidate of candidates) {
    const canonicalPath = await realpath(candidate.path).catch(() => candidate.path);
    if (seenSkillRealpaths.has(canonicalPath)) {
      continue;
    }
    seenSkillRealpaths.add(canonicalPath);
    result.push(candidate);
  }
  return result;
}

async function collectUserSkillCandidatesInRoot(root: string): Promise<UserSkillCandidate[]> {
  if (!existsSync(root)) {
    return [];
  }
  const candidates: UserSkillCandidate[] = [];
  for await (const skillPath of walkSkillMarkdownPaths(root)) {
    const directoryPath = dirname(skillPath);
    const relativePath = normalizeSkillDirectoryRelativePath(root, directoryPath);
    if (!relativePath) {
      continue;
    }
    const content = await readSkillFileOrNull(skillPath);
    if (content !== null) {
      const metadata = parseSkillMetadata(content, basename(relativePath));
      candidates.push({
        id: `${metadata.name}:${relativePath}`,
        name: metadata.name,
        directoryName: relativePath,
        description: metadata.description,
        path: skillPath,
        sizeBytes: await computeDirectorySize(directoryPath),
      });
    }
  }

  // 远端同步候选必须复用设置页已有的有界扫描策略；
  // 自己维护递归会漏掉 MAX_SKILL_SCAN_DEPTH 和软链 realpath 去重，遇到环形目录软链会卡住。
  return candidates.sort((left, right) => left.directoryName.localeCompare(right.directoryName));
}

async function collectCoveredSkillDirectoryNamesInRoot(root: string): Promise<Set<string>> {
  const directoryNames = new Set<string>();
  if (!existsSync(root)) {
    return directoryNames;
  }
  const stack: Array<{ directoryPath: string; relativePath: string; depth: number }> = [
    { directoryPath: root, relativePath: "", depth: 0 },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const skillFilePath = join(current.directoryPath, SKILL_FILE_NAME);
    if (current.relativePath && (await readSkillFileOrNull(skillFilePath))) {
      directoryNames.add(current.relativePath);
    }
    if (current.depth >= MAX_SKILL_SCAN_DEPTH) {
      continue;
    }
    let entries;
    try {
      entries = await readdir(current.directoryPath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    for (const entry of entries) {
      if (!shouldWalkSkillDirectoryEntry(entry.name)) {
        continue;
      }
      const entryPath = join(current.directoryPath, entry.name);
      const isDirectory =
        entry.isDirectory() ||
        (entry.isSymbolicLink() && (await stat(entryPath).catch(() => undefined))?.isDirectory());
      if (!isDirectory) {
        continue;
      }
      stack.push({
        directoryPath: entryPath,
        relativePath: joinSkillRelativePath(current.relativePath, entry.name),
        depth: current.depth + 1,
      });
    }
  }

  return directoryNames;
}

function normalizeSkillDirectoryRelativePath(root: string, directoryPath: string): string {
  return relative(root, directoryPath).replaceAll("\\", "/");
}

/** 目录递归字节数；不可读的条目按 0 计，避免单点失败阻断整批候选枚举。 */
async function computeDirectorySize(directoryPath: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      total += await computeDirectorySize(entryPath);
      continue;
    }
    try {
      total += (await stat(entryPath)).size;
    } catch {
      // 并发删除或权限不足的条目不计入体积。
    }
  }
  return total;
}

export function normalizeSkillNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function joinSkillRelativePath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

export async function readSkillFileOrNull(skillPath: string): Promise<string | null> {
  try {
    return await readFile(skillPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function parseSkillMetadata(
  content: string,
  fallbackName: string,
): {
  name: string;
  description: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (!match) {
    return { name: fallbackName, description: "" };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? "");
  } catch {
    return { name: fallbackName, description: "" };
  }
  const metadata = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const name =
    typeof metadata.name === "string" && metadata.name.trim() ? metadata.name.trim() : fallbackName;
  const description = typeof metadata.description === "string" ? metadata.description.trim() : "";
  return { name, description };
}
