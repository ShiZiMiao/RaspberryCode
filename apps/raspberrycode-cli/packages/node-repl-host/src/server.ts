/* eslint-disable max-lines -- shared node_repl host 的 worker、CUA bridge 和生命周期必须保持同一边界。 */
import { resolve } from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { INVALID_PARAMS, Server, type Tool } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { JsInputJsonSchema } from "@raspberrycode/contracts/tools/node-repl";
// 值导入必须走 @raspberrycode/core/repl 这条深路径：barrel 会把 core 的整张图拖进 bundle
// （tool handlers → @raspberrycode/dynamic-workflow → typescript，实测 21.7MB 且求值即崩
// ERR_AMBIGUOUS_MODULE_SYNTAX）。宿主只需要 REPL 会话本身。
// 类型也一并从 /repl 取：总入口的顶层副作用会把 Agent、Bash 注册表和工作流编译器
// 打入每个 REPL Worker，Worker 会重复承担这份开销。
import {
  NodeReplSession,
  type NodeReplRequestMeta,
  type NodeReplRunResult,
} from "@raspberrycode/core/repl";
import {
  createComputerUseRuntime,
  type ComputerUseRuntime,
  type ComputerUseRuntimeOptions,
} from "@raspberrycode/raspberrycode-cua";
// 只加载 broker 协议常量；shared 总入口会初始化无关领域的 schema。
import {
  NODE_REPL_BROWSER_BROKER_SOCKET_ENV,
  NODE_REPL_BROWSER_BROKER_TOKEN_ENV,
} from "@raspberrycode/shared/node-repl-browser-broker";
import { z } from "zod";
import {
  createBrowserBridgeGlobals,
  type ActiveNodeReplCall,
  type NodeReplBrowserBrokerConnection,
} from "./browser-bridge.js";
import {
  createNodeReplBrowserBrokerProxy,
  createNodeReplCallLedger,
  type NodeReplBrowserBrokerUpstream,
} from "./call-ledger/contract.js";
import {
  createComputerUseBridgeGlobals,
  type ActiveCuaNodeReplCall,
  type NodeReplCuaBrokerConnection,
} from "./cua-bridge.js";
import { createNodeReplCuaBroker, type NodeReplCuaBroker } from "./cua-broker.js";
import { createNoProgressGuard } from "./no-progress-guard.js";
import {
  isDirectMcpEntrypoint,
  installNodeReplProcessGuards,
  installNodeReplShutdownTriggers,
} from "./process-lifecycle.js";
import { toMcpRunResult } from "./result.js";
import {
  JS_TOOL_DESCRIPTION,
  NODE_REPL_DEFAULT_TIMEOUT_MS,
  NODE_REPL_SERVER_INSTRUCTIONS,
  NODE_REPL_SERVER_VERSION,
} from "./tool-contract.js";

const MAX_SYNC_TIMEOUT_MS = 120_000;
const UNTRUSTED_SESSION_KEY = "__unscoped__";
const WORKER_KIND = "raspberrycode-node-repl-call";
export const NODE_REPL_MCP_PROCESS_TITLE = "raspberrycode-node-repl-mcp";
const pluginRoot = process.env.RASPBERRYCODE_PLUGIN_ROOT ?? process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
// CUA 与 Browser Use 共用 node_repl host，但文档和 native 依赖必须按领域隔离；
// 否则 CUA skill 会因为 host root 恰好来自 Browser Use 而再次产生隐式依赖。
const browserDocumentationRoot = resolve(pluginRoot, "docs");
const cuaDocumentationRoot = resolve(
  process.env.RASPBERRYCODE_CUA_PLUGIN_ROOT ?? pluginRoot,
  "docs",
);
const jsInputSchema = z
  .object({
    code: z.string(),
    timeout_ms: z.number().int().min(1).max(MAX_SYNC_TIMEOUT_MS).optional(),
    // tools/list 对新调用强制 title，但执行层必须继续接受旧 provider 和历史回放的 code-only 输入。
    title: z.string().min(1).max(120).optional(),
  })
  .strict();
