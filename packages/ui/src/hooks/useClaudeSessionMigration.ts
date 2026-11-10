import { useCallback, useMemo, useState } from "react";
import type {
  RaspberryCodeImportSessionsResult,
  RaspberryCodeImportableSessionCandidate,
} from "@raspberrycode/shared";
import { logger } from "@/logger.js";
import { useRaspberryCodeTaskService } from "@/hooks/useRaspberryCodeTaskService.js";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";
import { invalidateTaskQueryCacheByScopes } from "@/store/taskQueryCacheStore.js";

export type ClaudeMigrationRange = "all" | "7d" | "30d" | "90d";
type ClaudeMigrationWorkspaceFilterMode = "all" | "current";

/** 可迁移历史的外部工具；Claude 走既有接口，其余走通用外部会话接口。 */
export type SessionMigrationSource = "claude" | "codex" | "opencode";

export const SESSION_MIGRATION_SOURCES: readonly SessionMigrationSource[] = [
  "claude",
  "codex",
  "opencode",
];

function isExternalSource(source: SessionMigrationSource): source is "codex" | "opencode" {
  return source === "codex" || source === "opencode";
}

const DEFAULT_LIMIT = 100;
const MAX_SCAN_LIMIT = 500;
export const UNLIMITED_SCAN_LIMIT_INPUT = "unlimited";

const RANGE_TO_DURATION_MS: Record<Exclude<ClaudeMigrationRange, "all">, number> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

function resolveModifiedSince(range: ClaudeMigrationRange): number | undefined {
  if (range === "all") {
    return undefined;
  }

  return Date.now() - RANGE_TO_DURATION_MS[range];
}

export function resolveClaudeMigrationScanLimit(limitInput: string): number | undefined {
  if (limitInput === UNLIMITED_SCAN_LIMIT_INPUT) {
    return undefined;
  }

  const parsed = Number.parseInt(limitInput.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_SCAN_LIMIT);
}

export interface ClaudeSessionMigrationSupportState {
  supported: boolean;
  reason?: "desktopOnly";
}

function normalizeWorkspaceFilterMode(
  mode: ClaudeMigrationWorkspaceFilterMode,
  workspacePath: string | null,
): ClaudeMigrationWorkspaceFilterMode {
  if (mode === "current" && !workspacePath) {
    return "all";
  }

  return mode;
}

