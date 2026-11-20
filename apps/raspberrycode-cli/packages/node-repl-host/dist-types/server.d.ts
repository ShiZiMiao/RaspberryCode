import { Server } from "@modelcontextprotocol/server";
import { type NodeReplRequestMeta, type NodeReplRunResult } from "@raspberrycode/core/repl";
import { type ComputerUseRuntime } from "@raspberrycode/raspberrycode-cua";
import { type NodeReplBrowserBrokerConnection } from "./browser-bridge.js";
import { type NodeReplBrowserBrokerUpstream } from "./call-ledger/contract.js";
import { type NodeReplCuaBrokerConnection } from "./cua-bridge.js";
import { installNodeReplProcessGuards, installNodeReplShutdownTriggers } from "./process-lifecycle.js";
export declare const NODE_REPL_MCP_PROCESS_TITLE = "raspberrycode-node-repl-mcp";
export interface NodeReplExecuteInput {
    code: string;
    requestMeta: NodeReplRequestMeta;
    signal: AbortSignal;
    syncTimeoutMs: number;
    cuaBroker?: NodeReplCuaBrokerConnection;
    browserBroker?: NodeReplBrowserBrokerConnection;
}
export type NodeReplExecutor = (input: NodeReplExecuteInput) => Promise<NodeReplRunResult>;
export interface NodeReplMcpRuntime {
    dispose(): void;
    server: Server;
}
export declare function setNodeReplMcpProcessTitle(target?: {
    title: string;
}): void;
/**
 * 测试与同进程嵌入入口使用同一条执行逻辑；生产 stdio 默认在一次性 Worker 中调用它，
 * 从而连 Node 的模块缓存也随调用一起销毁。
 */
export declare function createInProcessNodeReplExecutor(): NodeReplExecutor;
export declare function createNodeReplMcpRuntime(input?: {
    executeJs?: NodeReplExecutor;
    cuaRuntime?: ComputerUseRuntime;
    /** RaspberryCode 主进程浏览器 broker 的地址和 token；默认从环境变量读取（测试注入假 broker）。 */
    browserBrokerUpstream?: NodeReplBrowserBrokerUpstream;
    writeStderr?: (text: string) => void;
}): NodeReplMcpRuntime;
export { installNodeReplProcessGuards, installNodeReplShutdownTriggers };
export declare function main(): Promise<void>;
/**
 * 从环境变量捕获 Computer Use runtime。
 *
 * 两条路，按是否存在 broker socket 决定：
 *
 * 1. **有 `RASPBERRYCODE_CUA_PERMISSION_BROKER_SOCKET`** → 走 broker。
 *    这是上游架构（权限服务持有 Helper 凭据，runtime 通过 socket 转发）。
 *
 * 2. **没有 socket 但在 Windows 上** → 直连自研 Helper。
 *    自研实现（`packages/raspberrycode-cua`）不依赖 broker：它自己 spawn
 *    一个 `ELECTRON_RUN_AS_NODE` 子进程并通过命名管道通信，权限由会话上下文
 *    （预算 + 物理注入授权）表达，不需要独立的 broker 服务。
 *
 * 第 2 条是必要的：上游的 recipe 解析依赖 `ax_native.node` 与 helper 应用包，
 * 自研实现不用它们，因此那条链路永远解析失败、socket 永远不存在。
 * 如果这里坚持「没 socket 就不启用」，自研实现就永远接不上。
 *
 * 平台判断放在这里而不是交给 runtime：非 Windows 平台若返回一个
 * 必然失败的 runtime，模型会看到「工具存在但每个都报错」，
 * 不如直接不注册。
 */
export declare function captureComputerUseRuntimeFromEnvironment(env?: NodeJS.ProcessEnv): ComputerUseRuntime | undefined;
//# sourceMappingURL=server.d.ts.map