const requestContextSchema = z
  .object({
    parent_span_id: z.string().optional(),
    runtime_scope: z.enum(["main", "subagent"]).default("main"),
    session_id: z.string().trim().min(1).optional(),
    span_id: z.string().optional(),
    trace_id: z.string().optional(),
    turn_id: z.string().optional(),
    workspace_identity: z.string().optional(),
    workspace_key: z.string().optional(),
    workspace_path: z.string().optional(),
    remote_session_id: z.string().optional(),
    client_mode: z.string().optional(),
    delivery_kind: z.string().optional(),
  })
  .passthrough();

const tools: Tool[] = [
  {
    name: "js",
    description: JS_TOOL_DESCRIPTION,
    // host MCP 曾手写出 title optional 的模型合同，和 built-in 合同分叉后 UI 只能显示固定完成文案。
    inputSchema: JsInputJsonSchema as Tool["inputSchema"],
  },
];

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

interface WorkerCallData {
  code: string;
  kind: typeof WORKER_KIND;
  requestMeta: NodeReplRequestMeta;
  syncTimeoutMs: number;
  cuaBroker?: NodeReplCuaBrokerConnection;
  browserBroker?: NodeReplBrowserBrokerConnection;
}

export function setNodeReplMcpProcessTitle(target: { title: string } = process): void {
  target.title = NODE_REPL_MCP_PROCESS_TITLE;
}

/**
 * 测试与同进程嵌入入口使用同一条执行逻辑；生产 stdio 默认在一次性 Worker 中调用它，
 * 从而连 Node 的模块缓存也随调用一起销毁。
 */
export function createInProcessNodeReplExecutor(): NodeReplExecutor {
  return async (input) => {
    let activeCall: ActiveNodeReplCall | undefined;
    let activeCuaCall: ActiveCuaNodeReplCall | undefined;
    let session: NodeReplSession;
    const generation = 1;
    session = new NodeReplSession({
      injectedGlobals: () =>
        ({
          ...createBrowserBridgeGlobals({
            broker: input.browserBroker,
            documentationRoot: browserDocumentationRoot,
            generation,
            getActiveCall: () => activeCall,
            session: () => session,
          }),
          ...createComputerUseBridgeGlobals({
            broker: input.cuaBroker,
            generation,
            getActiveCall: () => activeCuaCall,
            session: () => session,
            documentationRoot: cuaDocumentationRoot,
          }),
        }),
      restrictProcess: true,
    });
    activeCall = {
      generation,
      requestMeta: input.requestMeta,
      signal: input.signal,
    };
    activeCuaCall = {
      generation,
      requestMeta: input.requestMeta,
      signal: input.signal,
    };
    try {
      return await session.run(input.code, {
        requestMeta: input.requestMeta,
        signal: input.signal,
        syncTimeoutMs: input.syncTimeoutMs,
      });
    } finally {
      activeCall = undefined;
      activeCuaCall = undefined;
      session.dispose();
    }
  };
}

