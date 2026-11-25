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
  /**
   * 用户是否允许窗口恢复（`restore_window` 的 restore 阶段）。
   *
   * 与 `allowPhysicalInjection` 分开：恢复窗口会激活窗口，但不抢键鼠。
   */
  allowWindowRestore?: boolean;
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
  /**
   * 宿主确认端口。高风险动作在模型声明 `requires_confirmation` 或 `risk`
   * 时调用；返回 false 表示用户拒绝。未注入时 runtime 返回
   * `confirmation_required` + 单次 `confirmation_id`。
   */
  requestConfirmation?: (request: {
    tool: string;
    action: string;
    summary: string;
  }) => Promise<boolean>;
}

export declare function createComputerUseRuntime(
  options?: ComputerUseRuntimeOptions,
): ComputerUseRuntime;
