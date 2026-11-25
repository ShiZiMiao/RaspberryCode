#!/usr/bin/env node
/**
 * Windows CUA Helper 进程入口。
 *
 * 职责边界（spec §4.2）：
 * - 持有系统授权身份，执行 UIA / Win32 调用
 * - 不做任何策略判断（派发选择、预算校验都在 runtime 侧）
 *
 * 生命周期（spec §7）：
 * - 由宿主 fork，通过命名管道通信
 * - 父进程消失即自行退出，避免成为孤儿
 * - 空闲超时自动退出，下次使用时懒启动（冷启动实测 65ms，无需预热）
 *
 * 启动参数：
 *   --socket <path>       命名管道路径（必填）
 *   --parent-pid <pid>    宿主的 pid，用于孤儿检测（必填）
 *   --idle-timeout <ms>   空闲超时，默认 600000（10 分钟）
 */

import { createServer, type Server, type Socket } from "node:net";
import {
  HELPER_ERROR_CODES,
  HELPER_METHODS,
  HELPER_PROTOCOL_VERSION,
  errorResponse,
  okResponse,
  parseRequestLine,
  serializeResponse,
  takeLines,
  type HelperRequest,
  type HelperResponse,
} from "./protocol.ts";
import { createAutomation, currentSessionId } from "./win32.ts";
import { DEFAULT_BUDGET, captureSnapshot, listWindows, readNativeWindowHandle } from "./tree.ts";
import { diffSnapshots, renderDiff, renderSnapshot } from "./render.ts";
import { SnapshotStore } from "./snapshot-store.ts";
import { buildActionHandlers } from "./action-handlers.ts";
import { collectElements, intParam, stringParam } from "./handler-support.ts";
import { normalizeHwnd } from "./dispatch.ts";
import { captureWindow } from "./screenshot.ts";
import { probeSessionTopology } from "./session.ts";
import { probeIsolatedDesktop } from "./isolated-desktop.ts";
import { reportAddressToBootstrap } from "./address-broker.ts";
import {
  hideWindowOffscreen,
  prepareWindowRestore,
  restoreWindow,
  restoreWindowPosition,
} from "./window-visibility.ts";
import { launchApplication } from "./launch.ts";

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** 父进程存活检查间隔。太密会成为噪声，太疏会让孤儿多活一会儿。 */
const PARENT_CHECK_INTERVAL_MS = 5_000;

interface HelperOptions {
  socketPath: string;
  parentPid: number;
  idleTimeoutMs: number;
  /**
   * 期望 host 落在的会话（仅诊断用）。
   *
   * host 自己无法选择落在哪个会话——那是启动方决定的。
   * 这个字段只用来回报「我以为该在哪」，让主进程能比对
   * 「实际在哪」与「该在哪」是否一致。
   */
  targetSessionId: number | undefined;
  /**
   * 引导管道名（跨会话启动时由主进程创建并传入）。
   *
   * 有值时，host 起来后要主动连上它报出自己的地址——
   * 因为跨会话的进程没有连到主进程的 stdout，那条回传通道不存在。
   */
  bootstrap: string | undefined;
}

function parseArgs(argv: string[]): HelperOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(key, next);
      i += 1;
    } else {
      values.set(key, "true");
    }
  }

  // 管道名可选：省略时自己生成。
  //
  // 为什么允许生成：跨会话启动时主进程无法预先建管道（句柄不能跨会话继承），
  // 只能由 host 自建并把名字回报出去。同会话启动时主进程会显式指定，
  // 因为它要在 spawn 之前就持有路径、好在 child 的 stdout 里对账。
  const socketPath = values.get("socket") ?? defaultHelperSocket();

  const parentRaw = values.get("parent-pid");
  const parentPid = parentRaw ? Number.parseInt(parentRaw, 10) : Number.NaN;
  if (!Number.isInteger(parentPid) || parentPid <= 0) {
    throw new Error("missing or invalid required argument: --parent-pid <pid>");
  }

  const idleRaw = values.get("idle-timeout");
  const idleTimeoutMs = idleRaw ? Number.parseInt(idleRaw, 10) : DEFAULT_IDLE_TIMEOUT_MS;
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
    throw new Error("invalid --idle-timeout <ms>");
  }

  const targetRaw = values.get("target-session");
  const parsedTarget = targetRaw ? Number.parseInt(targetRaw, 10) : Number.NaN;
  const targetSessionId = Number.isInteger(parsedTarget) ? parsedTarget : undefined;

  return {
    socketPath,
    parentPid,
    idleTimeoutMs,
    targetSessionId,
    bootstrap: values.get("bootstrap"),
  };
}