export function createNodeReplMcpRuntime(
  input: {
    executeJs?: NodeReplExecutor;
    cuaRuntime?: ComputerUseRuntime;
    /** RaspberryCode 主进程浏览器 broker 的地址和 token；默认从环境变量读取（测试注入假 broker）。 */
    browserBrokerUpstream?: NodeReplBrowserBrokerUpstream;
    writeStderr?: (text: string) => void;
  } = {},
): NodeReplMcpRuntime {
  const executeJs = input.executeJs ?? executeJsInWorker;
  const writeStderr = input.writeStderr ?? ((text: string) => void process.stderr.write(text));
  const noProgressGuard = createNoProgressGuard();
  // Server 必须先于 runtime 创建：CUA 高风险动作的确认要借 MCP elicitation 通道
  // 回到宿主（desktop 渲染层用 ElicitationDialog 展示）。
  const server = new Server(
    { name: "node_repl", version: NODE_REPL_SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: NODE_REPL_SERVER_INSTRUCTIONS },
  );
  const cuaRuntime =
    input.cuaRuntime ??
    captureComputerUseRuntimeFromEnvironment(process.env, {
      requestConfirmation: (request) => requestCuaConfirmationViaElicitation(server, request),
    });
  // 本次调用的可信事实只由主线程的两个 broker 记进账本（20-node-repl-call-ledger.md）。
  const ledger = createNodeReplCallLedger();
  const cuaBroker = cuaRuntime
    ? createNodeReplCuaBroker({ runtime: cuaRuntime, ledger, platform: process.platform })
    : undefined;
  const browserBrokerUpstream =
    input.browserBrokerUpstream ?? browserBrokerUpstreamFromEnvironment(process.env);
  const browserBrokerProxy = browserBrokerUpstream
    ? createNodeReplBrowserBrokerProxy({
        ledger,
        upstream: browserBrokerUpstream,
        platform: process.platform,
      })
    : undefined;
  const queues = new Map<string, Promise<void>>();
  const activeCalls = new Set<AbortController>();
  let disposed = false;

  const serialized = async <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const previous = queues.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const next = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    queues.set(key, next);
    await previous;
    try {
      return await run();
    } finally {
      release();
      if (queues.get(key) === next) queues.delete(key);
    }
  };

  server.setRequestHandler("tools/list", async () => ({ tools }));
  server.setRequestHandler("tools/call", async (request, extra) => {
    if (disposed) throw new Error("node_repl runtime is disposed");
    const name = request.params.name;
    const requestMeta = buildRequestMeta(extra.mcpReq._meta);
    const sessionKey = requestSessionKey(requestMeta);
    if (name === "js") {
      const args = parseToolInput(jsInputSchema, request.params.arguments, name);
      return await serialized(sessionKey, async () => {
        if (!args.code) {
          return {
            content: [{ type: "text" as const, text: "js expects non-empty JavaScript source" }],
            isError: true,
          };
        }
        const callController = new AbortController();
        activeCalls.add(callController);
        const timeoutMs = args.timeout_ms ?? NODE_REPL_DEFAULT_TIMEOUT_MS;
        const callMeta = { ...requestMeta, ...(args.title ? { title: args.title } : {}) };
        const call = ledger.open(callMeta);
        try {
          const signal = AbortSignal.any([
            extra.mcpReq.signal,
            callController.signal,
            AbortSignal.timeout(timeoutMs),
          ]);
          const run = await executeJs({
            code: args.code,
            requestMeta: callMeta,
            signal,
            syncTimeoutMs: Math.min(timeoutMs, MAX_SYNC_TIMEOUT_MS),
            ...(cuaBroker
              ? { cuaBroker: { socketPath: cuaBroker.connection.socketPath, token: call.token } }
              : {}),
            ...(browserBrokerProxy
              ? {
                  browserBroker: {
                    socketPath: browserBrokerProxy.connection.socketPath,
                    token: call.token,
                  },
                }
              : {}),
          });
          const result = toMcpRunResult(run, call.facts);
          const hint = noProgressGuard.observe({ requestMeta, code: args.code, result });
          if (hint) {
            result.content.push({ type: "text", text: hint.text });
            writeStderr(
              `[node_repl] no-progress hint kind=${hint.kind} count=${hint.count} ` +
                `session=${String(requestMeta.session_id)} turn=${String(requestMeta.turn_id)}\n`,
            );
          }
          return result;
        } finally {
          call.close();
          activeCalls.delete(callController);
        }
      });
    }
    invalidParams(`Tool ${name} not found`);
  });

  return {
    server,
    dispose: () => {
      disposed = true;
      for (const controller of activeCalls) controller.abort();
      activeCalls.clear();
      queues.clear();
      void cuaBroker?.close();
      void browserBrokerProxy?.close();
      void cuaRuntime?.dispose();
    },
  };
}

