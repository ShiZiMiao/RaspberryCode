/**
 * Runtime handler 的共享参数解析与目标解析。
 *
 * 从 `handlers.ts` 抽出：这些函数被观察、动作、窗口恢复多个 handler 共用，
 * 放在入口文件里会让它随能力增长持续膨胀。本模块不持有状态，只做纯解析。
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CuaHelperClient } from "./helper-client.ts";
import {
  DISPATCH_ERROR_CODES,
  buildErrorResult,
  type DispatchErrorCode,
} from "./receipts.ts";
import type { DispatchPolicy } from "./sdk-contract.ts";
import { lastStateIdForApp } from "./window-lanes.ts";

/**
 * 把动作请求上下文挂到错误上，让收据能解释「我按哪条路走的」。
 *
 * 不扩展 Helper 协议的理由：Helper 只报「为什么失败」，
 * 「原本想走哪条路、当前预算是什么」是 runtime 侧的事实。
 * 让信息留在知道它的那一层，协议就不会因为审计需求而膨胀。
 */
export function withRequestContext<T>(
  promise: Promise<T>,
  context: Record<string, unknown>,
): Promise<T> {
  return promise.catch((error: unknown) => {
    const target = error as { detail?: Record<string, unknown> };
    // 展开 undefined 是安全的（无属性可加），所以不需要空对象兜底
    target.detail = { ...context, ...target.detail };
    throw error;
  });
}

/** 从参数取进程号。SDK 用 `app_ref`，可能是数字字符串，也可能是 `{pid}` 对象。 */
export function coerceProcessId(params: Record<string, unknown>): number | undefined {
  // `{pid: 1234}` 对象形式（SDK 的 appRefFor 会这么传）
  const rawAppRef = params.app_ref ?? params.appRef;
  if (rawAppRef && typeof rawAppRef === "object" && !Array.isArray(rawAppRef)) {
    const pid = (rawAppRef as Record<string, unknown>).pid;
    if (typeof pid === "number" && Number.isInteger(pid)) return pid;
    if (typeof pid === "string" && /^\d+$/.test(pid)) return Number.parseInt(pid, 10);
  }
  for (const candidate of [params.processId, params.process_id, params.app_ref]) {
    if (typeof candidate === "number" && Number.isInteger(candidate)) return candidate;
    if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
      return Number.parseInt(candidate, 10);
    }
  }
  return undefined;
}

/** 解析 SDK 的 target 结构。 */
export function parseSdkTarget(
  raw: unknown,
): { kind: "element" | "coordinate"; index?: number; x?: number; y?: number } | undefined {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
    return { kind: "element", index: raw };
  }
  if (Array.isArray(raw) && raw.length === 2) {
    const [x, y] = raw;
    if (Number.isInteger(x) && Number.isInteger(y)) {
      return { kind: "coordinate", x, y };
    }
    return undefined;
  }
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (record.type === "element" && typeof record.index === "number") {
      return { kind: "element", index: record.index };
    }
    if (record.type === "coordinate") {
      const x = record.x;
      const y = record.y;
      if (typeof x === "number" && typeof y === "number") {
        return { kind: "coordinate", x, y };
      }
    }
  }
  return undefined;
}

/**
 * 确保有一次可用的观察，返回 stateId。
 *
 * 三种来源，按优先级：
 * 1. 显式 `state_id`（内部诊断入口、脚本会传）
 * 2. 按 `app_ref` 找到**该应用最近一次**观察（SDK 的真实调用方式）
 * 3. 都没有则报错
 *
 * **为什么必须有第 2 条**（2026-11-19 实测纠正）：SDK 的动作调用
 * （`left_click` / `set_value` / `select_text` …）**从不发送 `state_id`**——
 * 它发的是 `target: {type:"element", index}` 加 `app_ref`，并在注释里写明
 * 「app_ref 说明按哪个 app 的最新观察解析」（见 computer-use-client.mjs 的
 * `act()` 调用点）。只认 `state_id` 会让**所有元素类动作在真实链路上全部失败**，
 * 报「该动作需要先观察」，而模型明明刚观察完。
 *
 * 这不是放宽校验：`app_ref` 仍然把索引限定在某个应用的观察范围内，
 * 比「用全局最近一次观察」更严格；索引本身仍由 Helper 侧按 stateId 校验。
 *
 * 不做隐式观察（不自动 capture）：那会让「观察 A → 动作 → 观察 B」的
 * 差分基线错位，模型看到的变化就不再是它以为的那些。
 */
