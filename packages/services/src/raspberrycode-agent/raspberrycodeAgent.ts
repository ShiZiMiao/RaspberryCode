import type { PluginUiToolResultNotification } from "@raspberrycode/shared/mcp-apps";
import type {
  BackgroundBashOutputResult,
  SessionDebugSnapshot,
  RaspberryCodeSessionContentProfile,
} from "@raspberrycode/shared";
/* eslint-disable max-lines -- RaspberryCode agent service 接口集中声明 protocol/session/workspace 方法，拆分会增加 service descriptor 迁移成本。 */
import type { Event, IDisposable } from "@raspberrycode/rpc";
import { ServiceChannels } from "@raspberrycode/shared";
import type { AppUsageRange, AppUsageSnapshot, RaspberryCodeTaskTokenUsageResult } from "@raspberrycode/shared";
import type { DynamicWorkflowMode } from "@raspberrycode/shared";
import type { RaspberryCodeAutomation, RaspberryCodeAutomationRun } from "@raspberrycode/shared";
import type {
  RaspberryCodeStorageStartupState,
  RaspberryCodeDeliveryKind,
  RaspberryCodeAgentMcpServer,
  RaspberryCodeBackgroundTurnAttribution,
  TraceId,
  RaspberryCodeSessionCompactResult,
  RaspberryCodeSessionGoalAction,
  RaspberryCodeSessionGoalResult,
  RaspberryCodeMessageWithParts,
  ModelSelection,
  RaspberryCodeSessionImportHistory,
  RaspberryCodePermissionRequestParams,
  AgentLaneResourceSample,
  RaspberryCodeMcpTelemetryEvent,
  RaspberryCodeMcpResourceSample,
  RaspberryCodeToolExecResource,
  RaspberryCodeProcessChildProcess,
  RaspberryCodeMcpListResult,
  RaspberryCodePluginsListResult,
  RaspberryCodePluginsOverviewResult,
  RaspberryCodePluginsMarketplaceMutationResult,
  RaspberryCodePluginsInstallResult,
  RaspberryCodePluginsReferenceCatalogResult,
  RaspberryCodeSkillsReferenceCatalogResult,
  RaspberryCodeMcpReadResourceResult,
  RaspberryCodeMcpUiCallToolResult,
  RaspberryCodeMcpUiCancelCallResult,
  RaspberryCodeMcpUiReadResourceResult,
  RaspberryCodeMcpUiListResourcesResult,
  RaspberryCodeMcpUiAppToolAcceptedResult,
  RaspberryCodeMcpUiRegisterAppToolsResult,
  RaspberryCodeMcpUiUnregisterAppToolsResult,
  RaspberryCodeMcpUiListResourceTemplatesResult,
  RaspberryCodePluginsListUiSurfacesResult,
  RaspberryCodeWorkflowsDeleteResult,
  RaspberryCodeWorkflowsForRunResult,
  RaspberryCodeWorkflowsGetResult,
  RaspberryCodeWorkflowsListResult,
  RaspberryCodeWorkflowsMoveResult,
  RaspberryCodeWorkflowsRunsResult,
  RaspberryCodeWorkflowsSaveResult,
  RaspberryCodeWorkflowsUpdateMetaResult,
  RaspberryCodePluginsUninstallResult,
  RaspberryCodePluginsRestoreBuiltinResult,
  RaspberryCodePluginsConfigureResult,
  RaspberryCodePluginsDescribeResult,
  RaspberryCodePluginsValidateResult,
  RaspberryCodePluginsSetEnabledResult,
  RaspberryCodePluginsCancelOperationResult,
  RaspberryCodePluginOperationProgressNotification,
  RaspberryCodeProviderRuntimeHeadersRequestParams,
  RaspberryCodeProviderRuntimeHeadersCancelled,
  RaspberryCodeProviderTestModelConnectivityParams,
  RaspberryCodeProviderTestModelConnectivityResult,
  RaspberryCodeUserInputRequestParams,
  RaspberryCodeUserInputResponse,
  RaspberryCodeSessionEvent,
  RaspberryCodeSessionInfo,
  RaspberryCodeSessionMode,
  RaspberryCodeSessionPersistence,
  RaspberryCodeSessionSendResult,
  RaspberryCodeSessionRequestRuntimePreferencesParams,
  RaspberryCodeSessionRuntimePreferencesResult,
  RaspberryCodeSessionStateSnapshot,
  RaspberryCodeSessionSubagentsResult,
  RaspberryCodeStateUpdatedNotification,
  RaspberryCodeTaskClientMode,
  RaspberryCodeBrowserAmbientContext,
  RaspberryCodeWorkspacePresentation,
  RaspberryCodeWorkspaceGenerateTextResult,
  RaspberryCodeWorkspaceGenerateTextParams,
  RaspberryCodeWorkspaceHookTrustGrantResult,
  RaspberryCodeAutomationBotDeliveryTarget,
} from "@raspberrycode/shared";
import type {
  ClientHello,
  CommandAck,
  CommandEnvelope,
  CommandKey,
  CommandsQueryResult,
  ConversationTopicWireCandidate,
  ConversationTelemetryFact,
  CuaPermissionObservation,
  ConversationRowTarget,
  HelloMessage,
  SessionsIndexTopicWireCandidate,
  SessionsIndexReconcileResult,
  V4AttachmentBeginResult,
  V4AttachmentChunkResult,
  V4AttachmentCommitResult,
  V4AttachmentPreviewSourceResult,
  V4AttachmentReadResult,
  V4ConversationAttachmentReadResult,
  V4ConversationAttachmentStatResult,
  V4ConnectionFlowState,
  V4ConversationFileChangesResult,
  V4ConversationFileRewindPreviewResult,
  V4ConversationPlansResult,
  V4ConversationWorkflowRunEventsResult,
  V4ConversationWorkflowRunArtifactDataResult,
  V4ConversationWorkflowRunArtifactReadResult,
  V4ConversationWorkflowRunArtifactsResult,
  V4ConversationWorkflowRunNodeResultResult,
  V4ConversationWorkflowRunWorkspaceResult,
  V4ConversationWorkflowRunsResult,
  V4ConversationRowsRangeResult,
  V4ConversationResyncResult,
  V4ConversationSubscribeResult,
  V4SessionsIndexSubscribeResult,
  V4WorkspaceConfigSubscribeResult,
  WorkspaceConfigTopicWireCandidate,
} from "@raspberrycode/shared/raspberrycode-protocol-v4";
import { createServiceDescriptor } from "../descriptors.js";

