/**
 * Computer Use 运行时入口。
 *
 * 这是 `createComputerUseRuntime` 的真实实现，替换原先的 fail-closed 占位。
 *
 * 职责边界（spec §4.2）：
 * - 本模块只做「请求编排 + 收据构造」，不碰系统调用
 * - 系统调用全部经 Helper 进程（`helper-client.ts`）
 * - 派发策略选择在本模块（P2 起只实现一级，后续补二级）
 *
 * 模型可见面与上游完全一致（spec §2 决策五）：14 个工具名不变，
 * 因此 skill 文档与 broker 链路无需改动。
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CuaHelperClient, HelperUnavailableError } from "./helper-client.ts";
import {
  DISPATCH_ERROR_CODES,
  buildErrorResult,
  classifyError,
  type DispatchErrorCode,
} from "./receipts.ts";
import { SDK_METHODS, type DispatchPolicy } from "./sdk-contract.ts";
import { handleIsolatedDesktop, handleSessions, handleWindowOffscreen } from "./session-diagnostics.ts";
import { acquireHelper, releaseHelper } from "./helper-registry.ts";
import { rememberStateWindow, windowKeyOfState, windowLanes } from "./window-lanes.ts";
import {
  TOOL_NAMES,
  handleActInternal,
  handleDrag,
  handleGetAppState,
  handleKey,
  handleLeftClick,
  handleListWindows,
  handlePaste,
  handlePerformAction,
  handleRequestAccess,
  handleScroll,
  handleSelectText,
  handleSetValue,
  handleStopComputerControl,
  handleType,
} from "./handlers.ts";

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
   * 本次任务的干扰预算（spec §3.2）。
   *
   * **由宿主从用户设置注入，不是模型参数。** 这个字段刻意不暴露在工具 schema 里：
   * 一旦模型能自己写，`quiet` 档就等于不存在——模型遇到障碍时会「顺手」提权，
   * 而用户根本不知道发生了什么。
   *
   * 未提供时按 `balanced`（默认档，不越过「不抢键鼠」的硬底线）。
   */
  interferenceBudget?: "quiet" | "balanced" | "unrestricted";
  /**
   * 用户是否已在设置里显式开启「允许物理注入（抢键鼠）」。
   *
   * 三级路径需要**同时**满足：预算为 `unrestricted` 且本字段为 true。
   * 两个条件缺一不可——预算表达「这次任务可以打扰我」，授权表达
   * 「我接受这个产品抢我的鼠标」。
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
  execute(input: ComputerUseRuntimeExecuteInput): Promise<CallToolResult>;
  closeSession(context: ComputerUseRuntimeContext): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * 创建运行时的选项。
 *
 * 这是**公共契约**，与 `index.d.ts` 保持一致（由 `contract-check.ts` 在编译期校验）。
 * 测试注入等内部用途的字段放在 `InternalRuntimeOptions` 里，不进这个接口——
 * 公共契约里出现「生产不传」的字段会误导消费方，也让契约检查失去意义。
 */
export interface ComputerUseRuntimeOptions {
  brokerSocketPath?: string;
  refreshMarkerPath?: string;
  ensureBrokerAvailable?: () => Promise<void>;
  env?: Record<string, string | undefined>;
}

/** 内部选项：公共契约 + 测试注入。 */
interface InternalRuntimeOptions extends ComputerUseRuntimeOptions {
  /** 测试注入。生产不传。 */
  helperFactory?: () => CuaHelperClient;
  /**
   * 经 creator 启动 host，而不是直接 spawn Helper。
   *
   * 默认关闭。开启后由 creator 作为父进程维持 host 存活，
   * host 崩溃可重启而会话不丢。代价是多一层进程与一次 stdout 转发。
   *
   * 之所以没放进公共契约：creator 目前只验证了**同会话**路径。
   * 跨会话的地址回报未实现，放进公共选项会让人以为那条路可用。
   */
  useCreator?: boolean;
  /** creator 入口脚本。`useCreator` 为真时必需。 */
  creatorPath?: string;
  /** 期望 host 落在的会话。省略表示当前会话。 */
  targetSessionId?: number;
}

/** 本构建支持的平台。其余平台明确拒绝，不静默降级。 */
const SUPPORTED_PLATFORM = "win32";