async function executeJsInWorker(input: NodeReplExecuteInput): Promise<NodeReplRunResult> {
  if (input.signal.aborted) throw input.signal.reason;
  const data: WorkerCallData = {
    code: input.code,
    kind: WORKER_KIND,
    requestMeta: input.requestMeta,
    syncTimeoutMs: input.syncTimeoutMs,
    cuaBroker: input.cuaBroker,
    browserBroker: input.browserBroker,
  };
  const worker = new Worker(new URL(import.meta.url), { workerData: data, env: workerEnvironment() });
  return await new Promise<NodeReplRunResult>((resolveRun, rejectRun) => {
    let settled = false;
    const cleanup = () => {
      input.signal.removeEventListener("abort", onAbort);
      worker.removeAllListeners();
    };
    const finish = (error?: unknown, result?: NodeReplRunResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate().catch(() => undefined);
      if (error !== undefined) rejectRun(error);
      else if (result) resolveRun(result);
      else rejectRun(new Error("node_repl worker returned no result"));
    };
    const onAbort = () => finish(input.signal.reason ?? new DOMException("aborted", "AbortError"));
    input.signal.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (message: unknown) => finish(undefined, message as NodeReplRunResult));
    worker.once("error", finish);
    worker.once("exit", (code) => {
      if (!settled)
        finish(new Error(`node_repl worker exited before returning a result (${code})`));
    });
    if (input.signal.aborted) onAbort();
  });
}

function browserBrokerUpstreamFromEnvironment(
  env: NodeJS.ProcessEnv,
): NodeReplBrowserBrokerUpstream | undefined {
  const socketPath = env[NODE_REPL_BROWSER_BROKER_SOCKET_ENV]?.trim();
  const token = env[NODE_REPL_BROWSER_BROKER_TOKEN_ENV]?.trim();
  return socketPath && token ? { socketPath, token } : undefined;
}

/**
 * Worker 的环境去掉上游浏览器 broker 的地址和 token：只有主线程代理需要它们，Worker 只拿本次调用的
 * token。这只是缩小暴露面，不是可信边界——cell 仍可能从进程的初始环境读到它们，那样绕过代理的调用
 * 只会少记、不会多记（20-node-repl-call-ledger.md「可信边界」）。
 */
function workerEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env[NODE_REPL_BROWSER_BROKER_SOCKET_ENV];
  delete env[NODE_REPL_BROWSER_BROKER_TOKEN_ENV];
  return env;
}

