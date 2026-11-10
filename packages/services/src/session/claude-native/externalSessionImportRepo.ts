import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, normalize, resolve } from "node:path";
import { createInterface } from "node:readline";
import type {
  RaspberryCodeImportSessionSourceProvider,
  RaspberryCodeImportableSessionCandidate,
} from "@raspberrycode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { getDataBaseDir } from "#src/paths.js";
import {
  extractCodexSessionMeta,
  extractCodexVisibleMessages,
  previewCodexSessionTitle,
  type CodexVisibleMessage,
} from "#src/session/claude-native/codexSessionParser.js";
import type { JsonLineRecord } from "#src/session/claude-native/jsonLineRecord.js";
import {
  listOpencodeSessions,
  OPENCODE_DB_FILENAME,
  previewOpencodeSessionTitle,
  readOpencodeSessionMessages,
  type OpencodeVisibleMessage,
} from "#src/session/claude-native/opencodeSessionReader.js";

const logger = createServiceLogger("external-session-import");

/** 导入链统一的消息形状；两个新来源都有 timestamp，Claude 侧由各自 parser 保证。 */
export interface ExternalImportedMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

export interface ExternalImportableSession {
  provider: RaspberryCodeImportSessionSourceProvider;
  sessionId: string;
  workspacePath: string;
  sourcePath: string;
  createdAt: number;
  updatedAt: number;
  title?: string;
  model?: string;
  messages: ExternalImportedMessage[];
}

function normalizePathForComparison(path: string): string {
  const normalized = normalize(resolve(path));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function homesToSearch(): string[] {
  const homes = new Set<string>();
  homes.add(homedir());
  const envHome = process.env.HOME?.trim();
  if (envHome) homes.add(envHome);
  const dataBaseDir = getDataBaseDir();
  if (dataBaseDir) homes.add(dataBaseDir);
  return [...homes];
}

function codexSessionsRoots(): string[] {
  return homesToSearch().map((home) => join(home, ".codex", "sessions"));
}

function opencodeDbPaths(): string[] {
  const paths: string[] = [];
  for (const home of homesToSearch()) {
    // Linux/macOS: ~/.local/share/opencode；Windows 同路径布局。
    paths.push(join(home, ".local", "share", "opencode", OPENCODE_DB_FILENAME));
    // XDG_DATA_HOME 覆盖。
    const xdg = process.env.XDG_DATA_HOME?.trim();
    if (xdg) paths.push(join(xdg, "opencode", OPENCODE_DB_FILENAME));
    paths.push(join(home, ".opencode", OPENCODE_DB_FILENAME));
  }
  return [...new Set(paths)];
}

/** RangeError：readline 单行上限，Codex 的 base_instructions 可能很长。 */
async function readJsonLines(filePath: string): Promise<JsonLineRecord[]> {
  const records: JsonLineRecord[] = [];
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          records.push(parsed as JsonLineRecord);
        }
      } catch {
        // 单行损坏不影响整份会话；Codex 运行中可能有半截写入。
      }
    }
    return records;
  } finally {
    reader.close();
    stream.destroy();
  }
}

async function collectCodexSessionFiles(rootDir: string): Promise<string[]> {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const entryPath = join(rootDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await collectCodexSessionFiles(entryPath)));
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(entryPath);
    }
    return files;
  } catch {
    return [];
  }
}

/** Codex 会话 id：session_meta 优先，缺失时退回文件名里的 uuid 段。 */
function codexSessionIdFromFile(filePath: string, metaSessionId: string | undefined): string {
  if (metaSessionId) return metaSessionId;
  return (
    basename(filePath, ".jsonl").replace(/^rollout-[^-]+-?/u, "") || basename(filePath, ".jsonl")
  );
}

function toCodexMessages(messages: readonly CodexVisibleMessage[]): ExternalImportedMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.timestamp ? { timestamp: message.timestamp } : {}),
  }));
}

function toOpencodeMessages(
  messages: readonly OpencodeVisibleMessage[],
): ExternalImportedMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.timestamp ? { timestamp: message.timestamp } : {}),
  }));
}

export class ExternalSessionImportRepo {
  /** 扫描 Codex 会话，只返回能确定 workspace 且至少有一条可见消息的项。 */
  async scanCodexSessions(params: {
    workspacePath?: string;
    modifiedSince?: number;
    limit?: number;
  }): Promise<RaspberryCodeImportableSessionCandidate[]> {
    const workspaceKey = params.workspacePath
      ? normalizePathForComparison(params.workspacePath)
      : null;
    const files = [
      ...new Set(
        (
          await Promise.all(codexSessionsRoots().map((root) => collectCodexSessionFiles(root)))
        ).flat(),
      ),
    ];
    const candidates: RaspberryCodeImportableSessionCandidate[] = [];

    for (const filePath of files) {
      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch {
        continue;
      }
      const updatedAt = Math.trunc(fileStat.mtimeMs);
      if (params.modifiedSince && updatedAt < params.modifiedSince) continue;

      try {
        const records = await readJsonLines(filePath);
        const meta = extractCodexSessionMeta(records);
        if (!meta.workspacePath) continue;
        if (
          workspaceKey !== null &&
          normalizePathForComparison(meta.workspacePath) !== workspaceKey
        ) {
          continue;
        }
        const messages = extractCodexVisibleMessages(records);
        // 无可见对话的 rollout 不进入候选：导入后会是空任务。
        if (messages.length === 0) continue;

        const previewTitle = previewCodexSessionTitle(messages);
        candidates.push({
          provider: "codex",
          sessionId: codexSessionIdFromFile(filePath, meta.sessionId),
          workspacePath: meta.workspacePath,
          sourcePath: filePath,
          updatedAt,
          ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
          ...(previewTitle ? { previewTitle } : {}),
        });
      } catch (error) {
        logger.warn(undefined, `扫描 Codex session 失败 path=${filePath}`, error);
      }
    }

    return this.limit(candidates, params.limit);
  }

