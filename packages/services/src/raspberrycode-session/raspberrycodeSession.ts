import { ServiceChannels } from "@raspberrycode/shared";
import type {
  TraceId,
  RaspberryCodeAgentMcpServer,
  RaspberryCodeDeliveryKind,
  RaspberryCodeMessageWithParts,
  ModelSelection,
  RaspberryCodePermissionRequestParams,
  RaspberryCodeProviderRuntimeHeadersRequestParams,
  RaspberryCodeUserInputRequestParams,
  RaspberryCodeUserInputResponse,
  RaspberryCodeSessionInfo,
  RaspberryCodeSessionImportHistory,
  RaspberryCodeSessionEvent,
  RaspberryCodeSessionMode,
  RaspberryCodeSessionPersistence,
  RaspberryCodeSessionStateSnapshot,
  RaspberryCodeStateUpdatedNotification,
  RaspberryCodeWorkspacePresentation,
} from "@raspberrycode/shared";
import { createServiceDescriptor } from "#src/descriptors.js";
import type { ProviderRuntimeHeadersUiResponse } from "#src/raspberrycode-agent/raspberrycodeAgent.js";

export interface RaspberryCodeSessionWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export type RaspberryCodeSessionReadWorkspacePresentationParams = RaspberryCodeSessionWorkspaceTarget;

export interface RaspberryCodeTaskTarget extends RaspberryCodeSessionWorkspaceTarget {
  sessionId: string;
}

export interface RaspberryCodeSessionCreateParams extends RaspberryCodeSessionWorkspaceTarget {
  /** 仅导入事务使用的预分配 ID；普通新会话继续由 Agent 分配。 */
  sessionId?: string;
  sessionTraceId?: TraceId;
  parentSessionId?: string;
  mode?: RaspberryCodeSessionMode;
  model?: ModelSelection;
  persistence?: RaspberryCodeSessionPersistence;
  thoughtLevel?: string;
  mcpServers?: RaspberryCodeAgentMcpServer[];
  importedHistory?: RaspberryCodeSessionImportHistory;
}

export interface RaspberryCodeSessionResumeParams extends RaspberryCodeTaskTarget {
  model?: ModelSelection;
  thoughtLevel?: string;
  mcpServers?: RaspberryCodeAgentMcpServer[];
  /**
   * 默认广播 resume 得到的历史快照，并让 shadow 订阅请求初始 snapshot。
   * 续聊发送前的 runtime 预恢复会关闭它，避免旧终态快照覆盖本地已开始的新输入运行态。
   */
  broadcastSnapshot?: boolean;
}

export interface RaspberryCodeSessionListParams extends RaspberryCodeSessionWorkspaceTarget {
  limit?: number;
}

export interface RaspberryCodeSessionReadParams extends RaspberryCodeTaskTarget {
  deliveryKind?: RaspberryCodeDeliveryKind;
  messageLimit?: number;
  afterSeq?: number;
}

export interface RaspberryCodeSessionMessagesParams extends RaspberryCodeTaskTarget {
  afterMessageId?: string;
  limit?: number;
}

export interface RaspberryCodeSessionEventsParams extends RaspberryCodeTaskTarget {
  afterSeq?: number;
  limit?: number;
}

export interface RaspberryCodeSessionSetModelParams extends RaspberryCodeTaskTarget {
  model: ModelSelection;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface RaspberryCodeSessionSetThoughtLevelParams extends RaspberryCodeTaskTarget {
  thoughtLevel?: string;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface RaspberryCodeSessionSetModeParams extends RaspberryCodeTaskTarget {
  mode: RaspberryCodeSessionMode;
  expectedRevision?: number;
}

export interface RaspberryCodeSessionRespondProviderRuntimeHeadersParams extends RaspberryCodeTaskTarget {
  requestId: string;
  response: ProviderRuntimeHeadersUiResponse;
}

export interface RaspberryCodeSessionSubscribeParams extends RaspberryCodeTaskTarget {
  deliveryKind: RaspberryCodeDeliveryKind;
  afterSeq?: number;
  includeSnapshot?: boolean;
  eventCoalescing?: {
    mode: "background-summary";
    intervalMs?: number;
  };
}

export type RaspberryCodeSessionServiceEvent =
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

export interface RaspberryCodeSessionInitializeResult {
  available: boolean;
  workspaceKey: string;
  protocolName?: string;
  protocolVersion?: number;
  transportKind?: "stdio" | "websocket";
  reason?: string;
  reasonCode?: "provider_not_ready";
}

export interface RaspberryCodeSessionWorkspaceRuntimeIdentity {
  generation: number;
  identity: string;
  processId?: number;
  workspaceKey: string;
}

export interface IRaspberryCodeSessionService {
  initializeWorkspace(params: RaspberryCodeSessionWorkspaceTarget): Promise<RaspberryCodeSessionInitializeResult>;
  getWorkspaceRuntimeIdentity(
    params: RaspberryCodeSessionWorkspaceTarget,
  ): Promise<RaspberryCodeSessionWorkspaceRuntimeIdentity>;
  readWorkspacePresentation(
    params: RaspberryCodeSessionReadWorkspacePresentationParams,
  ): Promise<RaspberryCodeWorkspacePresentation>;
  createSession(params: RaspberryCodeSessionCreateParams): Promise<RaspberryCodeSessionStateSnapshot>;
  resumeSession(params: RaspberryCodeSessionResumeParams): Promise<RaspberryCodeSessionStateSnapshot>;
  listSessions(params: RaspberryCodeSessionListParams): Promise<RaspberryCodeSessionInfo[]>;
  readSession(params: RaspberryCodeSessionReadParams): Promise<RaspberryCodeSessionStateSnapshot>;
  readSessionMessages(params: RaspberryCodeSessionMessagesParams): Promise<RaspberryCodeMessageWithParts[]>;
  readSessionEvents(params: RaspberryCodeSessionEventsParams): Promise<RaspberryCodeSessionEvent[]>;
  promoteDeferredDraftSession(params: RaspberryCodeTaskTarget): Promise<void>;
  closeSession(params: RaspberryCodeTaskTarget): Promise<void>;
  closeDeferredDraftSession(params: RaspberryCodeTaskTarget): Promise<boolean>;
  setModel(params: RaspberryCodeSessionSetModelParams): Promise<RaspberryCodeSessionStateSnapshot>;
  setThoughtLevel(params: RaspberryCodeSessionSetThoughtLevelParams): Promise<RaspberryCodeSessionStateSnapshot>;
  setMode(params: RaspberryCodeSessionSetModeParams): Promise<RaspberryCodeSessionStateSnapshot>;
  respondProviderRuntimeHeaders(
    params: RaspberryCodeSessionRespondProviderRuntimeHeadersParams,
  ): Promise<void>;
  // M5 删波次 2：onDynamicSessionEvent（旧 session/subscribe 词表的 renderer 订阅面）
  // 已删除——v4 UI 走 agentService 的 conversation/sessions-index 帧通道，
  // 该方法在 renderer 侧已无任何调用者（grep packages/ui packages/desktop 为零）。
}

export const IRaspberryCodeSessionService = createServiceDescriptor<IRaspberryCodeSessionService>(
  ServiceChannels.RaspberryCodeSession,
);
