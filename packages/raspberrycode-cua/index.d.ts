import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ComputerUseRuntimeContext {
  sessionId: string;
  runtimeScope: "main" | "subagent";
  workspaceKey: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  turnId?: string;
  clientMode?: "web-remote-replayable" | "desktop-continuous";
  deliveryKind?: "web-remote-replayable" | "desktop-continuous";
  trace?: Record<string, unknown>;
  /**
   * 本次任务的干扰预算。由宿主从用户设置注入，**不是模型参数**。
   *
   * 缺省为 `balanced`。模型无权修改——一旦可改，`quiet` 档就等于不存在。
   */
  interferenceBudget?: "quiet" | "balanced" | "unrestricted";
  /**
   * 用户是否已显式开启「允许物理注入（抢键鼠）」。
   *
   * 三级路径需要 `interferenceBudget === "unrestricted"` **且**本字段为 true。
   */
  allowPhysicalInjection?: boolean;
}

export interface ComputerUseRuntimeExecuteInput {
  toolName: string;
  arguments?: unknown;
  context: ComputerUseRuntimeContext;
  signal?: AbortSignal;
}

export interface ComputerUseRuntime {
  // 公共 broker 读取 MCP 元数据；占位返回同一结果类型，避免导出后丢失契约。
  execute(input: ComputerUseRuntimeExecuteInput): Promise<CallToolResult>;
  closeSession(context: ComputerUseRuntimeContext): Promise<void>;
  dispose(): Promise<void>;
}

export interface ComputerUseRuntimeOptions {
  brokerSocketPath?: string;
  refreshMarkerPath?: string;
  ensureBrokerAvailable?: () => Promise<void>;
  env?: Record<string, string | undefined>;
}

export declare function createComputerUseRuntime(
  options?: ComputerUseRuntimeOptions,
): ComputerUseRuntime;