export * from "./raspberrycodeAgentPluginParams.js";
export * from "./raspberrycodeAgentWorkflowParams.js";
import type {
  RaspberryCodeAgentAddPluginMarketplaceParams,
  RaspberryCodeAgentAutomationIdParams,
  RaspberryCodeAgentCancelPluginOperationParams,
  RaspberryCodeAgentConfigurePluginParams,
  RaspberryCodeAgentResetPluginConfigParams,
  RaspberryCodeAgentCreateAutomationParams,
  RaspberryCodeAgentDeleteAutomationRunParams,
  RaspberryCodeAgentDescribePluginParams,
  RaspberryCodeAgentInstallPluginParams,
  RaspberryCodeAgentListMcpServerStatusesParams,
  RaspberryCodeAgentPluginViewParams,
  RaspberryCodeAgentPluginReferenceCatalogParams,
  RaspberryCodeAgentSkillReferenceCatalogParams,
  RaspberryCodeAgentReadMcpResourceParams,
  RaspberryCodeAgentReadMcpResourceForUiParams,
  RaspberryCodeAgentListMcpResourcesForUiParams,
  RaspberryCodeAgentAppToolCallForUiParams,
  RaspberryCodeAgentAppToolInstanceForUiParams,
  RaspberryCodeAgentRegisterAppToolsForUiParams,
  RaspberryCodeAgentResolveAppToolCallForUiParams,
  RaspberryCodeAgentMcpResourceSubscriptionForUiParams,
  RaspberryCodeAgentCallMcpToolForUiParams,
  RaspberryCodeAgentCancelMcpToolCallForUiParams,
  RaspberryCodeAgentResolveSuggestedPluginReferenceParams,
  RaspberryCodeAgentRemovePluginMarketplaceParams,
  RaspberryCodeAgentRestoreBuiltinPluginParams,
  RaspberryCodeAgentSetPluginEnabledParams,
  RaspberryCodeAgentSetAutomationEnabledParams,
  RaspberryCodeAgentUninstallPluginParams,
  RaspberryCodeAgentUpdatePluginMarketplaceParams,
  RaspberryCodeAgentUpdatePluginParams,
  RaspberryCodeAgentUpdateAutomationParams,
  RaspberryCodeAgentValidatePluginParams,
  RaspberryCodeAgentWorkspaceTarget,
} from "./raspberrycodeAgentPluginParams.js";
import type {
  RaspberryCodeAgentDeleteSavedWorkflowParams,
  RaspberryCodeAgentFindSavedWorkflowForRunParams,
  RaspberryCodeAgentGetSavedWorkflowParams,
  RaspberryCodeAgentListSavedWorkflowRunsParams,
  RaspberryCodeAgentListSavedWorkflowsParams,
  RaspberryCodeAgentMoveSavedWorkflowParams,
  RaspberryCodeAgentSaveSavedWorkflowFromRunParams,
  RaspberryCodeAgentUpdateSavedWorkflowMetaParams,
} from "./raspberrycodeAgentWorkflowParams.js";

export interface RaspberryCodeAgentSessionTarget extends RaspberryCodeAgentWorkspaceTarget {
  sessionId: string;
}

export interface RaspberryCodeAgentResumeSessionParams extends RaspberryCodeAgentSessionTarget {
  additionalDirectories?: string[];
  model?: ModelSelection;
  thoughtLevel?: string;
  mcpServers?: RaspberryCodeAgentMcpServer[];
  // 冷恢复会重建 runtime，工具面隔离必须和 create 保持同一安全边界（CUA 只放行 raspberrycode-cua 工具、
  // 禁 Bash 等）。否则 resume 后模型可见工具面/执行权限会比创建时更宽。
  toolAllowlist?: string[];
  toolDenylist?: string[];
}

export interface RaspberryCodeAgentInitializeResult {
  available: boolean;
  workspaceKey: string;
  protocolName?: string;
  protocolVersion?: number;
  transportKind?: "stdio" | "websocket";
  reason?: string;
  reasonCode?: "provider_not_ready";
}

export interface RaspberryCodeAgentRunAutomationNowResult {
  status: "queued" | "duplicate";
}

export interface RaspberryCodeAgentWorkspaceRuntimeIdentity {
  generation: number;
  identity: string;
  processId?: number;
  workspaceKey: string;
}

export const RASPBERRYCODE_AGENT_RUNTIME_UNAVAILABLE_CODE = "RASPBERRYCODE_AGENT_RUNTIME_UNAVAILABLE";

export type RaspberryCodeAgentRuntimePolicy = "start-if-needed" | "existing-only";

export interface RaspberryCodeAgentRuntimeLifecycleEvent extends RaspberryCodeAgentWorkspaceTarget {
  workspaceKey: string;
  runtimeIdentity: RaspberryCodeAgentWorkspaceRuntimeIdentity;
  state: "available" | "unavailable";
}

export type RaspberryCodeAgentCuaPermissionObservation = CuaPermissionObservation &
  RaspberryCodeAgentWorkspaceTarget;

export interface RaspberryCodeAgentCreateSessionParams extends RaspberryCodeAgentWorkspaceTarget {
  projectId?: string | null;
  additionalDirectories?: string[];
  sessionId?: string;
  sessionTraceId?: TraceId;
  parentSessionId?: string;
  mode?: RaspberryCodeSessionMode;
  model?: ModelSelection;
  persistence?: RaspberryCodeSessionPersistence;
  thoughtLevel?: string;
  /** automation 执行会话关闭模型二次命名，保持首条用户 query 作为稳定标题。 */
  titleGenerationEnabled?: boolean;
  mcpServers?: RaspberryCodeAgentMcpServer[];
  toolAllowlist?: string[];
  toolDenylist?: string[];
  importedHistory?: RaspberryCodeSessionImportHistory;
}

export interface RaspberryCodeAgentListSessionsParams extends RaspberryCodeAgentWorkspaceTarget {
  sessionIds?: string[];
  runtimePolicy?: RaspberryCodeAgentRuntimePolicy;
  limit?: number;
}

export interface RaspberryCodeAgentListSessionSubagentsParams extends RaspberryCodeAgentSessionTarget {
  endedCursor?: string;
  endedLimit?: number;
  /** 远程 workspace 的宿主连接身份；只用于选择现有 Host，不进入 CLI wire query。 */
  remoteSessionId?: string;
}

export interface RaspberryCodeAgentAppUsageParams {
  range: AppUsageRange;
  timeZone?: string;
}

export interface RaspberryCodeAgentTaskTokenUsageParams extends RaspberryCodeAgentSessionTarget {}

export interface RaspberryCodeAgentReadSessionParams extends RaspberryCodeAgentSessionTarget {
  deliveryKind?: RaspberryCodeDeliveryKind;
  messageLimit?: number;
  afterSeq?: number;
  /** 被动索引/观察者只能读取现有 runtime，禁止为了读快照拉起 session。 */
  runtimePolicy?: RaspberryCodeAgentRuntimePolicy;
  /** "index" 仅供 task index：返回剥离大载荷的同结构 snapshot，禁止回写 UI 状态。 */
  contentProfile?: RaspberryCodeSessionContentProfile;
}

export interface RaspberryCodeAgentReadSessionMessagesParams extends RaspberryCodeAgentSessionTarget {
  afterMessageId?: string;
  limit?: number;
}

export interface RaspberryCodeAgentReadSessionEventsParams extends RaspberryCodeAgentSessionTarget {
  afterSeq?: number;
  limit?: number;
}

export type RaspberryCodeAgentReadWorkspacePresentationParams = RaspberryCodeAgentWorkspaceTarget;

export interface RaspberryCodeAgentGrantWorkspaceHookTrustParams extends RaspberryCodeAgentWorkspaceTarget {
  bundleDigest: string;
  hookDeclarationDigest: string;
}