/**
 * 预算与授权可由部署环境给出的默认值。
 *
 * 为什么需要这层：`interferenceBudget` / `allowPhysicalInjection` 的**唯一**
 * 目的是让「用户允许这次任务多打扰我」这个决策不能被模型自己改。但宿主
 * （node_repl 的 cua-broker）在组装 request context 时并不带这两个字段，
 * 于是它们恒为默认值 `balanced` + 未授权 —— 结果是 `type` / `key` / `paste` /
 * `left_click_drag` 这四个方法对真实用户**永久不可用**，模型只会被告知
 * 「请在设置中开启」，而设置里根本没有这个开关。
 *
 * 用环境变量而不是把默认值放宽的原因：环境变量由启动进程的人（用户）或
 * 宿主（读用户设置后注入）控制，**模型无法通过工具参数修改**，
 * 安全边界不受影响。把默认值直接改成 `unrestricted` 才是真正的越界。
 *
 * 优先级：请求 context（宿主按会话注入）> 环境变量（用户/宿主配置）> 内置默认。
 */
const BUDGET_ENV = "RASPBERRYCODE_CUA_INTERFERENCE_BUDGET";
const ALLOW_PHYSICAL_ENV = "RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION";

/** 解析环境里的预算默认值。非法取值一律忽略并按内置默认处理。 */
function budgetFromEnv(env: Record<string, string | undefined>): DispatchPolicy["budget"] | undefined {
  const raw = env[BUDGET_ENV]?.trim().toLowerCase();
  if (raw === "quiet" || raw === "balanced" || raw === "unrestricted") return raw;
  return undefined;
}

/** 解析环境里的物理注入授权默认值。只认显式的肯定写法。 */
function allowPhysicalFromEnv(env: Record<string, string | undefined>): boolean | undefined {
  const raw = env[ALLOW_PHYSICAL_ENV]?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return undefined;
}

/** 会话上下文 → 预算 + 授权。 */
function resolveBudget(
  context: ComputerUseRuntimeContext,
  envDefaults: DispatchPolicy,
): DispatchPolicy {
  const raw = context.interferenceBudget;
  // 三个档位都必须被接受。此前这里只认 "quiet" | "unrestricted"，
  // 于是 context 显式传 "balanced" 会落到 `undefined` 并**回落到环境变量**——
  // 而环境变量可能是 unrestricted。结果是「调用方想收紧，实际却放宽了」，
  // 方向正好相反且没有任何提示。
  // 公开类型（index.d.ts）本来就声明了三档，实现必须与之一致。
  const fromContext =
    raw === "quiet" || raw === "balanced" || raw === "unrestricted" ? raw : undefined;
  const budget = fromContext ?? envDefaults.budget;
  // 三级需要预算与授权同时满足。注意：预算为 unrestricted 但未授权时，
  // 派发层仍然会把三级排除在候选之外——这里只负责把事实传下去。
  const allowPhysicalInjection =
    typeof context.allowPhysicalInjection === "boolean"
      ? context.allowPhysicalInjection
      : envDefaults.allowPhysicalInjection;
  return { budget, allowPhysicalInjection };
}

/**
 * 创建运行时。
 *
 * 注意：Helper 是懒启动的（spec §7.3）。创建 runtime 实例本身不拉起进程，
 * 因此对「只是加载模块」的场景零开销，冷启动成本只在实际首次调用时支付。
 */