export function useClaudeSessionMigration(params: {
  workspacePath: string | null;
  workspaceIdentity?: string;
  isDesktop?: boolean;
}) {
  const raspberrycodeTaskService = useRaspberryCodeTaskService(
    params.workspacePath ?? undefined,
    undefined,
    params.workspaceIdentity,
  );
  const tabStoreApi = useTabStoreApi();
  const [workspaceFilterModeState, setWorkspaceFilterModeState] =
    useState<ClaudeMigrationWorkspaceFilterMode>("all");
  const [range, setRange] = useState<ClaudeMigrationRange>("30d");
  const [limitInput, setLimitInput] = useState(String(DEFAULT_LIMIT));
  // 来源支持多选：用户可同时勾选多个软件，各自扫描后合并展示，导入时按来源分组执行。
  // 空数组表示没有选中任何来源，此时扫描返回空。
  const [sources, setSourcesState] = useState<SessionMigrationSource[]>(["claude"]);
  const [candidates, setCandidates] = useState<RaspberryCodeImportableSessionCandidate[]>([]);
  // 选择以 provider+sessionId 为键：不同来源的原始 id 可能相同。
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [lastImportResult, setLastImportResult] =
    useState<RaspberryCodeImportSessionsResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const workspaceFilterMode = useMemo(
    () => normalizeWorkspaceFilterMode(workspaceFilterModeState, params.workspacePath),
    [workspaceFilterModeState, params.workspacePath],
  );

  const effectiveWorkspacePath = useMemo(
    () => (workspaceFilterMode === "current" ? (params.workspacePath ?? undefined) : undefined),
    [workspaceFilterMode, params.workspacePath],
  );
  const effectiveWorkspaceIdentity = useMemo(
    () =>
      workspaceFilterMode === "current" ? params.workspaceIdentity?.trim() || undefined : undefined,
    [params.workspaceIdentity, workspaceFilterMode],
  );

  const supportState = useMemo<ClaudeSessionMigrationSupportState>(() => {
    // 关键业务逻辑：Claude 原生历史迁移读取的是“当前机器上的 ~/.claude/projects”。
    // 因此这里只拦 web 场景；workspace 现在只是可选筛选条件，不再决定能力是否可用。
    if (!params.isDesktop) {
      return {
        supported: false,
        reason: "desktopOnly",
      };
    }

    return {
      supported: true,
    };
  }, [params.isDesktop]);

  const scanLimit = useMemo(() => resolveClaudeMigrationScanLimit(limitInput), [limitInput]);

  const setWorkspaceFilterMode = useCallback(
    (mode: ClaudeMigrationWorkspaceFilterMode) => {
      setWorkspaceFilterModeState(normalizeWorkspaceFilterMode(mode, params.workspacePath));
    },
    [params.workspacePath],
  );

  const sessionKey = (provider: string, sessionId: string) => `${provider}:${sessionId}`;

  /** 整体替换来源集合；候选与勾选都按来源成立，必须一起清空。 */
  const setSources = useCallback((next: SessionMigrationSource[]) => {
    setSourcesState([...new Set(next)]);
    setCandidates([]);
    setSelectedKeys([]);
    setScanError(null);
    setImportError(null);
  }, []);

  /** 勾选/取消单个来源。至少保留一个，全部取消等同于「不迁移」。 */
  const toggleSource = useCallback((target: SessionMigrationSource, checked: boolean) => {
    setSourcesState((previous) => {
      const next = checked
        ? [...new Set([...previous, target])]
        : previous.filter((item) => item !== target);
      return next;
    });
    setCandidates([]);
    setSelectedKeys([]);
    setScanError(null);
    setImportError(null);
  }, []);
  const toggleSessionSelection = useCallback((provider: string, sessionId: string) => {
    const key = sessionKey(provider, sessionId);
    setSelectedKeys((previous) =>
      previous.includes(key) ? previous.filter((current) => current !== key) : [...previous, key],
    );
  }, []);

  const selectAllSessions = useCallback(() => {
    setSelectedKeys(
      candidates.map((candidate) => sessionKey(candidate.provider, candidate.sessionId)),
    );
  }, [candidates]);

  const clearSelectedSessions = useCallback(() => {
    setSelectedKeys([]);
  }, []);

  const selectedCandidates = useMemo(
    () =>
      candidates.filter((candidate) =>
        selectedKeys.includes(sessionKey(candidate.provider, candidate.sessionId)),
      ),
    [candidates, selectedKeys],
  );
  const selectedSessionIds = useMemo(
    () => selectedCandidates.map((candidate) => candidate.sessionId),
    [selectedCandidates],
  );
  const selectedProviders = useMemo(
    () => selectedCandidates.map((candidate) => candidate.provider),
    [selectedCandidates],
  );

  const scan = useCallback(async () => {
    if (!supportState.supported) {
      return;
    }

    setIsScanning(true);
    setScanError(null);

    try {
      const sourceLabel = sources.join(",");
      logger.info(
        `[Migration] 开始扫描 sources=${sourceLabel} workspaceFilter=${effectiveWorkspacePath ?? "all"} range=${range} limit=${scanLimit ?? "unlimited"}`,
      );
      if (sources.length === 0) {
        setCandidates([]);
        return;
      }
      const scanParams = {
        workspacePath: effectiveWorkspacePath,
        ...(effectiveWorkspaceIdentity ? { workspaceIdentity: effectiveWorkspaceIdentity } : {}),
        modifiedSince: resolveModifiedSince(range),
        ...(scanLimit === undefined ? {} : { limit: scanLimit }),
      };
      // 每个来源独立查询后合并：Claude 走既有接口，Codex / OpenCode 走通用外部接口。
      // limit 是「每个来源」的上限语义，合并后按活跃时间排序，避免某个来源挤掉其它来源。
      const externalSources = sources.filter(isExternalSource);
      const results = await Promise.all([
        ...(sources.includes("claude")
          ? [raspberrycodeTaskService.scanImportableClaudeSessions(scanParams)]
          : []),
        ...(externalSources.length > 0
          ? [
              raspberrycodeTaskService.scanImportableExternalSessions({
                ...scanParams,
                providers: externalSources,
              }),
            ]
          : []),
      ]);
      const nextCandidates = results.flat().sort((left, right) => right.updatedAt - left.updatedAt);
      setCandidates(nextCandidates);
      // 关键业务逻辑：重扫后只保留仍然可见的勾选项。
      // 这样用户调筛选条件或刷新结果时，不会把已经不在当前列表里的旧 session 混进导入请求。
      setSelectedKeys((previous) =>
        previous.filter((key) =>
          nextCandidates.some(
            (candidate) => sessionKey(candidate.provider, candidate.sessionId) === key,
          ),
        ),
      );
      logger.info(
        `[Migration] 扫描完成 sources=${sourceLabel} workspaceFilter=${effectiveWorkspacePath ?? "all"} count=${nextCandidates.length}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("[Migration] 扫描外部历史失败", error);
      setScanError(message);
    } finally {
      setIsScanning(false);
    }
  }, [
    raspberrycodeTaskService,
    effectiveWorkspaceIdentity,
    effectiveWorkspacePath,
    range,
    scanLimit,
    sources,
    supportState.supported,
  ]);

  /**
   * 导入选中会话。支持多来源：按 provider 分组，各自调用对应接口，
   * 再把三份结果合并成一个 RaspberryCodeImportSessionsResult 返回，
   * 这样调用方（引导执行阶段 / 设置页）不用关心是多来源还是单来源。
   */
  const importSessions = useCallback(
    async (sessionIds: string[]) => {
      if (!supportState.supported || sessionIds.length === 0) {
        return null;
      }

      setIsImporting(true);
      setImportError(null);

      try {
        // 按候选反查 provider：sessionIds 本身不带来源，必须回到 candidates 里定位。
        // 注意用全量 candidates 而不是 selectedCandidates：引导流程是按 workspace
        // 传入 sessionIds 的，此时 selectedKeys 可能为空，用 selectedCandidates 会让
        // 所有会话都退化成默认来源。
        const providerById = new Map(
          candidates.map((candidate) => [candidate.sessionId, candidate.provider]),
        );
        const groups = new Map<string, string[]>();
        for (const sessionId of sessionIds) {
          const provider = providerById.get(sessionId) ?? "claude";
          const bucket = groups.get(provider);
          if (bucket) bucket.push(sessionId);
          else groups.set(provider, [sessionId]);
        }

        logger.info(
          `[Migration] 开始导入 sources=${[...groups.keys()].join(",")} workspaceFilter=${
            effectiveWorkspacePath ?? "all"
          } selected=${sessionIds.length}`,
        );

        const importParams = {
          workspacePath: effectiveWorkspacePath,
          ...(effectiveWorkspaceIdentity ? { workspaceIdentity: effectiveWorkspaceIdentity } : {}),
        };

        // 逐组串行：同来源内部本身已是循环，跨来源串行可以避免并发写 taskIndex 争用。
        const merged: RaspberryCodeImportSessionsResult = {
          imported: [],
          skipped: [],
          failed: [],
        };
        for (const [provider, ids] of groups) {
          const result = isExternalSource(provider as SessionMigrationSource)
            ? await raspberrycodeTaskService.importExternalSessions({
                ...importParams,
                provider: provider as "codex" | "opencode",
                sessionIds: ids,
              })
            : await raspberrycodeTaskService.importClaudeSessions({
                ...importParams,
                sessionIds: ids,
              });
          merged.imported.push(...result.imported);
          merged.skipped.push(...result.skipped);
          merged.failed.push(...result.failed);
        }

        setLastImportResult(merged);
        const handledSessionIds = new Set([
          ...merged.imported.map((item) => item.sessionId),
          ...merged.skipped.map((item) => item.sessionId),
          ...merged.failed.map((item) => item.sessionId),
        ]);
        setSelectedKeys((previous) =>
          previous.filter((key) => {
            const separator = key.indexOf(":");
            const sessionId = separator >= 0 ? key.slice(separator + 1) : key;
            return !handledSessionIds.has(sessionId);
          }),
        );
        if (merged.imported.length > 0) {
          const importedWorkspacePaths = new Set(merged.imported.map((item) => item.workspacePath));
          // Bugfix: 导入之前通过 bumpTaskListVersion 让各处任务列表整轮重查，
          // 但这里真正需要的只是把受影响 workspace 的查询结果失效并重新拉取。
          // 改成局部失效后，仍然能让新导入任务出现在侧边栏，同时避免把无关 workspace 一起带着刷新。
          const importedWorkspaceScopes = merged.imported.map((item) => ({
            workspacePath: item.workspacePath,
          }));
          for (const workspacePath of importedWorkspacePaths) {
            tabStoreApi.getState().ensureWorkspaceTab(workspacePath);
          }
          invalidateTaskQueryCacheByScopes(importedWorkspaceScopes);
        }
        logger.info(
          `[Migration] 导入完成 imported=${merged.imported.length} skipped=${merged.skipped.length} failed=${merged.failed.length}`,
        );
        return merged;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("[Migration] 导入外部历史失败", error);
        setImportError(message);
        return null;
      } finally {
        setIsImporting(false);
      }
    },
    [
      raspberrycodeTaskService,
      candidates,
      effectiveWorkspaceIdentity,
      effectiveWorkspacePath,
      supportState.supported,
      tabStoreApi,
    ],
  );

  const importSelectedSessions = useCallback(async () => {
    return importSessions(selectedSessionIds);
  }, [importSessions, selectedSessionIds]);

  return {
    supportState,
    workspaceFilterMode,
    setWorkspaceFilterMode,
    hasCurrentWorkspaceFilter: params.workspacePath !== null,
    range,
    setRange,
    limitInput,
    setLimitInput,
    scanLimit,
    sources,
    setSources,
    toggleSource,
    candidates,
    selectedSessionIds,
    selectedProviders,
    selectedCount: selectedKeys.length,
    scanError,
    importError,
    lastImportResult,
    isScanning,
    isImporting,
    scan,
    importSessions,
    importSelectedSessions,
    toggleSessionSelection,
    selectAllSessions,
    clearSelectedSessions,
  };
}