  /** 扫描 OpenCode 会话；库文件与表结构都可能不存在，均按空处理。 */
  async scanOpencodeSessions(params: {
    workspacePath?: string;
    modifiedSince?: number;
    limit?: number;
  }): Promise<RaspberryCodeImportableSessionCandidate[]> {
    const workspaceKey = params.workspacePath
      ? normalizePathForComparison(params.workspacePath)
      : null;
    const candidates: RaspberryCodeImportableSessionCandidate[] = [];

    for (const dbPath of opencodeDbPaths()) {
      let sessions;
      try {
        sessions = await listOpencodeSessions(dbPath);
      } catch (error) {
        logger.warn(undefined, `读取 OpenCode 数据库失败 path=${dbPath}`, error);
        continue;
      }

      for (const session of sessions) {
        if (!session.directory) continue;
        if (
          workspaceKey !== null &&
          normalizePathForComparison(session.directory) !== workspaceKey
        ) {
          continue;
        }
        const updatedAt = session.timeUpdated ?? session.timeCreated ?? 0;
        if (params.modifiedSince && updatedAt < params.modifiedSince) continue;

        try {
          const messages = await readOpencodeSessionMessages(dbPath, session.id);
          if (messages.length === 0) continue;
          const previewTitle = previewOpencodeSessionTitle(messages, session.title);
          candidates.push({
            provider: "opencode",
            sessionId: session.id,
            workspacePath: session.directory,
            sourcePath: dbPath,
            updatedAt,
            ...(session.timeCreated ? { createdAt: session.timeCreated } : {}),
            ...(previewTitle ? { previewTitle } : {}),
          });
        } catch (error) {
          logger.warn(undefined, `扫描 OpenCode session 失败 id=${session.id}`, error);
        }
      }
    }

    return this.limit(candidates, params.limit);
  }

  /** 按 provider 分派，统一扫描入口；Claude 仍走既有 repo，不在此重复实现。 */
  async scanExternalSessions(params: {
    providers: readonly RaspberryCodeImportSessionSourceProvider[];
    workspacePath?: string;
    modifiedSince?: number;
    limit?: number;
  }): Promise<RaspberryCodeImportableSessionCandidate[]> {
    const results: RaspberryCodeImportableSessionCandidate[] = [];
    if (params.providers.includes("codex")) {
      results.push(...(await this.scanCodexSessions(params)));
    }
    if (params.providers.includes("opencode")) {
      results.push(...(await this.scanOpencodeSessions(params)));
    }
    results.sort((left, right) => right.updatedAt - left.updatedAt);
    return this.limit(results, params.limit);
  }

  async findImportableSession(params: {
    provider: "codex" | "opencode";
    sessionId: string;
    workspacePath?: string;
  }): Promise<RaspberryCodeImportableSessionCandidate | null> {
    const candidates = await this.scanExternalSessions({
      providers: [params.provider],
      ...(params.workspacePath ? { workspacePath: params.workspacePath } : {}),
    });
    return candidates.find((candidate) => candidate.sessionId === params.sessionId) ?? null;
  }

  /** 完整解析：供导入时构造 snapshot 使用。 */
  async parseSession(params: {
    provider: RaspberryCodeImportSessionSourceProvider;
    sessionId: string;
    workspacePath?: string;
  }): Promise<ExternalImportableSession | null> {
    const candidate = await this.findImportableSession({
      provider: params.provider as "codex" | "opencode",
      sessionId: params.sessionId,
      ...(params.workspacePath ? { workspacePath: params.workspacePath } : {}),
    });
    if (!candidate) return null;

    if (params.provider === "codex") {
      const records = await readJsonLines(candidate.sourcePath);
      const meta = extractCodexSessionMeta(records);
      const visible = extractCodexVisibleMessages(records);
      const messages = toCodexMessages(visible);
      if (messages.length === 0) return null;
      const createdAt = candidate.createdAt ?? messages[0]?.timestamp ?? candidate.updatedAt;
      const updatedAt = messages.at(-1)?.timestamp ?? candidate.updatedAt;
      const title = previewCodexSessionTitle(visible);
      return {
        provider: "codex",
        sessionId: candidate.sessionId,
        workspacePath: meta.workspacePath ?? candidate.workspacePath,
        sourcePath: candidate.sourcePath,
        createdAt,
        updatedAt: Math.max(createdAt, updatedAt),
        ...(title ? { title } : {}),
        ...(meta.model ? { model: meta.model } : {}),
        messages,
      };
    }

    const messages = toOpencodeMessages(
      await readOpencodeSessionMessages(candidate.sourcePath, candidate.sessionId),
    );
    if (messages.length === 0) return null;
    const createdAt = candidate.createdAt ?? messages[0]?.timestamp ?? candidate.updatedAt;
    const updatedAt = messages.at(-1)?.timestamp ?? candidate.updatedAt;
    return {
      provider: "opencode",
      sessionId: candidate.sessionId,
      workspacePath: candidate.workspacePath,
      sourcePath: candidate.sourcePath,
      createdAt,
      updatedAt: Math.max(createdAt, updatedAt),
      ...(candidate.previewTitle ? { title: candidate.previewTitle } : {}),
      messages,
    };
  }

  private limit<T>(items: T[], limit: number | undefined): T[] {
    return typeof limit === "number" && limit > 0 ? items.slice(0, limit) : items;
  }
}

export const externalSessionImportRepo = new ExternalSessionImportRepo();