export async function ensureObservation(
  _client: CuaHelperClient,
  params: Record<string, unknown>,
): Promise<{ stateId: string } | { error: CallToolResult }> {
  const stateId =
    typeof params.state_id === "string"
      ? params.state_id
      : typeof params.stateId === "string"
        ? params.stateId
        : undefined;
  if (stateId) return { stateId };

  // 回退：按 app_ref 找该应用最近一次观察的 stateId。
  const appRef = appRefOf(params);
  if (appRef) {
    const remembered = lastStateIdForApp(appRef);
    if (remembered) return { stateId: remembered };
  }

  return {
    error: buildErrorResult(
      DISPATCH_ERROR_CODES.STATE_INVALIDATED,
      appRef
        ? `应用 ${appRef} 还没有可用的观察结果：请先对它调用 get_app_state（同一会话内），再执行动作。`
        : "该动作需要先观察：调用 get_app_state 拿到 state_id，或用 app_ref 指明目标应用。",
      { actionSent: false, detail: { need: "get_app_state" } },
    ),
  };
}

/**
 * 从窗口标题里抽出「应用名」候选键。
 *
 * 例：`"*p - Notepad"` → `["Notepad", "*p"]`；`"无标题 - 记事本"` → `["记事本", "无标题"]`。
 *
 * 为什么需要：SDK 侧的应用名常来自 `listApps()` 的显示名或进程名（`Notepad`），
 * 而窗口标题是「文档名 - 应用名」。不抽末段，`getApp("Notepad")` 观察完
 * 再用 `getApp("Notepad")` 操作就会找不到那次观察。
 *
 * 只按 ` - ` 分隔（Windows 标题栏的标准格式），不做模糊切分——
 * 猜错会让 A 应用的观察被 B 应用的键命中。
 */