export interface RaspberryCodeAgentSendPromptParamsBase extends RaspberryCodeAgentSessionTarget {
  modelSelection?: ModelSelection;
  modelExecution?: import("@raspberrycode/shared/raspberrycode-protocol-v4").CommandPayloadMap["sendText"]["modelExecution"];
  inputId?: string;
  queryId?: string;
  messageId?: string;
  sessionTraceId?: TraceId;
  content: string;
  attachments?: Record<string, unknown>[];
  /** provider-only 的当前 IAB 状态；UI/session persistence 仍使用 content 原文。 */
  browserAmbientContext?: RaspberryCodeBrowserAmbientContext;
  clientMode?: RaspberryCodeTaskClientMode;
  expectedRevision?: number;
  expectedProviderRevision?: string;
  runtimeProviderHeaders?: Record<string, string>;
  toolDenylist?: string[];
  /** Bot 来源 turn 的稳定回推地址；只在当前 turn 内供 CronCreate 读取。 */
  botDeliveryTarget?: RaspberryCodeAutomationBotDeliveryTarget;
}

export type RaspberryCodeAgentSendPromptParams = RaspberryCodeAgentSendPromptParamsBase &
  RaspberryCodeBackgroundTurnAttribution;

export interface RaspberryCodeAgentCompactParams extends RaspberryCodeAgentSessionTarget {
  inputId?: string;
  instructions?: string;
  expectedRevision?: number;
}

export interface RaspberryCodeAgentGoalParams extends RaspberryCodeAgentSessionTarget {
  inputId?: string;
  action: RaspberryCodeSessionGoalAction;
  objective?: string;
  expectedRevision?: number;
}