function parseToolInput<T>(schema: z.ZodType<T>, input: unknown, toolName: string): T {
  const parsed = schema.safeParse(input ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  invalidParams(`${toolName}: ${issue?.message ?? "invalid arguments"}`);
}

function invalidParams(message: string): never {
  throw Object.assign(new Error(message), { code: INVALID_PARAMS });
}

function buildRequestMeta(meta: Record<string, unknown> | undefined): NodeReplRequestMeta {
  const parsed = requestContextSchema.safeParse(meta?.["com.raspberrycode/request-context"]);
  // 安全边界：顶层 MCP _meta 是第三方可扩展字段，不能成为 RaspberryCode session 路由凭据。
  // 只有 host client 写入的命名空间会进入 Browser bridge；旧 client 的普通 JS 仍可执行。
  return parsed.success ? parsed.data : {};
}

function requestSessionKey(meta: NodeReplRequestMeta): string {
  const sessionId = meta.session_id;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId : UNTRUSTED_SESSION_KEY;
}

export { installNodeReplProcessGuards, installNodeReplShutdownTriggers };

export async function main(): Promise<void> {
  setNodeReplMcpProcessTitle();
  const runtimes = new Set<NodeReplMcpRuntime>();
  // 官方 plugin host 在 main() 返回后会清除短暂恢复的 Helper 凭据，而
  // serveStdio 的 server factory 要到 MCP initialize 时才执行。过去在 factory 内读取
  // process.env，必然得到空值，导致 node_repl 永久把 Computer Use 判为 unavailable。
  // 这里在 main() 生命周期内先捕获 runtime；Worker 只收到二次 bridge token，
  // 不会接触 Helper 的原始 socket/token。
  //
  // 确认通道必须延迟绑定：runtime 先于 server 创建（凭据捕获窗口），
  // 而 elicitation 请求要等 server 连上 transport 后才能发。
  let confirmationServer: CuaConfirmationElicitationRequester | undefined;
  const computerUseRuntime = captureComputerUseRuntimeFromEnvironment(process.env, {
    requestConfirmation: async (request) => {
      if (!confirmationServer) {
        throw new Error("node_repl server is not ready for confirmation");
      }
      return await requestCuaConfirmationViaElicitation(confirmationServer, request);
    },
  });
  const handle = serveStdio(
    () => {
      const runtime = createNodeReplMcpRuntime({ cuaRuntime: computerUseRuntime });
      confirmationServer = runtime.server;
      runtimes.add(runtime);
      return runtime.server;
    },
    { legacy: "reject" },
  );
  let shutdownStarted = false;
  const shutdown = () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    for (const runtime of runtimes) runtime.dispose();
    void handle
      .close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  installNodeReplProcessGuards({
    onOutputClosed: shutdown,
    process,
    writeStderr: (text) => process.stderr.write(text),
  });
  installNodeReplShutdownTriggers({ process, shutdown, stdin: process.stdin });
}

if (!isMainThread && isWorkerCallData(workerData)) {
  const execute = createInProcessNodeReplExecutor();
  const controller = new AbortController();
  void execute({
    code: workerData.code,
    requestMeta: workerData.requestMeta,
    signal: controller.signal,
    syncTimeoutMs: workerData.syncTimeoutMs,
    cuaBroker: workerData.cuaBroker,
    browserBroker: workerData.browserBroker,
  })
    .then((result) => parentPort?.postMessage(result))
    .catch((error) => {
      parentPort?.postMessage({
        logs: "",
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      } satisfies NodeReplRunResult);
    });
}

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
export function captureComputerUseRuntimeFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: Pick<ComputerUseRuntimeOptions, "requestConfirmation"> = {},
): ComputerUseRuntime | undefined {
  const socketPath = env.RASPBERRYCODE_CUA_PERMISSION_BROKER_SOCKET?.trim();
  if (socketPath) {
    return createComputerUseRuntime({
      brokerSocketPath: socketPath,
      refreshMarkerPath: env.RASPBERRYCODE_CUA_PERMISSION_BROKER_REFRESH_MARKER?.trim(),
      ...options,
    });
  }

  // 自研路径：只要平台受支持就启用，Helper 是懒启动的。
  if ((env.RASPBERRYCODE_CUA_SELF_HOSTED ?? "").trim() === "0") return undefined;
  if (process.platform !== "win32") return undefined;
  // 插件门禁（2026-11-25 真机修复）：computer-use 插件关闭时 node_repl 仍会因 Browser Use
  // 启用而存在，但 CUA 工具不得注册。产品口径是「设置页总开关 = 插件启用态」；
  // 该变量只在插件启用时由 resolveBuiltInNodeReplMcpServers 注入，同时是 Skill bootstrap
  // 解析 scripts/computer-use-client.mjs 的权威根目录。
  if (!(env.RASPBERRYCODE_CUA_PLUGIN_ROOT ?? "").trim()) return undefined;
  return createComputerUseRuntime({
    env: env as Record<string, string | undefined>,
    ...options,
  });
}

/**
 * 把 CUA 高风险动作的确认请求转成 MCP elicitation。
 *
 * 复用现有 `elicitation/create` 通道：agent CLI 的 MCP 适配器把它交给宿主提问端口，
 * desktop 渲染层用 ElicitationDialog 展示 Yes/No。客户端未声明 elicitation 能力时
 * 请求会失败，runtime 捕获后退回 `confirmation_required` 两步协议。
 */
export interface CuaConfirmationElicitationRequester {
  request(request: {
    method: "elicitation/create";
    params?: Record<string, unknown>;
  }): Promise<{ action: string; content?: Record<string, unknown> }>;
}

export async function requestCuaConfirmationViaElicitation(
  server: CuaConfirmationElicitationRequester,
  request: { tool: string; action: string; summary: string },
): Promise<boolean> {
  const result = await server.request({
    method: "elicitation/create",
    params: {
      mode: "form",
      message: `电脑控制需要确认：${request.summary}`,
      requestedSchema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            title: "确认执行",
            description: `${request.tool}（${request.action}）可能产生不可撤销的副作用。`,
          },
        },
        required: ["confirm"],
      },
    },
  });
  return result.action === "accept" && result.content?.confirm === true;
}

function isWorkerCallData(value: unknown): value is WorkerCallData {
  if (!value || typeof value !== "object") return false;
  return (value as { kind?: unknown }).kind === WORKER_KIND;
}

if (isMainThread && (await isDirectMcpEntrypoint(import.meta.url, process.argv[1]))) {
  void main().catch((error) => {
    process.stderr.write(
      `node_repl MCP server failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