export function createComputerUseRuntime(
  options: InternalRuntimeOptions = {},
): ComputerUseRuntime {
  let helper: CuaHelperClient | undefined;
  /** 是否已向注册表登记引用（决定 dispose 时要不要归还）。 */
  let helperAcquired = false;
  let disposed = false;
  /** 熔断标记（spec §7.2 硬规则三）：置位后本实例不再尝试。 */
  let tripped = false;

  const env = options.env ?? process.env;

  /**
   * 环境给出的预算默认值（解析一次即可）。
   *
   * 解析失败（拼错、空值）时不报错而是回落到内置默认：
   * 拼错一个环境变量名不该让整个电脑控制不可用，
   * 但也不能静默当成 `unrestricted` —— 那等于把安全边界交给一个 typo。
   */
  const envBudget: DispatchPolicy = {
    budget: budgetFromEnv(env) ?? "balanced",
    allowPhysicalInjection: allowPhysicalFromEnv(env) ?? false,
  };

  /**
   * 取（必要时创建）Helper 客户端。
   *
   * Helper 入口路径从环境变量解析：生产由 desktop 打包指向 resources/agent 下的
   * 构建产物；开发态指向仓库内的 dist。两者都不存在时明确报错，
   * 而不是让 spawn 抛一个含糊的 ENOENT。
   *
   * 走 `helper-registry` 而不是每次 new：同进程内多个 runtime 共享同一个 Helper。
   * 否则模型在 A 实例观察拿到 `s-1`、动作发到 B 实例就会报 `state_invalidated`，
   * 用户看到的是「刚观察完就说失效」。详见 helper-registry 的注释。
   */
  const ensureHelper = (): CuaHelperClient => {
    if (tripped) {
      throw new HelperUnavailableError("helper 已熔断，需要重建 runtime");
    }
    if (helper) return helper;

    // 测试注入的工厂不参与共享：它可能是刻意构造的假实现，
    // 跨测试共享会串状态。
    if (options.helperFactory) {
      helper = options.helperFactory();
      return helper;
    }

    const entryPath = resolveHelperEntry(env);
    if (!entryPath) {
      tripped = true;
      throw new HelperUnavailableError(
        "找不到 CUA Helper 入口（检查 RASPBERRYCODE_CUA_HELPER_ENTRY 或安装完整性）",
      );
    }

    const command = process.execPath;
    // 注册表的共享键要区分「直连」与「经 creator」：
    // 两者的父进程不同，混用会让后申请的实例拿到父进程不对的客户端。
    const sharedKeyPath = options.useCreator ? `${entryPath}#creator` : entryPath;
    helper = acquireHelper(sharedKeyPath, command, () =>
      new CuaHelperClient({
        entryPath,
        command,
        commandEnv: { ELECTRON_RUN_AS_NODE: "1" },
        cwd: undefined,
        idleTimeoutMs: 10 * 60 * 1000,
        ...(options.useCreator && options.creatorPath
          ? {
              creatorPath: options.creatorPath,
              targetSessionId: options.targetSessionId,
            }
          : {}),
      }),
    );
    helperAcquired = true;
    return helper;
  };

  const toErrorResult = (error: unknown, toolName: string): CallToolResult => {
    const classified = classifyError(error);
    if (classified.code === DISPATCH_ERROR_CODES.HELPER_UNAVAILABLE) {
      // 熔断：后续调用直接失败，不再尝试拉起
      tripped = true;
    }
    return buildErrorResult(classified.code, classified.message, {
      tool: toolName,
      actionSent: classified.actionSent,
      detail: classified.detail,
    });
  };

  const execute = async (input: ComputerUseRuntimeExecuteInput): Promise<CallToolResult> => {
    if (disposed) {
      return buildErrorResult(
        DISPATCH_ERROR_CODES.HELPER_UNAVAILABLE,
        "runtime 已释放",
        { tool: input.toolName, actionSent: false },
      );
    }

    if (process.platform !== SUPPORTED_PLATFORM) {
      return buildErrorResult(
        DISPATCH_ERROR_CODES.UNSUPPORTED_PLATFORM,
        `Computer Use 当前仅支持 Windows（运行平台: ${process.platform}）`,
        { tool: input.toolName, actionSent: false },
      );
    }

    try {
      const client = ensureHelper();
      // 动作前探活（spec §7.1 第一层）。失败即走一次性重启。
      await client.ensureReady();

      const params = (input.arguments ?? {}) as Record<string, unknown>;

      // 预算来自会话上下文（用户设定），**不从 params 读**。
      // 这条是安全边界而非设计偏好：模型能自定预算，quiet 档就形同虚设。
      // context 未给时用环境默认值（同样不是模型能改的）。
      const policy = resolveBudget(input.context, envBudget);

      /**
       * 写操作用窗口队列串行化，读操作直连。
       *
       * 分界依据是「是否改变目标窗口的状态」：
       * - 读（list_windows / get_app_state / capture）：不排队。
       *   排队会让「两个任务同时观察」变成串行，白等且没有正确性收益。
       * - 写（点击 / 输入 / 设置值 / 拖拽）：排队。
       *   同窗口的两个写操作若交错，快照的 stateId 可能在两次操作之间失效，
       *   表现为「刚观察完就说元素不存在」——那是用户能感知的错。
       *
       * 跨窗口不互相阻塞：队列按 windowKey 分桶（见 window-lanes.ts）。
       *
       * **拿不到 windowKey 时直接执行**：那意味着调用方没有给 state_id
       * （例如 list_windows），这种请求本身不针对具体窗口，
       * 用一个临时 key 排队反而会造出无意义的串行。
       */
      const runWrite = async <T>(
        windowKey: string | undefined,
        action: () => Promise<T>,
      ): Promise<T> => {
        if (!windowKey) return action();
        const outcome = await windowLanes.run(windowKey, input.context?.sessionId, action);
        return outcome.value;
      };

      /**
       * 从 params 里取目标窗口的键。
       *
       * 优先 `window_key`（调用方显式给出）。
       *
       * **已知局限**：动作只带 `state_id` 时这里拿不到 windowKey，
       * 会走直连路径（不排队）。要彻底解决需要在 Helper 侧
       * 按 state_id 返回所归属的 windowKey，那要改协议。
       * 当前的取舍是：宁可少排队，也不要为猜错窗口而错误串行——
       * 后者会让本该并行的两个任务互相等待，且很难解释。
       *
       * 缓解办法：调用方（SDK 适配层）在动作参数里带上 `window_key`。
       * `get_app_state` 的返回里已经有这个字段，拿它回填即可。
       */
      const explicitWindowKey = (): string | undefined => {
        const raw = params.window_key ?? params.windowKey;
        return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
      };

      /**
       * 按 stateId 反查窗口键。
       *
       * 观察时把 `stateId → windowKey` 登记到进程级映射里，
       * 动作时用 `state_id` 查回来。这样调用方不必额外传 `window_key`，
       * 排队也能正确分桶。
       *
       * 为什么用进程级映射而不是实例级：一个动作可能由 A 任务的 runtime
       * 发出，但快照是 B 任务的 runtime 观察的（共享同一 Helper）。
       * 实例级映射会漏掉这种情况。
       */
      const lookupWindowKey = (): string | undefined => {
        const explicit = explicitWindowKey();
        if (explicit) return explicit;
        const stateId = params.state_id ?? params.stateId;
        if (typeof stateId !== "string") return undefined;
        return windowKeyOfState(stateId);
      };

      // 方法名分发。
      //
      // 模型面是 SDK 的 14 个方法名（`left_click` / `type` / `key` …），
      // 不是 Helper 的内部名。适配层在 `sdk-contract.ts`，本函数只做路由。
      // 保留内部名（`act` / `click`）作为诊断入口，方便脚本直接驱动。
      switch (input.toolName) {
        case SDK_METHODS.LIST_APPS:
        case SDK_METHODS.LIST_WINDOWS:
          return await handleListWindows(client, input.toolName);

        case SDK_METHODS.GET_APP_STATE:
          {
            const result = await handleGetAppState(client, params);
            // 登记本次观察的窗口归属，供后续动作按 state_id 反查
            // （排队要按窗口分桶，见 window-lanes.ts）。
            const structured = result.structuredContent as
              | { state_id?: string; windowKey?: string }
              | undefined;
            if (structured?.state_id) {
              rememberStateWindow(structured.state_id, structured.windowKey);
            }
            return result;
          }

        // ---- 写操作：按窗口串行化 ----
        //
        // 这些都会改变目标窗口的状态，同窗口并发会让快照的 stateId
        // 在两次操作之间失效，表现为「刚观察完就说元素不存在」。
        // 跨窗口不互相阻塞（队列按 windowKey 分桶）。
        case SDK_METHODS.LEFT_CLICK:
          return await runWrite(lookupWindowKey(), () =>
            handleLeftClick(client, params, policy),
          );

        case SDK_METHODS.TYPE:
          return await runWrite(lookupWindowKey(), () =>
            handleType(client, params, policy),
          );

        case SDK_METHODS.KEY:
          return await runWrite(lookupWindowKey(), () =>
            handleKey(client, params, policy),
          );

        case SDK_METHODS.SCROLL:
          return await runWrite(lookupWindowKey(), () =>
            handleScroll(client, params, policy),
          );

        case SDK_METHODS.LEFT_CLICK_DRAG:
          return await runWrite(lookupWindowKey(), () =>
            handleDrag(client, params, policy),
          );

        case SDK_METHODS.SET_VALUE:
          return await runWrite(lookupWindowKey(), () =>
            handleSetValue(client, params, policy),
          );

        case SDK_METHODS.PASTE:
          return await runWrite(lookupWindowKey(), () =>
            handlePaste(client, params, policy),
          );

        case SDK_METHODS.PERFORM_ACTION:
          return await runWrite(lookupWindowKey(), () =>
            handlePerformAction(client, params, policy),
          );

        case SDK_METHODS.SELECT_TEXT:
          return await runWrite(lookupWindowKey(), () =>
            handleSelectText(client, params, policy),
          );

        case SDK_METHODS.REQUEST_ACCESS:
          return await handleRequestAccess(client, params);

        case SDK_METHODS.STOP_COMPUTER_CONTROL:
          return await handleStopComputerControl();

        // ---- 内部诊断入口（不属于模型面）----
        case TOOL_NAMES.GET_APP_STATE_INTERNAL:
          return await handleGetAppState(client, params);
        case TOOL_NAMES.ACT:
          return await handleActInternal(client, params, policy);
        case TOOL_NAMES.CLICK:
          return await handleLeftClick(client, params, policy);

        // ---- 会话诊断（不属于模型面，供脚本与「能不能操作别的会话」的判定）----
        case TOOL_NAMES.SESSIONS:
          return await handleSessions(client);

        case TOOL_NAMES.ISOLATED_DESKTOP:
          return await handleIsolatedDesktop(client);

        case TOOL_NAMES.WINDOW_OFFSCREEN:
          return await handleWindowOffscreen(client, params);

        default:
          return buildErrorResult(
            DISPATCH_ERROR_CODES.UNKNOWN_TOOL,
            `未实现的工具: ${input.toolName}`,
            { tool: input.toolName, actionSent: false },
          );
      }
    } catch (error) {
      return toErrorResult(error, input.toolName);
    }
  };

  return {
    execute,
    async closeSession(): Promise<void> {
      // 会话级状态在 Helper 内部按 windowKey 管理；关闭会话不需要清理 Helper。
      // 保留空实现是为了满足宿主接口，不在这里做多余动作。
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      const current = helper;
      helper = undefined;

      // 共享的 Helper 不能由单个 runtime 直接 stop——别的 runtime 可能还在用，
      // 停掉会让它们全部变成 state_invalidated。归还引用即可，
      // 由注册表在最后一个使用者释放后延迟回收。
      if (helperAcquired && !options.helperFactory) {
        const entryPath = resolveHelperEntry(env);
        if (entryPath) {
          // 键必须与 acquire 时完全一致，否则引用计数会泄漏：
          // 释放了别的键（或干脆没命中），条目永远不归零，Helper 常驻不退。
          const sharedKeyPath = options.useCreator ? `${entryPath}#creator` : entryPath;
          releaseHelper(sharedKeyPath, process.execPath);
        }
        return;
      }

      // 测试注入的客户端由本实例独占，直接停
      if (current) await current.stop();
    },
  };
}


/**
 * 解析 Helper 入口路径。
 *
 * 两处来源：
 * 1. 环境变量（打包态由 desktop 注入，指向 app.asar.unpacked 下的产物）
 * 2. 开发态：本包 dist 目录下
 *
 * 不做「找不到就静默用占位」的降级——那会让用户看到开关却功能不可用，
 * 比明确报错更糟。
 */
function resolveHelperEntry(env: Record<string, string | undefined>): string | undefined {
  const fromEnv = env.RASPBERRYCODE_CUA_HELPER_ENTRY?.trim();
  if (fromEnv) return fromEnv;

  try {
    // 本文件编译后位于 dist/runtime/，helper 在同级 dist/helper/
    const here = new URL(import.meta.url);
    const helperUrl = new URL("../helper/windows-helper.js", here);
    return helperUrl.pathname.replace(/^\/([A-Za-z]:)/, "$1");
  } catch {
    return undefined;
  }
}

export type { DispatchErrorCode };