export interface RaspberryCodeAgentSetModelParams extends RaspberryCodeAgentSessionTarget {
  model: ModelSelection;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface RaspberryCodeAgentSetThoughtLevelParams extends RaspberryCodeAgentSessionTarget {
  thoughtLevel?: string;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface RaspberryCodeAgentSetModeParams extends RaspberryCodeAgentSessionTarget {
  mode: RaspberryCodeSessionMode;
  expectedRevision?: number;
}

export interface RaspberryCodeAgentGenerateWorkspaceTextParams extends RaspberryCodeAgentWorkspaceTarget {
  selection: RaspberryCodeWorkspaceGenerateTextParams["selection"];
  prompt?: string;
  messages?: RaspberryCodeWorkspaceGenerateTextParams["messages"];
  tools?: RaspberryCodeWorkspaceGenerateTextParams["tools"];
  querySource: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /**
   * 协议层 RPC 超时。thinking 模型的长请求会超过协议 client 默认的
   * 3 分钟；调用方必须把自身 deadline 透传到这里，否则默认超时先触发、
   * 还会被 onRequestTimeout 误判 stale 杀进程。
   */
  requestTimeoutMs?: number;
}

export interface RaspberryCodeAgentTestModelConnectivityParams extends RaspberryCodeAgentWorkspaceTarget {
  selection: RaspberryCodeProviderTestModelConnectivityParams["selection"];
  signal?: AbortSignal;
}

// 合并时曾混用 Agent 完整鉴权响应；UI 只能回传请求校验，账号鉴权必须由 Host 合成。
export type ProviderRuntimeHeadersUiResponse =
  | { headersApplied: true; runtimeProviderHeaders: Record<string, string>; errorMessage?: string }
  | { headersApplied: false; errorMessage?: string };

export interface RaspberryCodeAgentRespondProviderRuntimeHeadersParams extends RaspberryCodeAgentSessionTarget {
  requestId: string;
  response: ProviderRuntimeHeadersUiResponse;
}

export interface RaspberryCodeAgentSessionRuntimePreferencesRequest extends RaspberryCodeSessionRequestRuntimePreferencesParams {
  requestId: string;
}

export interface RaspberryCodeAgentRespondSessionRuntimePreferencesParams {
  requestId: string;
  resolution:
    | { status: "resolved"; preferences: RaspberryCodeSessionRuntimePreferencesResult }
    | { status: "failed"; message: string };
}

export interface RaspberryCodeAgentSessionSubscribeParams extends RaspberryCodeAgentSessionTarget {
  deliveryKind: RaspberryCodeDeliveryKind;
  afterSeq?: number;
  includeSnapshot?: boolean;
  eventCoalescing?: {
    mode: "background-summary";
    intervalMs?: number;
  };
}

// ── v4 conversation 通道（竖切）──
// host 只做转发：subscribe/unsubscribe/command 透传给 CLI v4 gateway，
// v4/conversation/frame 通知按 workspace fan-out 给 renderer。

export interface RaspberryCodeAgentConversationSubscribeParams extends RaspberryCodeAgentSessionTarget {
  retryInitialization?: string;
  /** 水位不变量：仅当客户端真持有该时刻一致状态才允许带。 */
  base?: { logEpoch: string; seq: number };
  visibility?: "foreground" | "background";
}

export interface RaspberryCodeAgentConversationUnsubscribeParams extends RaspberryCodeAgentWorkspaceTarget {
  subscriptionId: string;
  runtimePolicy?: RaspberryCodeAgentRuntimePolicy;
}

export interface RaspberryCodeAgentConversationResyncParams extends RaspberryCodeAgentWorkspaceTarget {
  subscriptionId: string;
  base: { logEpoch: string; seq: number } | null;
  forceSnapshot?: boolean;
  runtimePolicy?: RaspberryCodeAgentRuntimePolicy;
}

/** 行分页 query（rows/range）：按游标向上取一窗历史行。 */
export interface RaspberryCodeAgentConversationRowsRangeParams extends RaspberryCodeAgentSessionTarget {
  /** 取 rowId < beforeRowId 的行；缺省 = 从当前尾部向前。 */
  beforeRowId?: number;
  /** 1..rowsRangeMaxLimit（200）。 */
  limit: number;
}

/** 当前有效分支里的终态 ExitPlanMode 目录。 */
export type RaspberryCodeAgentConversationPlansParams = RaspberryCodeAgentSessionTarget;

/** workflow run 的事件日志分页（详情页审计面）；cursor = journal sequence。 */
export interface RaspberryCodeAgentConversationWorkflowRunEventsParams extends RaspberryCodeAgentSessionTarget {
  runId: string;
  afterSequence?: number;
  limit?: number;
}

/** dwf run 的枚举（重启后的发现查询）。 */
export interface RaspberryCodeAgentConversationWorkflowRunsParams extends RaspberryCodeAgentSessionTarget {
  limit?: number;
}

// ── dwf 用户面产物──
// ⚠ 术语：artifact = 脚本经 `artifact.*` 发布给**用户**看的产出（文件 / markdown / 预置看板），
// 不是 run 的顶层返回值（引擎内部对后者的同名叫法）。

/** 产物清单；UI 冷恢复与中枢详情的 durable 读法。 */
export interface RaspberryCodeAgentConversationWorkflowRunArtifactsParams extends RaspberryCodeAgentSessionTarget {
  runId: string;
}

/** 预置看板的取数面；cursor = journal sequence（严格大于）。 */
export interface RaspberryCodeAgentConversationWorkflowRunArtifactDataParams extends RaspberryCodeAgentSessionTarget {
  runId: string;
  artifactId: string;
  afterSequence?: number;
  limit?: number;
}

/** 内容产物的字节，一次一块（≤ 512 KiB，形状逐字照 attachmentRead）。 */
export interface RaspberryCodeAgentConversationWorkflowRunArtifactReadParams extends RaspberryCodeAgentSessionTarget {
  runId: string;
  artifactId: string;
  version: number;
  offset: number;
  limit: number;
}

// ── dwf 工作区 transcript──
/** 轻行清单：一个 run 的 files.* / git.* / world.run 行，不带正文。 */
export interface RaspberryCodeAgentConversationWorkflowRunWorkspaceParams extends RaspberryCodeAgentSessionTarget {
  runId: string;
}

/** 一个工作区节点的正文，按 maxBytes 保形有界化（缺省与上限在 CLI 网关侧）。 */
export interface RaspberryCodeAgentConversationWorkflowRunNodeResultParams extends RaspberryCodeAgentSessionTarget {
  runId: string;
  siteId: string;
  ordinal: number;
  maxBytes?: number;
}

export interface RaspberryCodeAgentBackgroundBashOutputParams extends RaspberryCodeAgentSessionTarget {
  workId: string;
}

export interface RaspberryCodeAgentConversationFileChangesParams extends RaspberryCodeAgentSessionTarget {
  target: ConversationRowTarget;
  baseRevision: number;
  baseLogEpoch: string;
}

export interface RaspberryCodeAgentConversationFileRewindPreviewParams extends RaspberryCodeAgentSessionTarget {
  target: ConversationRowTarget;
  baseRevision: number;
  baseLogEpoch: string;
}

export interface RaspberryCodeAgentConversationCommandParams extends RaspberryCodeAgentWorkspaceTarget {
  /** 仅 Host 消费；显式 NULL 表示全局任务，不向 CLI 发送项目概念。 */
  projectId?: string | null;
  envelope: CommandEnvelope;
  /** 仅 host 内部用于 Browser Use runtime 边界，不进入 v4 wire envelope。 */
  clientMode?: RaspberryCodeTaskClientMode;
}

export interface RaspberryCodeAgentCommandsQueryParams extends RaspberryCodeAgentWorkspaceTarget {
  clock?: true;
  commands: CommandKey[];
}

/** UI 不携带 connectionId；connection scope 以 trusted carrier 注入 wire identity。 */
export interface RaspberryCodeAgentAttachmentBeginParams extends RaspberryCodeAgentSessionTarget {
  uploadId: string;
  fileName: string;
  mime: string;
  totalBytes: number;
  totalChunks: number;
  checksum: string;
}

export interface RaspberryCodeAgentAttachmentChunkParams extends RaspberryCodeAgentSessionTarget {
  uploadId: string;
  chunkIndex: number;
  dataBase64: string;
}

export interface RaspberryCodeAgentAttachmentTerminalParams extends RaspberryCodeAgentSessionTarget {
  uploadId: string;
}

export interface RaspberryCodeAgentAttachmentReadParams extends RaspberryCodeAgentSessionTarget {
  ref: string;
  target?: ConversationRowTarget;
  attachmentIndex?: number;
  offset: number;
  limit: number;
}

export interface RaspberryCodeAgentConversationAttachmentReadParams extends RaspberryCodeAgentSessionTarget {
  ref: string;
  target: ConversationRowTarget;
  attachmentIndex: number;
  offset: number;
  limit: number;
}

export interface RaspberryCodeAgentConversationAttachmentStatParams extends RaspberryCodeAgentSessionTarget {
  ref: string;
  target: ConversationRowTarget;
  attachmentIndex: number;
}

export interface RaspberryCodeAgentAttachmentPreviewSourceParams extends RaspberryCodeAgentSessionTarget {
  ref: string;
  target?: ConversationRowTarget;
  attachmentIndex?: number;
}

/** host scope 内部 transport 控制面；connectionId 只能经 trusted carrier 注入。 */
export interface RaspberryCodeAgentConnectionFlowParams extends RaspberryCodeAgentWorkspaceTarget {
  state: V4ConnectionFlowState;
}

/** sessions-index：workspace 级列表订阅（无 sessionId 维度）。 */
export interface RaspberryCodeAgentSessionsIndexSubscribeParams extends RaspberryCodeAgentWorkspaceTarget {
  base?: { logEpoch: string; seq: number };
  visibility?: "foreground" | "background";
  /**
   * 订阅者作用域后缀：CLI 侧重订阅替换按 (connectionId, topic) 判定，
   * host 进程内多个独立消费者（renderer 侧栏 / task-index syncer）订阅同一 topic 时
   * 必须用不同 connectionId，否则互相替换对方的订阅代际。缺省共享 host 连接 id。
   */
  subscriberScope?: string;
  /**
   * task-list 等被动观察者必须使用 existing-only；runtime 不存在时返回稳定 unavailable，
   * 禁止为了建立列表订阅而启动 Agent。缺省保持显式会话入口的旧行为。
   */
  runtimePolicy?: RaspberryCodeAgentRuntimePolicy;
}

/** workspace-config：workspace 级配置目录订阅（config options + slash 目录）。 */
export interface RaspberryCodeAgentWorkspaceConfigSubscribeParams extends RaspberryCodeAgentWorkspaceTarget {
  base?: { logEpoch: string; seq: number };
  visibility?: "foreground" | "background";
  subscriberScope?: string;
  runtimePolicy?: RaspberryCodeAgentRuntimePolicy;
}

export type RaspberryCodeAgentServiceEvent =
  | { type: "session.event"; event: RaspberryCodeSessionEvent }
  | { type: "state.updated"; notification: RaspberryCodeStateUpdatedNotification }
  | { type: "permission.request"; request: RaspberryCodePermissionRequestParams }
  | { type: "userInput.request"; request: RaspberryCodeUserInputRequestParams }
  | {
      type: "userInput.response";
      requestId: string;
      response: RaspberryCodeUserInputResponse;
    }
  | { type: "providerRuntimeHeaders.request"; request: RaspberryCodeProviderRuntimeHeadersRequestParams }
  | { type: "snapshot"; snapshot: RaspberryCodeSessionStateSnapshot };

export interface RaspberryCodeAgentAppRuntimePreferences {
  askUserQuestionAutoResolutionEnabled: boolean;
  modelIoFullRetentionEnabled?: boolean;
}

export interface RaspberryCodeAgentLocalRuntimeChildProcesses {
  pid: number;
  provider: string;
  workspacePath: string;
  lane?: string;
  children: RaspberryCodeProcessChildProcess[];
}

export interface RaspberryCodeAgentStorageStartupSnapshot {
  generation: number;
  state: RaspberryCodeStorageStartupState | null;
}

export interface IRaspberryCodeAgentService {
  /** 控制面不需要账号或模型，且不发送普通协议请求。 */
  prepareStorage(params: RaspberryCodeAgentWorkspaceTarget): Promise<void>;
  getStorageStartupState(
    params: RaspberryCodeAgentWorkspaceTarget,
  ): Promise<RaspberryCodeAgentStorageStartupSnapshot | null>;
  onDynamicStorageStartupState(
    params: RaspberryCodeAgentWorkspaceTarget,
  ): Event<RaspberryCodeAgentStorageStartupSnapshot>;
  initialize(params: RaspberryCodeAgentWorkspaceTarget): Promise<RaspberryCodeAgentInitializeResult>;
  /**
   * 同步 App 全局运行时偏好到所有已活动 workspace；不得为此启动空闲 Agent。
   */
  syncAppRuntimePreferences(preferences: RaspberryCodeAgentAppRuntimePreferences): Promise<void>;
  /**
   * 动态工作流用户选择变化的信号（docs/dynamic-workflow/launch.md「The user's choice」）：Host 重新计算
   * 生效模式并串行重发 workspace/updateDynamicWorkflowPolicy。有本机设置权威的 Host 以设置文件为准；
   * desktop-attached remote Host 以传入值为准（缺席 = 跟随服务端）。不得为此启动空闲 Agent。
   */
  syncDynamicWorkflowUserMode(params: { mode?: DynamicWorkflowMode }): Promise<void>;
  getWorkspaceRuntimeIdentity(
    params: RaspberryCodeAgentWorkspaceTarget,
  ): Promise<RaspberryCodeAgentWorkspaceRuntimeIdentity>;
  createSession(params: RaspberryCodeAgentCreateSessionParams): Promise<RaspberryCodeSessionStateSnapshot>;
  resumeSession(params: RaspberryCodeAgentResumeSessionParams): Promise<RaspberryCodeSessionStateSnapshot>;
  listSessions(params: RaspberryCodeAgentListSessionsParams): Promise<RaspberryCodeSessionInfo[]>;
  listSessionSubagents(
    params: RaspberryCodeAgentListSessionSubagentsParams,
  ): Promise<RaspberryCodeSessionSubagentsResult>;
  getAppUsageStats(params: RaspberryCodeAgentAppUsageParams): Promise<AppUsageSnapshot>;
  getTaskTokenUsage(params: RaspberryCodeAgentTaskTokenUsageParams): Promise<RaspberryCodeTaskTokenUsageResult>;
  readSession(params: RaspberryCodeAgentReadSessionParams): Promise<RaspberryCodeSessionStateSnapshot>;
  readSessionMessages(
    params: RaspberryCodeAgentReadSessionMessagesParams,
  ): Promise<RaspberryCodeMessageWithParts[]>;
  readSessionDebug(params: RaspberryCodeAgentSessionTarget): Promise<SessionDebugSnapshot>;
  readSessionEvents(params: RaspberryCodeAgentReadSessionEventsParams): Promise<RaspberryCodeSessionEvent[]>;
  readWorkspacePresentation(
    params: RaspberryCodeAgentReadWorkspacePresentationParams,
  ): Promise<RaspberryCodeWorkspacePresentation>;
  /** 无 task/session 的 Settings 预信任；Agent 会重新发现并校验 canonical snapshot。 */
  grantWorkspaceHookTrust(
    params: RaspberryCodeAgentGrantWorkspaceHookTrustParams,
  ): Promise<RaspberryCodeWorkspaceHookTrustGrantResult>;
  listMcpServerStatuses(params: RaspberryCodeAgentListMcpServerStatusesParams): Promise<RaspberryCodeMcpListResult>;
  listPlugins(params: RaspberryCodeAgentPluginViewParams): Promise<RaspberryCodePluginsListResult>;
  /**
   * Plugin 对话引用 catalog：session-scoped 只读投影。
   * 走 workspace 级 agent client（session 记录只存在于该进程），不走独立插件管理进程。
   */
  getPluginReferenceCatalog(
    params: RaspberryCodeAgentPluginReferenceCatalogParams,
  ): Promise<RaspberryCodePluginsReferenceCatalogResult>;
  /** Composer Skill 引用 catalog；带 sessionId 时读取该 runtime 的冻结快照。 */
  getSkillReferenceCatalog(
    params: RaspberryCodeAgentSkillReferenceCatalogParams,
  ): Promise<RaspberryCodeSkillsReferenceCatalogResult>;
  /** 插件 UI：读取插件 MCP 的 `ui://` 资源；走 session 所在 workspace agent 进程。 */
  openMcpUiInstance(
    params: import("../plugin-ui-bridge/contract.js").PluginUiPrepareSandboxParams & {
      accountContext?: string;
    },
  ): Promise<import("@raspberrycode/shared/mcp-apps").McpAppInstance>;
  validateMcpUiInstance(
    params: import("../plugin-ui-bridge/contract.js").PluginUiPluginScope,
  ): Promise<void>;
  recycleMcpUiInstance(
    params: import("../plugin-ui-bridge/contract.js").PluginUiPluginScope,
  ): Promise<boolean>;
  closeMcpUiInstance(
    params: import("../plugin-ui-bridge/contract.js").PluginUiPluginScope,
  ): Promise<void>;
  readMcpResource(params: RaspberryCodeAgentReadMcpResourceParams): Promise<RaspberryCodeMcpReadResourceResult>;
  /** 插件 UI：UI 发起的工具调用；复用既有权限审批，不产生 transcript row。 */
  sampleMcpApp(
    params: import("../plugin-ui-bridge/samplingContract.js").PluginUiSamplingParams,
  ): Promise<import("@raspberrycode/shared/mcp-apps").McpAppsSamplingResult>;
  cancelMcpAppSampling(
    params: import("../plugin-ui-bridge/samplingContract.js").PluginUiCancelSamplingParams,
  ): Promise<{ cancelled: boolean }>;
  callMcpToolForUi(params: RaspberryCodeAgentCallMcpToolForUiParams): Promise<RaspberryCodeMcpUiCallToolResult>;
  /** 插件 UI 取消带 callId 的进行中 UI 工具调用；agent 侧 abort 到 MCP client。 */
  cancelMcpToolCallForUi(
    params: RaspberryCodeAgentCancelMcpToolCallForUiParams,
  ): Promise<RaspberryCodeMcpUiCancelCallResult>;
  /** 插件 UI 页面发起的 `resources/read`，agent 侧限同插件服务器、8 MiB、mimeType 白名单。 */
  readMcpResourceForUi(
    params: RaspberryCodeAgentReadMcpResourceForUiParams,
  ): Promise<RaspberryCodeMcpUiReadResourceResult>;
  /** 插件 UI 页面发起的 resources/list、resources/templates/list、subscribe、unsubscribe 代理。 */
  listMcpResourcesForUi(
    params: RaspberryCodeAgentListMcpResourcesForUiParams,
  ): Promise<RaspberryCodeMcpUiListResourcesResult>;
  listMcpResourceTemplatesForUi(
    params: RaspberryCodeAgentListMcpResourcesForUiParams,
  ): Promise<RaspberryCodeMcpUiListResourceTemplatesResult>;
  subscribeMcpResourceForUi(params: RaspberryCodeAgentMcpResourceSubscriptionForUiParams): Promise<void>;
  unsubscribeMcpResourceForUi(params: RaspberryCodeAgentMcpResourceSubscriptionForUiParams): Promise<void>;
  /** App-Provided Tools：页面工具登记 / 注销与模型调用的认领 / 回传（信箱投递走 v4 live 增量）。 */
  registerAppToolsForUi(
    params: RaspberryCodeAgentRegisterAppToolsForUiParams,
  ): Promise<RaspberryCodeMcpUiRegisterAppToolsResult>;
  unregisterAppToolsForUi(
    params: RaspberryCodeAgentAppToolInstanceForUiParams,
  ): Promise<RaspberryCodeMcpUiUnregisterAppToolsResult>;
  claimAppToolCallForUi(
    params: RaspberryCodeAgentAppToolCallForUiParams,
  ): Promise<RaspberryCodeMcpUiAppToolAcceptedResult>;
  resolveAppToolCallForUi(
    params: RaspberryCodeAgentResolveAppToolCallForUiParams,
  ): Promise<RaspberryCodeMcpUiAppToolAcceptedResult>;
  /** 插件 UI 工作区级面板入口（已启用插件清单 `ui.surfaces[]`）。 */
  listPluginUiSurfaces(
    params: RaspberryCodeAgentWorkspaceTarget,
  ): Promise<RaspberryCodePluginsListUiSurfacesResult>;
  // 已保存工作流的 GUI 中枢：workspace 级、无会话，每次调用现扫 `<cwd>/.raspberrycode/workflows/`。
  // 全局档传 `scope: "global"`：带 workspace 就用它当载体，不带则由 services 层自选本机载体运行时。
  listSavedWorkflows(params: RaspberryCodeAgentListSavedWorkflowsParams): Promise<RaspberryCodeWorkflowsListResult>;
  getSavedWorkflow(params: RaspberryCodeAgentGetSavedWorkflowParams): Promise<RaspberryCodeWorkflowsGetResult>;
  updateSavedWorkflowMeta(
    params: RaspberryCodeAgentUpdateSavedWorkflowMetaParams,
  ): Promise<RaspberryCodeWorkflowsUpdateMetaResult>;
  deleteSavedWorkflow(
    params: RaspberryCodeAgentDeleteSavedWorkflowParams,
  ): Promise<RaspberryCodeWorkflowsDeleteResult>;
  listSavedWorkflowRuns(
    params: RaspberryCodeAgentListSavedWorkflowRunsParams,
  ): Promise<RaspberryCodeWorkflowsRunsResult>;
  // 在项目档 / 全局档之间移动同名文件：
  // `workspace` 是载体（移到项目传目标项目、移到全局传源项目），`to` 是落点档；不覆盖已存在的目标。
  moveSavedWorkflow(params: RaspberryCodeAgentMoveSavedWorkflowParams): Promise<RaspberryCodeWorkflowsMoveResult>;
  // 完成卡的「直接保存」（docs/dynamic-workflow/transcript-and-notifications.md）：按 runId 从
  // journal 取这次 run 实际跑过的脚本落盘，不经模型回合。两者都必带 workspace（journal 在那里）。
  saveSavedWorkflowFromRun(
    params: RaspberryCodeAgentSaveSavedWorkflowFromRunParams,
  ): Promise<RaspberryCodeWorkflowsSaveResult>;
  /** 这次 run 对应哪个已保存工作流（推导，不记忆）；顺带回 run 的实参供「再次运行」预填。 */
  findSavedWorkflowForRun(
    params: RaspberryCodeAgentFindSavedWorkflowForRunParams,
  ): Promise<RaspberryCodeWorkflowsForRunResult>;
  resolveSuggestedPluginReference(
    params: RaspberryCodeAgentResolveSuggestedPluginReferenceParams,
  ): Promise<import("@raspberrycode/shared").RaspberryCodePluginsResolveSuggestedReferenceResult>;
  /** 推荐项 Plugin 首次本地检查缺失后的 operation-scoped 刷新进度。 */
  onDynamicPluginOperationProgress(
    operationId: string,
  ): Event<RaspberryCodePluginOperationProgressNotification>;
  getPluginsOverview(params: RaspberryCodeAgentPluginViewParams): Promise<RaspberryCodePluginsOverviewResult>;
  /**
   * 资源管理器：枚举本 Host 内全部本地 Agent 进程（含 plugin / mcp-status 泳道），
   * 并向每个存活 runtime 请求 `process/childProcesses`；单个 runtime 失败只让它的 children 为空。
   */
  collectLocalRuntimeChildProcesses(
    signal?: AbortSignal,
  ): Promise<RaspberryCodeAgentLocalRuntimeChildProcesses[]>;
  addPluginMarketplace(
    params: RaspberryCodeAgentAddPluginMarketplaceParams,
  ): Promise<RaspberryCodePluginsMarketplaceMutationResult>;
  removePluginMarketplace(
    params: RaspberryCodeAgentRemovePluginMarketplaceParams,
  ): Promise<RaspberryCodePluginsMarketplaceMutationResult>;
  updatePluginMarketplace(
    params: RaspberryCodeAgentUpdatePluginMarketplaceParams,
  ): Promise<RaspberryCodePluginsMarketplaceMutationResult>;
  installPlugin(params: RaspberryCodeAgentInstallPluginParams): Promise<RaspberryCodePluginsInstallResult>;
  cancelPluginOperation(
    params: RaspberryCodeAgentCancelPluginOperationParams,
  ): Promise<RaspberryCodePluginsCancelOperationResult>;
  uninstallPlugin(params: RaspberryCodeAgentUninstallPluginParams): Promise<RaspberryCodePluginsUninstallResult>;
  updatePlugin(params: RaspberryCodeAgentUpdatePluginParams): Promise<RaspberryCodePluginsInstallResult>;
  restoreBuiltinPlugin(
    params: RaspberryCodeAgentRestoreBuiltinPluginParams,
  ): Promise<RaspberryCodePluginsRestoreBuiltinResult>;
  configurePlugin(params: RaspberryCodeAgentConfigurePluginParams): Promise<RaspberryCodePluginsConfigureResult>;
  resetPluginConfig(
    params: RaspberryCodeAgentResetPluginConfigParams,
  ): Promise<RaspberryCodePluginsConfigureResult>;
  validatePlugin(params: RaspberryCodeAgentValidatePluginParams): Promise<RaspberryCodePluginsValidateResult>;
  describePlugin(params: RaspberryCodeAgentDescribePluginParams): Promise<RaspberryCodePluginsDescribeResult>;
  setPluginEnabled(params: RaspberryCodeAgentSetPluginEnabledParams): Promise<RaspberryCodePluginsSetEnabledResult>;
  // ---- 定时任务(automation)管理 ----
  listAutomations(params: RaspberryCodeAgentWorkspaceTarget): Promise<RaspberryCodeAutomation[]>;
  listAllAutomations(): Promise<RaspberryCodeAutomation[]>;
  createAutomation(params: RaspberryCodeAgentCreateAutomationParams): Promise<RaspberryCodeAutomation>;
  updateAutomation(params: RaspberryCodeAgentUpdateAutomationParams): Promise<RaspberryCodeAutomation | null>;
  deleteAutomation(params: RaspberryCodeAgentAutomationIdParams): Promise<void>;
  setAutomationEnabled(params: RaspberryCodeAgentSetAutomationEnabledParams): Promise<void>;
  restartAutomation(params: RaspberryCodeAgentAutomationIdParams): Promise<void>;
  runAutomationNow(params: RaspberryCodeAgentAutomationIdParams): Promise<RaspberryCodeAgentRunAutomationNowResult>;
  listAutomationRuns(params: RaspberryCodeAgentAutomationIdParams): Promise<RaspberryCodeAutomationRun[]>;
  deleteAutomationRun(params: RaspberryCodeAgentDeleteAutomationRunParams): Promise<void>;
  generateWorkspaceText(
    params: RaspberryCodeAgentGenerateWorkspaceTextParams,
  ): Promise<RaspberryCodeWorkspaceGenerateTextResult>;
  testModelConnectivity(
    params: RaspberryCodeAgentTestModelConnectivityParams,
  ): Promise<RaspberryCodeProviderTestModelConnectivityResult>;
  /**
   * @deprecated：send 主路径已收敛 v4 sendText 命令。仅剩两个消费点——
   * adapter 带附件输入回退（待附件命令面落地后移除）与 raspberrycodeSessionService
   * pass-through；新代码禁止回用。
   */
  sendPrompt(params: RaspberryCodeAgentSendPromptParams): Promise<RaspberryCodeSessionSendResult>;
  compactSession(params: RaspberryCodeAgentCompactParams): Promise<RaspberryCodeSessionCompactResult>;
  goalSession(params: RaspberryCodeAgentGoalParams): Promise<RaspberryCodeSessionGoalResult>;
  closeSession(
    params: RaspberryCodeAgentSessionTarget & { expectedPersistence?: "deferred" | "immediate" },
  ): Promise<boolean>;
  setModel(params: RaspberryCodeAgentSetModelParams): Promise<RaspberryCodeSessionStateSnapshot>;
  setThoughtLevel(params: RaspberryCodeAgentSetThoughtLevelParams): Promise<RaspberryCodeSessionStateSnapshot>;
  setMode(params: RaspberryCodeAgentSetModeParams): Promise<RaspberryCodeSessionStateSnapshot>;
  respondProviderRuntimeHeaders(
    params: RaspberryCodeAgentRespondProviderRuntimeHeadersParams,
  ): Promise<void>;
  respondSessionRuntimePreferences(
    params: RaspberryCodeAgentRespondSessionRuntimePreferencesParams,
  ): Promise<void>;
  /**
   * v4 UI 的 Start Plan runtime-auth bridge 只需要本地 pending request 事件，
   * 不能为此额外打开旧 `session/subscribe`，否则会把旧 replay/continuous 读路径
   * 重新带回 v4 pane。
   */
  onDynamicProviderRuntimeHeadersRequest(
    params: RaspberryCodeAgentSessionTarget,
  ): Event<RaspberryCodeProviderRuntimeHeadersRequestParams>;
  /**
   * Start Plan runtime headers 的 workspace 级订阅入口（生产应答方使用）。
   * Bug 原因（2026-08-16 web 远控卡死）：session 级入口只随桌面 pane 挂载订阅，
   * web 远控新建会话在桌面没有 pane、web 端无应答方，请求校验请求滞留 pending，
   * 任务永久「工作中」。桌面窗口用本入口为每个打开的 workspace tab 维持常驻应答方；
   * 订阅时先注册 live listener 再按 workspaceKey 前缀补投 pending，与 session 级同语义。
   */
  onDynamicWorkspaceProviderRuntimeHeadersRequest(
    params: RaspberryCodeAgentWorkspaceTarget,
  ): Event<RaspberryCodeProviderRuntimeHeadersRequestParams>;
  /** 只投递本 workspace 的校验取消，不属于 conversation stream。 */
  onDynamicWorkspaceProviderRuntimeHeadersCancelled(
    params: RaspberryCodeAgentWorkspaceTarget,
  ): Event<RaspberryCodeProviderRuntimeHeadersCancelled>;
  onDynamicSessionRuntimePreferencesRequest(): Event<RaspberryCodeAgentSessionRuntimePreferencesRequest>;
  /**
   * CLI 进程级资源样本，带 services 打的 lane 标签（CLI 自己不知道 lane）。
   * 使用 dynamic event 避免 RPC 服务在无人订阅时缓冲周期事件；
   * 该事件不属于 session/conversation continuous 或 replayable 状态。
   */
  onDynamicProcessResourceSample(): Event<AgentLaneResourceSample>;
  /** MCP 进程生命周期与低频内存事件，仅供可信 Host relay 上报 ARMS。 */
  onDynamicMcpTelemetry(): Event<RaspberryCodeMcpTelemetryEvent>;
  /** MCP 进程树资源事实，只供可信 Host 汇总上报。 */
  onDynamicMcpResourceSamples(): Event<RaspberryCodeMcpResourceSample[]>;
  /** Bash 完成事实，仅可信 Host 资源旁路订阅。 */
  onDynamicToolExecResource(): Event<RaspberryCodeToolExecResource>;
  /**
   * @deprecated 旧协议订阅面（session/subscribe + session/event + state.updated）。
   * task-index syncer 已迁 v4 sessions-index/workspace-config 帧；
   * 仅剩 raspberrycodeTaskServiceAdapter.onDynamicTaskEvent（replayable 读路径）消费。
   * 写路径已收敛 v4 命令面；本订阅是读路径投影源。
   */
  onDynamicSessionEvent(params: RaspberryCodeAgentSessionSubscribeParams): Event<RaspberryCodeAgentServiceEvent>;
  // ── v4 conversation 通道（竖切）──
  /** RPC attachment 建立后先读取 host 可信 hello。 */
  helloConversationV4(): Promise<HelloMessage>;
  /** hello 校验后回送 clientHello；metadata 不能覆盖 connection mode/profile。 */
  initializeConversationV4(clientHello: ClientHello): Promise<void>;
  /** 仅供 trusted host relay/facade；terminal RPC caller 必须被 connection scope 拒绝。 */
  setConnectionFlowStateV4(params: RaspberryCodeAgentConnectionFlowParams): Promise<void>;
  subscribeConversationV4(
    params: RaspberryCodeAgentConversationSubscribeParams,
  ): Promise<V4ConversationSubscribeResult>;
  resyncConversationV4(
    params: RaspberryCodeAgentConversationResyncParams,
  ): Promise<V4ConversationResyncResult>;
  unsubscribeConversationV4(params: RaspberryCodeAgentConversationUnsubscribeParams): Promise<void>;
  /** rows/range 行分页 query（loadOlder 游标向上补历史）。 */
  conversationRowsRangeV4(
    params: RaspberryCodeAgentConversationRowsRangeParams,
  ): Promise<V4ConversationRowsRangeResult>;
  conversationPlansV4(
    params: RaspberryCodeAgentConversationPlansParams,
  ): Promise<V4ConversationPlansResult>;
  /** workflow run 事件日志分页；与 plans 同族（只读、无状态、超时重发安全）。 */
  conversationWorkflowRunEventsV4(
    params: RaspberryCodeAgentConversationWorkflowRunEventsParams,
  ): Promise<V4ConversationWorkflowRunEventsResult>;
  /** workflow run 枚举；journal-backed 的重启后发现面。 */
  conversationWorkflowRunsV4(
    params: RaspberryCodeAgentConversationWorkflowRunsParams,
  ): Promise<V4ConversationWorkflowRunsResult>;
  /** workflow run 的用户面产物清单；与 plans 同族（只读、无状态、超时重发安全）。 */
  conversationWorkflowRunArtifactsV4(
    params: RaspberryCodeAgentConversationWorkflowRunArtifactsParams,
  ): Promise<V4ConversationWorkflowRunArtifactsResult>;
  /** 预置看板的条目分页；hook 以 itemCount 变化为信号增量拉取。 */
  conversationWorkflowRunArtifactDataV4(
    params: RaspberryCodeAgentConversationWorkflowRunArtifactDataParams,
  ): Promise<V4ConversationWorkflowRunArtifactDataResult>;
  /** 内容产物的字节，一次一块；授权在 CLI 侧（journal 行才是取字节的依据）。 */
  conversationWorkflowRunArtifactReadV4(
    params: RaspberryCodeAgentConversationWorkflowRunArtifactReadParams,
  ): Promise<V4ConversationWorkflowRunArtifactReadResult>;
  /** dwf 工作区 transcript 的清单。 */
  conversationWorkflowRunWorkspaceV4(
    params: RaspberryCodeAgentConversationWorkflowRunWorkspaceParams,
  ): Promise<V4ConversationWorkflowRunWorkspaceResult>;
  /** 一个工作区节点的有界正文。 */
  conversationWorkflowRunNodeResultV4(
    params: RaspberryCodeAgentConversationWorkflowRunNodeResultParams,
  ): Promise<V4ConversationWorkflowRunNodeResultResult>;
  backgroundBashOutputV4(
    params: RaspberryCodeAgentBackgroundBashOutputParams,
  ): Promise<BackgroundBashOutputResult>;
  conversationFileChangesV4(
    params: RaspberryCodeAgentConversationFileChangesParams,
  ): Promise<V4ConversationFileChangesResult>;
  conversationFileRewindPreviewV4(
    params: RaspberryCodeAgentConversationFileRewindPreviewParams,
  ): Promise<V4ConversationFileRewindPreviewResult>;
  sendConversationCommandV4(params: RaspberryCodeAgentConversationCommandParams): Promise<CommandAck>;
  queryConversationCommandsV4(params: RaspberryCodeAgentCommandsQueryParams): Promise<CommandsQueryResult>;
  attachmentBeginV4(params: RaspberryCodeAgentAttachmentBeginParams): Promise<V4AttachmentBeginResult>;
  attachmentChunkV4(params: RaspberryCodeAgentAttachmentChunkParams): Promise<V4AttachmentChunkResult>;
  attachmentCommitV4(params: RaspberryCodeAgentAttachmentTerminalParams): Promise<V4AttachmentCommitResult>;
  attachmentAbortV4(params: RaspberryCodeAgentAttachmentTerminalParams): Promise<void>;
  /** Desktop local 已发送视频 source query；远端与 Web 返回 chunked。 */
  attachmentPreviewSourceV4(
    params: RaspberryCodeAgentAttachmentPreviewSourceParams,
  ): Promise<V4AttachmentPreviewSourceResult>;
  /** 已发送 image/video 只读分块查询；connection scope 注入可信 workspace 连接。 */
  attachmentReadV4(params: RaspberryCodeAgentAttachmentReadParams): Promise<V4AttachmentReadResult>;
  /** Share 读取 userInput 附件，允许 text/plain 等非媒体类型。 */
  conversationAttachmentReadV4(
    params: RaspberryCodeAgentConversationAttachmentReadParams,
  ): Promise<V4ConversationAttachmentReadResult>;
  /** Share 选择阶段只读 userInput 附件元数据，不读取完整内容。 */
  conversationAttachmentStatV4(
    params: RaspberryCodeAgentConversationAttachmentStatParams,
  ): Promise<V4ConversationAttachmentStatResult>;
  /** workspace 级下行帧流（v4/conversation/frame），renderer 侧按 topic 自行路由。 */
  onDynamicConversationFrame(
    params: RaspberryCodeAgentWorkspaceTarget,
  ): Event<ConversationTopicWireCandidate>;
  /** workspace 级 live telemetry 事实；connection facade 仅向可信 desktop-continuous 下游暴露。 */
  onDynamicLocalTtftFacts(
    params: RaspberryCodeAgentWorkspaceTarget,
  ): Event<import("@raspberrycode/shared").LocalTtftFacts>;
  onDynamicConversationTelemetryFact(
    params: RaspberryCodeAgentWorkspaceTarget,
  ): Event<ConversationTelemetryFact>;
  /** 当前窗口全部本地 live task 的 CUA 权限观察；历史、远程与 replayable 不在此事件面。 */
  onDynamicCuaPermissionObservation(): Event<RaspberryCodeAgentCuaPermissionObservation>;
  /** 本地桌面窗口创建插件页面，不依赖 conversation 订阅。 */
  onDynamicPluginUiToolResult(): Event<
    PluginUiToolResultNotification & { workspacePath: string; workspaceIdentity?: string }
  >;

  /** 只读 CLI 持久事实；不恢复会话运行实例。旧远端可以不提供此能力。 */
  reconcileSessionsIndexV4?(
    params: RaspberryCodeAgentWorkspaceTarget & { sessionIds: string[] },
  ): Promise<SessionsIndexReconcileResult>;
  // ── M5 sessions-index 通道（列表活性）──
  subscribeSessionsIndexV4(
    params: RaspberryCodeAgentSessionsIndexSubscribeParams,
  ): Promise<V4SessionsIndexSubscribeResult>;
  resyncSessionsIndexV4(
    params: RaspberryCodeAgentConversationResyncParams,
  ): Promise<V4ConversationResyncResult>;
  unsubscribeSessionsIndexV4(params: RaspberryCodeAgentConversationUnsubscribeParams): Promise<void>;
  /** workspace 级 sessions-index 下行帧流（与 conversation 同一通知，按 topic 前缀分流）。 */
  onDynamicSessionsIndexFrame(
    params: RaspberryCodeAgentWorkspaceTarget,
  ): Event<SessionsIndexTopicWireCandidate>;
  // ── workspace-config 通道（配置目录活性；task-index syncer 消费）──
  subscribeWorkspaceConfigV4(
    params: RaspberryCodeAgentWorkspaceConfigSubscribeParams,
  ): Promise<V4WorkspaceConfigSubscribeResult>;
  resyncWorkspaceConfigV4(
    params: RaspberryCodeAgentConversationResyncParams,
  ): Promise<V4ConversationResyncResult>;
  unsubscribeWorkspaceConfigV4(params: RaspberryCodeAgentConversationUnsubscribeParams): Promise<void>;
  /** workspace 级 workspace-config 下行帧流（与 conversation 同一通知，按 topic 前缀分流）。 */
  onDynamicWorkspaceConfigFrame(
    params: RaspberryCodeAgentWorkspaceTarget,
  ): Event<WorkspaceConfigTopicWireCandidate>;
  /**
   * （CLI 重连重订）：agent 进程换代通知（超时回收/崩溃后重新拉起）。
   * v4 订阅活在 CLI 进程内存，进程换代即失效；订阅方（task-index syncer 等）
   * 收到后必须对该 workspaceKey 重发 subscribe，否则帧流静默中断。
   */
  onAgentRuntimeRestarted(listener: (event: { workspaceKey: string }) => void): IDisposable;
  /**
   * Agent client 在 service 内完成登记后发布 available，当前 client 关闭后发布 unavailable。
   * 这是被动 observer attach/detach 的唯一生命周期信号，不表达用户使用租约。
   */
  onAgentRuntimeLifecycle?: (
    listener: (event: RaspberryCodeAgentRuntimeLifecycleEvent) => void,
  ) => IDisposable;
  /** 当前 desktop-local CUA turn 是否仍在执行，用于 Helper recovery 避免中途回收 Agent。 */
  hasActiveCuaOperationTurn(): boolean;
  disposeWorkspace(params: RaspberryCodeAgentWorkspaceTarget): Promise<void>;
  disposeAll(): void;
}

export const IRaspberryCodeAgentService = createServiceDescriptor<IRaspberryCodeAgentService>(
  ServiceChannels.RaspberryCodeAgent,
);