/** 生成一个唯一管道名。与 `helper-client` 的命名规则保持一致。 */
function defaultHelperSocket(): string {
  const id = `${process.pid}-${Date.now().toString(36)}`;
  return process.platform === "win32"
    ? `\\\\.\\pipe\\raspberrycode-cua-${id}`
    : `/tmp/raspberrycode-cua-${id}.sock`;
}

// ---------------------------------------------------------------------------
// UIA 运行时：懒初始化单例
//
// 不在这里立刻初始化，理由：
// 1. 冷启动要快（实测 65ms 里 14ms 是 UIA 初始化），让 pipe 先就绪
// 2. 若宿主只做探活而不用 UIA，不必付这笔成本
// ---------------------------------------------------------------------------

interface UiaRuntime {
  automation: unknown;
  dispose: () => void;
}

let uiaRuntime: UiaRuntime | undefined;
let uiaInitError: string | undefined;

/** 确保 UIA 已初始化。失败时记住错误，避免每次请求都重试同一失败路径。 */
function ensureUia(): UiaRuntime {
  if (uiaRuntime) return uiaRuntime;
  if (uiaInitError) throw new Error(uiaInitError);
  try {
    uiaRuntime = createAutomation();
    return uiaRuntime;
  } catch (error) {
    uiaInitError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

/** 快照存储。生命周期与进程一致；重启即清空（spec §7.2 硬规则二）。 */
const snapshots = new SnapshotStore();

// ---------------------------------------------------------------------------
// 方法处理
// ---------------------------------------------------------------------------

type MethodHandler = (params: unknown) => Promise<unknown> | unknown;

function buildHandlers(): Record<string, MethodHandler> {
  return {
    [HELPER_METHODS.PING]: () => ({
      pong: true,
      pid: process.pid,
      sessionId: currentSessionId(),
      uptimeMs: Math.round(process.uptime() * 1000),
    }),

    [HELPER_METHODS.HANDSHAKE]: (params) => {
      const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
      const version = record.protocolVersion;
      if (version !== undefined && version !== HELPER_PROTOCOL_VERSION) {
        throw Object.assign(
          new Error(`protocol version mismatch: expected ${HELPER_PROTOCOL_VERSION}, got ${String(version)}`),
          { code: HELPER_ERROR_CODES.VERSION_MISMATCH },
        );
      }
      return {
        protocolVersion: HELPER_PROTOCOL_VERSION,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.versions.node,
        electronVersion: process.versions.electron ?? null,
        sessionId: currentSessionId(),
        methods: Object.values(HELPER_METHODS),
      };
    },

    [HELPER_METHODS.UIA_PROBE]: () => {
      // 探活要如实报告失败原因，而不是抛一个笼统的异常——
      // 上层需要区分「COM 初始化失败」与「UIA 创建失败」。
      const startedAt = Date.now();
      try {
        const runtime = ensureUia();
        return {
          ok: true,
          elapsedMs: Date.now() - startedAt,
          sessionId: currentSessionId(),
          // 保留句柄存在性作为证据，不把指针本身暴露出去
          hasAutomation: runtime.automation !== undefined,
        };
      } catch (error) {
        return {
          ok: false,
          elapsedMs: Date.now() - startedAt,
          reason: uiaInitError ?? (error instanceof Error ? error.message : String(error)),
        };
      }
    },

    /**
     * 枚举顶层窗口。
     *
     * 返回扁平摘要而不含 element 句柄——句柄不能跨进程传输，
     * 后续 capture 时按 runtimeId 重新解析。
     */
    [HELPER_METHODS.LIST_WINDOWS]: (params) => {
      const runtime = ensureUia();
      const startedAt = Date.now();
      const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
      const includeWindowIds = record.includeWindowIds === true;
      const rawLimit = record.windowLimit;
      const windowLimit =
        typeof rawLimit === "number" && Number.isInteger(rawLimit) && rawLimit > 0
          ? Math.min(rawLimit, 200)
          : undefined;
      // scope 目前只区分 running/all：Windows 上没有可靠的「未运行应用」枚举，
      // not_running 明确不支持，避免返回一份看起来完整但实际缺失的列表。
      const scope = record.scope === "running" || record.scope === "all" ? record.scope : "all";
      const all = listWindows(runtime);
      const windows = (windowLimit ? all.slice(0, windowLimit) : all).map((window) => ({
        runtimeId: window.runtimeId,
        ...(includeWindowIds ? { window_id: window.runtimeId } : {}),
        title: window.title,
        className: window.className,
        processId: window.processId,
        frameworkId: window.frameworkId,
        bounds: window.bounds,
      }));
      return {
        windows,
        scope,
        total: all.length,
        truncated: windowLimit !== undefined && all.length > windowLimit,
        elapsedMs: Date.now() - startedAt,
      };
    },

    /**
     * 显式启动应用。
     *
     * 参数：`app`（可执行文件名、绝对路径或 AUMID）。
     *
     * 返回 `pid` 只在能解析到子进程时给出；UWP/AUMID 走 ShellExecute，
     * 拿不到 pid，返回 `dispatched: true` + `pid: null`，让调用方用
     * `list_windows` 再确认。这与 macOS `open_application` 的三级信任
     * 语义一致：dispatch-only 不等于进程已就绪。
     */
    [HELPER_METHODS.LAUNCH_APP]: (params) => {
      const app = stringParam(params, "app");
      if (!app) {
        throw Object.assign(new Error("launch_app 需要 app（可执行文件名、路径或 AUMID）"), {
          code: "bad_request",
        });
      }
      const startedAt = Date.now();
      const result = launchApplication(app);
      return {
        ...result,
        elapsedMs: Date.now() - startedAt,
      };
    },

    /**
     * 采集指定窗口的无障碍树。
     *
     * 参数：
     *   runtimeId?: string  目标窗口的 runtimeId（首选）
     *   processId?: number  按 pid 选第一个有标题的窗口
     *   disableDiffing?: boolean  强制返回全量
     *   treeShownToModel?: boolean  本次结果是否会展示给模型（决定是否移动差分基线）
     *   budget?: { maxNodes, maxDepth, deadlineMs }
     *
     * 返回：渲染好的 DSL 文本 + 结构化元信息。
     * 文本给模型，元信息给宿主做账本与诊断。
     */
    [HELPER_METHODS.CAPTURE]: (params) => {
      const runtime = ensureUia();
      const windows = listWindows(runtime);

      const wantedId = stringParam(params, "runtimeId");
      const wantedPid = intParam(params, "processId");
      const wantedName = stringParam(params, "appName");

      // 选目标窗口：优先 runtimeId 精确匹配；否则按 pid 取第一个有标题的
      let target = wantedId ? windows.find((window) => window.runtimeId === wantedId) : undefined;
      if (!target && wantedPid !== undefined) {
        target = windows.find((window) => window.processId === wantedPid && window.title);
      }
      if (!target && wantedPid !== undefined) {
        target = windows.find((window) => window.processId === wantedPid);
      }
      // 按应用名匹配（SDK 的 `{name}` / `{bundle_id}` 形式）。
      //
      // 匹配顺序刻意从严到宽：完全相等 → 去扩展名后相等 → 标题包含。
      // 为什么不只做「包含」：`{name:"Code"}` 用包含会先命中「Visual Studio Code」
      // 之外的各种窗口（标题里出现 Code 的很多），模型会拿到错的应用树却毫无提示。
      // 全等优先能让精确名字一次命中，只有模糊名字才退化到包含。
      if (!target && wantedName) {
        const needle = wantedName.trim().toLowerCase();
        target = windows.find((window) => window.title?.trim().toLowerCase() === needle);
        if (!target) {
          // 「Notepad.exe」/「notepad」都应对上标题「无标题 - Notepad」
          const bare = needle.replace(/\.exe$/u, "");
          target = windows.find((window) => {
            const title = window.title?.trim().toLowerCase() ?? "";
            return title === bare || title.endsWith(` - ${bare}`);
          });
        }
        if (!target) {
          target = windows.find((window) =>
            window.title?.toLowerCase().includes(needle) && window.title,
          );
        }
      }
      if (!target) {
        const available = windows
          .filter((window) => window.title)
          .map((window) => `"${window.title}"`)
          .slice(0, 12)
          .join(", ");
        throw Object.assign(
          new Error(
            wantedId
              ? `window not found: runtimeId=${wantedId}`
              : wantedName
                ? `找不到应用 "${wantedName}" 的窗口。当前有标题的窗口: ${available || "无"}`
                : `no window found for processId=${String(wantedPid)}`,
          ),
          { code: "window_not_found" },
        );
      }

      // 窗口身份：优先 runtimeId，退化到 pid + 标题
      const windowKey = target.runtimeId || `${target.processId}:${target.title}`;

      const budget = (() => {
        if (!params || typeof params !== "object") return undefined;
        const raw = (params as Record<string, unknown>).budget;
        if (!raw || typeof raw !== "object") return undefined;
        const record = raw as Record<string, unknown>;
        const pick = (key: string): number | undefined =>
          typeof record[key] === "number" && Number.isInteger(record[key])
            ? (record[key] as number)
            : undefined;
        return {
          maxNodes: pick("maxNodes"),
          maxDepth: pick("maxDepth"),
          deadlineMs: pick("deadlineMs"),
        };
      })();

      const snapshot = captureSnapshot(runtime, {
        root: target.element,
        sequence: snapshots.nextSequence(),
        budget: budget
          ? {
              maxNodes: budget.maxNodes ?? DEFAULT_BUDGET.maxNodes,
              maxDepth: budget.maxDepth ?? DEFAULT_BUDGET.maxDepth,
              deadlineMs: budget.deadlineMs ?? DEFAULT_BUDGET.deadlineMs,
            }
          : undefined,
      });

      const recordResult = snapshots.record(windowKey, snapshot);

      const disableDiffing =
        params && typeof params === "object"
          ? (params as Record<string, unknown>).disableDiffing === true
          : false;
      const treeShownToModel =
        params && typeof params === "object"
          ? (params as Record<string, unknown>).treeShownToModel === true
          : false;

      const baseline = disableDiffing ? undefined : snapshots.baselineOf(windowKey);

      // 有基线就走差分，否则全量。此外还有一条来自上游的硬规则（spec §5.3）：
      // 「只截图观察之后，再依赖无障碍索引前必须先拿整树」——
      // 所以基线存在但上一次展示不含树时，本次也强制全量。
      const text = baseline ? renderDiff(diffSnapshots(baseline, snapshot), snapshot) : renderSnapshot(snapshot);
      const mode: "full" | "delta" = baseline ? "delta" : "full";

      // 只有明确告知「会展示给模型」时才移动基线（spec §5.3）
      if (treeShownToModel) {
        snapshots.markShown(windowKey, snapshot);
      }

      return {
        text,
        mode,
        stateId: snapshot.stateId,
        windowTitle: snapshot.windowTitle,
        processId: snapshot.processId,
        frameworkId: snapshot.frameworkId,
        windowKey,
        nodeCount: snapshot.nodes.length,
        truncated: snapshot.truncated,
        truncationReason: snapshot.truncationReason,
        brittleTree: snapshot.brittleTree,
        // 历史快照已满：旧 stateId 可能已被淘汰。调用方应提示模型重新观察。
        capacityExceeded: recordResult.evicted,
        // 坐标动作的根：窗口根元素在快照里的索引恒为 0。
        // 坐标空间固定 0-1000 窗口相对，避免 DPI/分辨率变化导致漂移。
        coordinateRootId: "0",
        coordinateSpace: { width: 1000, height: 1000 },
        // 同进程其他窗口：弹窗/对话框是「元素消失」的常见原因，
        // 提前给模型一个提示，避免它把「读到了另一个窗口」误判为动作成功。
        relatedWindows: listWindows(runtime)
          .filter(
            (window) =>
              window.processId === snapshot.processId &&
              window.runtimeId !== target.runtimeId &&
              window.title,
          )
          .slice(0, 8)
          .map((window) => ({
            window_id: window.runtimeId,
            title: window.title,
            class_name: window.className,
            is_modal: window.className === "#32770",
          })),
        // 结构化元素表。SDK 的 appStateOf 强制要求这个字段——
        // 缺了它模型完全看不到树（STRUCTURED_STATE_UNAVAILABLE）。
        // 只给「可交互或带内容」的元素：把 800 个装饰性容器全发下去
        // 既费 token，也没有任何可操作性。
        elements: collectElements(snapshot),
        elapsedMs: snapshot.elapsedMs,
      };
    },

    // 动作类方法（点击 / 派发 / 键盘 / 滚动 / 拖拽 / 选区）在 `action-handlers.ts`。
    // 拆出去的理由：本文件要管进程生命周期（管道、父进程看护、空闲回收），
    // 再塞进六个动作实现会超出可读范围，也无法单独测试动作逻辑。
    ...buildActionHandlers(
      { ensureUia, snapshots },
      {
        CLICK: HELPER_METHODS.CLICK,
        ACT: HELPER_METHODS.ACT,
        KEY: HELPER_METHODS.KEY,
        TYPE_INTO_ELEMENT: HELPER_METHODS.TYPE_INTO_ELEMENT,
        SCROLL: HELPER_METHODS.SCROLL,
        DRAG: HELPER_METHODS.DRAG,
        SELECT_TEXT: HELPER_METHODS.SELECT_TEXT,
      },
    ),

    /**
     * 会话拓扑探测。
     *
     * 不抛错：探测失败本身就是要报告的信息。返回完整的会话列表
     * 与「为什么不能跨会话」的具体原因，让模型据此如实告知用户，
     * 而不是反复尝试一条注定不通的路。
     */
    [HELPER_METHODS.SESSIONS]: () => {
      const topology = probeSessionTopology();
      return {
        current_session_id: topology.currentSessionId,
        sessions: topology.sessions.map((s) => ({
          session_id: s.sessionId,
          state: s.state,
          station: s.stationName,
          is_current: s.isCurrent,
          has_interactive_desktop: s.hasInteractiveDesktop,
        })),
        child_sessions_enabled: topology.childSessionsEnabled,
        child_session_id: topology.childSessionId ?? null,
        can_change_session: topology.canChangeSession,
        session_change_blocker: topology.sessionChangeBlocker,
        cross_session_available: topology.crossSessionAvailable,
        guidance: topology.guidance,
      };
    },

    /**
     * 独立桌面（子会话）能力判定。
     *
     * 只判定不创建。返回逐道前置门的实测结果，让调用方能区分
     * 「等一等就好」与「永远不行」——这两种状态的处理方式完全不同。
     */
    [HELPER_METHODS.ISOLATED_DESKTOP]: () => {
      const state = probeIsolatedDesktop();
      return {
        capability: state.capability,
        actionable: state.actionable,
        current_session_id: state.currentSessionId,
        child_session_id: state.childSessionId ?? null,
        can_spawn_into_child: state.canSpawnIntoChild,
        gates: state.gates,
        summary: state.summary,
        next_step: state.nextStep,
      };
    },

    /**
     * 窗口移出屏幕 / 移回。
     *
     * 这是「后台持续出画面」的正确做法：移出屏幕不销毁客户区，
     * 采集与元素操作都正常；最小化会销毁客户区（`ClientRect=0x0`），
     * PrintWindow 与 WGC 都失效。
     *
     * 参数：
     *   action: "hide" | "restore"
     *   hwnd: 窗口句柄（字符串或数字）
     *   x / y: restore 时的目标坐标
     */
    [HELPER_METHODS.WINDOW_OFFSCREEN]: (params) => {
      const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
      const action = typeof record.action === "string" ? record.action : "hide";

      const rawHwnd = record.hwnd;
      const hwndValue =
        typeof rawHwnd === "number"
          ? rawHwnd
          : typeof rawHwnd === "string"
            ? Number.parseInt(rawHwnd, rawHwnd.startsWith("0x") ? 16 : 10)
            : Number.NaN;
      if (!Number.isFinite(hwndValue) || hwndValue === 0) {
        return { ok: false, reason: "invalid_window", message: "缺少或无效的 hwnd 参数。" };
      }
      const hwnd = BigInt(hwndValue >>> 0);

      if (action === "restore") {
        const x = typeof record.x === "number" ? record.x : Number.NaN;
        const y = typeof record.y === "number" ? record.y : Number.NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return {
            ok: false,
            reason: "invalid_window",
            message: "restore 需要 x / y 坐标（取自 hide 返回的 previousRect）。",
          };
        }
        return restoreWindowPosition(hwnd, { x, y });
      }

      return hideWindowOffscreen(hwnd);
    },

    /**
     * 两阶段窗口恢复。
     *
     * 参数：
     *   phase: "prepare" | "restore"
     *   stateId?: string      用快照定位窗口（优先）
     *   windowId?: string     窗口 runtimeId
     *   pid?: number          按进程找第一个有标题的窗口
     *   hwnd?: string|number  直接句柄
     *   recovery_id?: string  restore 阶段必需
     *   foreground?: boolean  restore 阶段是否激活窗口
     */
    [HELPER_METHODS.RESTORE_WINDOW]: (params) => {
      const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
      const phase = record.phase === "restore" ? "restore" : "prepare";
      const hwnd = resolveWindowHwnd(record);
      if (hwnd === undefined) {
        throw Object.assign(
          new Error("restore_window 需要 stateId、windowId、pid 或 hwnd 之一来定位窗口。"),
          { code: "window_not_found" },
        );
      }
      if (phase === "prepare") return prepareWindowRestore(hwnd);

      const recoveryId =
        typeof record.recovery_id === "string"
          ? record.recovery_id
          : typeof record.recoveryId === "string"
            ? record.recoveryId
            : undefined;
      if (!recoveryId) {
        throw Object.assign(new Error("restore 阶段需要 recovery_id（来自 prepare）。"), {
          code: "bad_request",
        });
      }
      return restoreWindow(hwnd, recoveryId, record.foreground === true);
    },

    /**
     * 窗口截图。
     *
     * 参数：
     *   stateId?: string  用快照定位窗口（优先）
     *   index?: number    取该元素的窗口根 HWND（可选，默认用快照的根）
     *   processId?: number 按进程找主窗口（stateId 缺失时的备选）
     *
     * 返回 PNG 的 base64。**纯色图必须标 blank**——硬件加速的窗口
     * 经常给出纯黑图，当成有效截图会让模型基于空白画面做错误判断。
     */
    [HELPER_METHODS.SCREENSHOT]: (params) => {
      const startedAt = Date.now();
      const stateId = stringParam(params, "stateId");
      const hwndHint = stringParam(params, "hwnd");

      let hwnd: bigint | undefined;
      let windowTitle = "";

      if (stateId) {
        const snapshot = snapshots.findByStateId(stateId);
        if (!snapshot) {
          throw Object.assign(new Error(`stale stateId: ${stateId}`), {
            code: "state_invalidated",
          });
        }
        const rootHandle = readNativeWindowHandle(snapshot.rootElement);
        hwnd = normalizeHwnd(rootHandle) ?? undefined;
        windowTitle = snapshot.windowTitle;
      } else if (hwndHint && /^\d+$/.test(hwndHint)) {
        hwnd = BigInt(hwndHint);
      }

      if (hwnd === undefined) {
        throw Object.assign(
          new Error(
            "screenshot 需要 stateId（先观察拿到快照）或 hwnd。按进程号找窗口不可靠——" +
              "同一进程可能有多个窗口，请先用 list_windows 再观察。",
          ),
          { code: "bad_request" },
        );
      }

      const capture = captureWindow(hwnd);
      if (!capture.ok || !capture.png) {
        throw Object.assign(
          new Error(capture.reason ?? "截图失败"),
          { code: "element_unavailable" },
        );
      }

      return {
        mime_type: "image/png",
        width: capture.width,
        height: capture.height,
        // base64 而不是原始字节：这条链路是 JSON over pipe，
        // 二进制会被 JSON.stringify 破坏。
        base64: capture.png.toString("base64"),
        byte_length: capture.png.length,
        // 坐标动作必须绑定这一帧；窗口移动/缩放/Helper 重启后旧 frame 失效。
        frame_id: stateId
          ? `frame-${stateId}-${Date.now().toString(36)}`
          : `frame-hwnd-${hwnd.toString(16)}-${Date.now().toString(36)}`,
        coordinate_root_id: "0",
        coordinate_space: { width: 1000, height: 1000 },
        // 纯色必须显式回报，理由见方法注释
        blank: capture.blank,
        blank_reason: capture.blank ? capture.reason : undefined,
        // 画面可能冻结（窗口完全在屏幕外）也必须显式回报：
        // 那种情况下图看着正常，但内容是最后一帧，会误导决策。
        may_be_frozen: capture.mayBeFrozen,
        frozen_reason: capture.mayBeFrozen ? capture.reason : undefined,
        window_title: windowTitle,
        elapsedMs: Date.now() - startedAt,
      };
    },
  };
}


// ---------------------------------------------------------------------------
// 连接处理
// ---------------------------------------------------------------------------

interface ServerState {
  server: Server;
  sockets: Set<Socket>;
  idleTimer: NodeJS.Timeout | undefined;
  parentTimer: NodeJS.Timeout | undefined;
  stopping: boolean;
}

function createHelperServer(options: HelperOptions, handlers: Record<string, MethodHandler>): ServerState {
  const sockets = new Set<Socket>();

  const state: ServerState = {
    // 先占位，listen 之后赋值；保持类型完整
    server: undefined as unknown as Server,
    sockets,
    idleTimer: undefined,
    parentTimer: undefined,
    stopping: false,
  };

  let lastActivityAt = Date.now();
  const resetIdleTimer = () => {
    lastActivityAt = Date.now();
  };

  const handleRequest = async (request: HelperRequest): Promise<HelperResponse> => {
    const handler = handlers[request.method];
    if (!handler) {
      return errorResponse(
        request.id,
        HELPER_ERROR_CODES.METHOD_NOT_FOUND,
        `unknown method: ${request.method}`,
      );
    }
    try {
      const result = await handler(request.params);
      return okResponse(request.id, result);
    } catch (error) {
      // 把栈写进 stderr，native 崩溃前最后一句话可能就在这里
      process.stderr.write(
        JSON.stringify({
          event: "helper_handler_error",
          method: request.method,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }) + "\n",
      );
      const record = error as { code?: string; message?: string };
      return errorResponse(
        request.id,
        record.code ?? HELPER_ERROR_CODES.INTERNAL,
        record.message ?? (error instanceof Error ? error.message : String(error)),
      );
    }
  };

  const server = createServer((socket: Socket) => {
    sockets.add(socket);
    resetIdleTimer();
    socket.setEncoding("utf8");
    socket.setNoDelay(true);

    let buffer = "";

    socket.on("data", (chunk: string) => {
      resetIdleTimer();
      buffer += chunk;
      const { lines, rest, tooLong } = takeLines(buffer);
      buffer = rest;

      if (tooLong) {
        socket.end(serializeResponse(errorResponse(null, HELPER_ERROR_CODES.LINE_TOO_LONG, `line exceeds limit`)));
        return;
      }

      for (const line of lines) {
        const request = parseRequestLine(line);
        if (!request) {
          socket.write(serializeResponse(errorResponse(null, HELPER_ERROR_CODES.BAD_REQUEST, "malformed request line")));
          continue;
        }
        // 逐条串行处理：UIA 调用是同步阻塞的，并行没有收益且会让错误归因变难
        void handleRequest(request)
          .then((response) => {
            if (socket.destroyed) return;
            socket.write(serializeResponse(response));
          })
          .catch((error: unknown) => {
            if (socket.destroyed) return;
            socket.write(
              serializeResponse(
                errorResponse(
                  request.id,
                  HELPER_ERROR_CODES.INTERNAL,
                  error instanceof Error ? error.message : String(error),
                ),
              ),
            );
          });
      }
    });

    socket.on("error", () => {
      // 对端断开是常态（宿主重启、应用退出），不当作错误上报
      sockets.delete(socket);
    });

    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  state.server = server;

  // 空闲回收：长时间无请求即退出，下次由宿主懒启动
  const checkIdle = () => {
    if (state.stopping) return;
    if (Date.now() - lastActivityAt < options.idleTimeoutMs) return;
    shutdown(0, "idle-timeout");
  };
  state.idleTimer = setInterval(checkIdle, Math.min(30_000, Math.max(1_000, options.idleTimeoutMs / 4)));
  state.idleTimer.unref();

  // 父进程看护：宿主退出后本进程必须跟着退出，否则会留下孤儿占着管道
  const checkParent = () => {
    if (state.stopping) return;
    if (isProcessAlive(options.parentPid)) return;
    shutdown(0, "parent-gone");
  };
  state.parentTimer = setInterval(checkParent, PARENT_CHECK_INTERVAL_MS);
  state.parentTimer.unref();

  return state;
}

/**
 * 从 restore_window 参数解析目标窗口句柄。
 *
 * 优先级：stateId（快照根）→ hwnd → windowId/runtimeId → pid。
 * 与 capture 的窗口选择保持一致：pid 只取第一个有标题的窗口，
 * 多窗口场景应显式给 windowId。
 */
function resolveWindowHwnd(record: Record<string, unknown>): bigint | undefined {
  const stateId = typeof record.stateId === "string" ? record.stateId : undefined;
  if (stateId) {
    const snapshot = snapshots.findByStateId(stateId);
    if (!snapshot) {
      throw Object.assign(new Error(`stale stateId: ${stateId}`), { code: "state_invalidated" });
    }
    return normalizeHwnd(readNativeWindowHandle(snapshot.rootElement)) ?? undefined;
  }

  const rawHwnd = record.hwnd;
  if (typeof rawHwnd === "number" || typeof rawHwnd === "string") {
    const parsed =
      typeof rawHwnd === "number"
        ? rawHwnd
        : Number.parseInt(rawHwnd, rawHwnd.startsWith("0x") ? 16 : 10);
    if (Number.isFinite(parsed) && parsed !== 0) return BigInt(parsed >>> 0);
  }

  const runtime = ensureUia();
  const windows = listWindows(runtime);
  const wantedWindowId =
    typeof record.windowId === "string"
      ? record.windowId
      : typeof record.runtimeId === "string"
        ? record.runtimeId
        : undefined;
  if (wantedWindowId) {
    const target = windows.find((window) => window.runtimeId === wantedWindowId);
    if (!target) {
      throw Object.assign(new Error(`window not found: windowId=${wantedWindowId}`), {
        code: "window_not_found",
      });
    }
    return normalizeHwnd(readNativeWindowHandle(target.element)) ?? undefined;
  }

  const pid = typeof record.pid === "number" ? record.pid : undefined;
  if (pid !== undefined) {
    const target = windows.find((window) => window.processId === pid && window.title);
    if (!target) {
      throw Object.assign(new Error(`no window found for pid=${pid}`), {
        code: "window_not_found",
      });
    }
    return normalizeHwnd(readNativeWindowHandle(target.element)) ?? undefined;
  }

  return undefined;
}

/** 用 signal 0 探测进程是否存活，不实际发送信号。 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM 说明进程存在但无权限（例如宿主提权了），仍算存活
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

let shutdownOnce: ((code: number, reason: string) => void) | undefined;

/**
 * 优雅关闭。
 *
 * 顺序固定：停接新连接 → 关闲置连接 → 释放 UIA → 关定时器 → 退出。
 * 释放 UIA 必须在退出前，否则 COM 引用泄漏（虽然进程退出会回收，
 * 但保持正确顺序便于将来改为可重启的子进程）。
 */
function shutdown(code: number, reason: string): void {
  if (shutdownOnce) shutdownOnce(code, reason);
}

function installShutdown(state: ServerState): void {
  let stopping = false;
  shutdownOnce = (code: number, reason: string) => {
    if (stopping) return;
    stopping = true;
    state.stopping = true;

    if (state.idleTimer) clearInterval(state.idleTimer);
    if (state.parentTimer) clearInterval(state.parentTimer);

    try {
      state.server.close();
    } catch {
      // close 在未 listen 时抛错，忽略
    }
    for (const socket of state.sockets) {
      socket.destroy();
    }
    state.sockets.clear();

    try {
      uiaRuntime?.dispose();
      uiaRuntime = undefined;
    } catch {
      // 释放失败不阻塞退出
    }

    process.stdout.write(
      `${JSON.stringify({ event: "helper_exit", reason, code, pid: process.pid })}\n`,
    );
    process.exit(code);
  };

  process.on("SIGTERM", () => shutdown(0, "sigterm"));
  process.on("SIGINT", () => shutdown(0, "sigint"));
  process.on("uncaughtException", (error) => {
    process.stderr.write(
      `${JSON.stringify({ event: "helper_uncaught", message: error.message, stack: error.stack })}\n`,
    );
    shutdown(1, "uncaught-exception");
  });
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(
      `${JSON.stringify({ event: "helper_unhandled_rejection", reason: String(reason) })}\n`,
    );
    // 不因此退出：单次请求的 rejection 不该拖垮整个进程
  });
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const handlers = buildHandlers();
  const state = createHelperServer(options, handlers);

  installShutdown(state);

  state.server.on("error", (error) => {
    process.stderr.write(
      `${JSON.stringify({
        event: "helper_listen_error",
        message: error.message,
        socket: options.socketPath,
      })}\n`,
    );
    shutdown(1, "listen-error");
  });

  state.server.listen(options.socketPath, () => {
    const sessionId = currentSessionId();

    // 就绪信号：宿主靠这一行判断可以发请求了。
    // 必须在一行内且可解析，不能用纯文本日志。
    //
    // 它还承担第二个职责：**同会话启动时，这是握手通道**。
    // 管道句柄不能跨会话继承，所以别的会话里的 host 无法由主进程预先指定
    // 管道名——它自己生成一个，再把名字写在这行 JSON 里让主进程去连。
    process.stdout.write(
      `${JSON.stringify({
        event: "helper_ready",
        socket: options.socketPath,
        pid: process.pid,
        parentPid: options.parentPid,
        sessionId,
        protocolVersion: HELPER_PROTOCOL_VERSION,
        // host 在哪个会话里跑，决定了它能看到哪个桌面的窗口。
        // 带上这个字段，主进程才能判定「它是替我在干活，还是在替别的桌面干活」。
        targetSessionId: options.targetSessionId ?? null,
      })}\n`,
    );

    // 跨会话启动时 stdout 到不了主进程，改用引导管道反向回报。
    // 失败不退出：同会话启动本来就没有引导管道，那不算错误。
    if (options.bootstrap) {
      void reportAddressToBootstrap(options.bootstrap, {
        socket: options.socketPath,
        pid: process.pid,
        sessionId,
        protocolVersion: HELPER_PROTOCOL_VERSION,
      }).catch((error: unknown) => {
        // 只记 stderr：这条失败不影响本进程服务，
        // 但主进程会因等不到回报而超时，留个线索便于归因。
        process.stderr.write(
          `[bootstrap] 回报地址失败: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      });
    }
  });
}

main();