export function titleTailKeys(title: string | undefined): string[] {
  if (!title) return [];
  const parts = title
    .split(" - ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return [];
  return [parts[parts.length - 1], parts[0]];
}

/**
 * 从参数里取 `app_ref` 的**对象形式**的应用名。
 *
 * SDK 会把裸字符串统一转成 `{name}` 或 `{bundle_id}`（见 computer-use-client.mjs
 * 的 `appRefFor`），所以这是模型最常触发的形态。`{pid}` 走进程号路径，
 * 不在这里返回。
 */
export function appRefObject(params: Record<string, unknown>): string | undefined {
  const raw = params.app_ref ?? params.appRef;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  // bundle_id 在 Windows 上不是窗口标识，但沿用同一字段名时按名字匹配更有用：
  // 用户/模型写的 "notepad.exe" 之类仍能对上标题。
  for (const key of ["name", "bundle_id", "bundleId", "displayName"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * 从参数里取 `app_ref`（字符串形式）。
 *
 * SDK 的 `app_ref` 是进程号的字符串形式或窗口标识；这里统一转成字符串
 * 作为「应用最近观察」的键。
 */
export function appRefOf(params: Record<string, unknown>): string | undefined {
  const raw = params.app_ref ?? params.appRef;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number" && Number.isInteger(raw)) return String(raw);
  // app_ref 也可能是对象（`{pid}` / `{name}`），取其中可用于匹配的标识。
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (typeof record.pid === "number") return String(record.pid);
    const named = appRefObject(params);
    if (named) return named;
  }
  // 没有 app_ref 时退回进程号字段，让只传 pid 的调用方也能工作。
  const pidCandidates = [params.processId, params.process_id];
  for (const candidate of pidCandidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate)) return String(candidate);
    if (typeof candidate === "string" && /^\d+$/.test(candidate)) return candidate;
  }
  return undefined;
}

/**
 * 解析动作目标为 `(stateId, index)` 或 `(stateId, coordinate)`。
 *
 * 支持元素索引与坐标两种。坐标只做非负校验，具体换算交给 Helper
 * （它才知道窗口矩形）。
 */
export async function resolveActionTarget(
  client: CuaHelperClient,
  params: Record<string, unknown>,
): Promise<
  | { stateId: string; index: number }
  | {
      stateId: string;
      coordinate: { x: number; y: number };
      coordinateSpace?: { width: number; height: number };
    }
  | { error: CallToolResult }
> {
  const state = await ensureObservation(client, params);
  if ("error" in state) return state;

  const target = parseSdkTarget(params.target ?? params.index);
  if (target?.kind === "element" && target.index !== undefined) {
    return { stateId: state.stateId, index: target.index };
  }

  if (
    target?.kind === "coordinate" &&
    target.x !== undefined &&
    target.y !== undefined
  ) {
    // 两种坐标语义：
    // - 带 coordinate_space：x/y 是该空间内的像素，Helper 按比例换算。
    // - 不带：x/y 是窗口客户区像素（SDK 的 [x, y] 历史语义）。
    // 这里只做非负校验，具体换算交给 Helper（它才知道窗口矩形）。
    if (target.x < 0 || target.y < 0) {
      return {
        error: buildErrorResult(
          DISPATCH_ERROR_CODES.BAD_REQUEST,
          "坐标必须是非负数。",
          { actionSent: false, detail: { coordinate: { x: target.x, y: target.y } } },
        ),
      };
    }
    const rawSpace = params.coordinate_space ?? params.coordinateSpace;
    const coordinateSpace =
      rawSpace && typeof rawSpace === "object" && !Array.isArray(rawSpace)
        ? (() => {
            const record = rawSpace as Record<string, unknown>;
            return typeof record.width === "number" &&
              typeof record.height === "number" &&
              record.width > 0 &&
              record.height > 0
              ? { width: record.width, height: record.height }
              : undefined;
          })()
        : undefined;
    return {
      stateId: state.stateId,
      coordinate: { x: target.x, y: target.y },
      ...(coordinateSpace ? { coordinateSpace } : {}),
    };
  }

  return {
    error: buildErrorResult(
      DISPATCH_ERROR_CODES.BAD_REQUEST,
      "缺少目标：请提供 target（元素索引或 {type:\"coordinate\", x, y}）。",
      { actionSent: false },
    ),
  };
}

/**
 * 把动作目标收敛为元素索引。
 *
 * `set_value` / `perform_action` / `select_text` 都需要元素语义，
 * 坐标目标对它们没有意义。明确报错比让 Helper 收到一个缺 index 的请求好。
 */
export function requireElementTarget(
  resolved:
    | { stateId: string; index: number }
    | { stateId: string; coordinate: { x: number; y: number } },
  tool: string,
): { stateId: string; index: number } | { error: CallToolResult } {
  if ("index" in resolved) return resolved;
  return {
    error: buildErrorResult(
      DISPATCH_ERROR_CODES.BAD_REQUEST,
      `${tool} 需要元素索引，不支持坐标目标。请先 get_app_state 取 elements[*].index。`,
      { tool, actionSent: false },
    ),
  };
}

/** 解析可选目标（仅当调用方提供了 target 时才聚焦）。 */
export async function resolveOptionalTarget(
  client: CuaHelperClient,
  params: Record<string, unknown>,
): Promise<{ stateId?: string; index?: number } | { error: CallToolResult }> {
  const hasTarget = params.target !== undefined || params.index !== undefined;
  if (!hasTarget) return {};

  const resolved = await resolveActionTarget(client, params);
  if ("error" in resolved) return resolved;
  if (!("index" in resolved)) {
    return {
      error: buildErrorResult(
        DISPATCH_ERROR_CODES.BAD_REQUEST,
        "该动作需要元素索引，不支持坐标目标。请先 get_app_state 取 elements[*].index。",
        { actionSent: false },
      ),
    };
  }
  return { stateId: resolved.stateId, index: resolved.index };
}

/** 从参数解析 preferPath。仅诊断用途。 */
export function resolvePreferPath(
  params: Record<string, unknown>,
  policy: DispatchPolicy,
): "post_message" | "ax" | "ax_text" | "foreground_send_input" | undefined {
  const forced = params.strategy ?? params.preferPath;
  if (forced === "event" || forced === "foreground_send_input") {
    return "foreground_send_input";
  }
  if (forced === "ax" || forced === "accessibility") return "ax";
  if (forced === "ax_text" || forced === "text") return "ax_text";
  if (forced === "post_message" || forced === "background") return "post_message";
  // quiet 预算下优先消息投递（唯一的非抢键鼠路径）
  return policy.budget === "quiet" ? "post_message" : undefined;
}

/**
 * 检查物理注入是否可用。
 *
 * 三个条件全部满足才算可用：预算 `unrestricted`、用户已授权、平台支持。
 * 缺任何一个都返回明确的错误，让模型知道换什么方式而不是盲目重试。
 */
export function requirePhysicalInjection(
  policy: DispatchPolicy,
  what: string,
): { code: DispatchErrorCode; message: string } | undefined {
  if (policy.budget !== "unrestricted") {
    return {
      code: DISPATCH_ERROR_CODES.FOREGROUND_REQUIRED,
      message:
        `${what}需要物理注入（会抢占鼠标键盘），但当前预算为 ${policy.budget}。` +
        "这是用户的设定，不能由调用方修改。请改用不依赖键盘的方式（如 set_value），或如实告知用户需要放宽预算。",
    };
  }
  if (!policy.allowPhysicalInjection) {
    return {
      code: DISPATCH_ERROR_CODES.AUTHORIZATION_REQUIRED,
      message: `${what}需要用户在设置中显式授权物理注入（抢鼠标键盘），当前未授权。不要重试，如实告知用户。`,
    };
  }
  return undefined;
}
