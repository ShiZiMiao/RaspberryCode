/**
 * Helper 客户端的观察/诊断方法。
 *
 * 从 `helper-client.ts` 抽出：这些方法只做「发请求 + 声明返回形状」，
 * 不参与进程生命周期与熔断逻辑。抽出的另一个收益是实现文件不再持续膨胀。
 */

import { HELPER_METHODS } from "../helper/protocol.ts";

/** 只暴露请求入口，避免观察模块碰到客户端的私有状态。 */
export interface HelperRequester {
  requestRaw(method: string, params: unknown, timeoutMs: number): Promise<unknown>;
}

export async function listWindows(
  client: HelperRequester,
  params?: {
    scope?: "running" | "all";
    includeWindowIds?: boolean;
    windowLimit?: number;
  },
): Promise<{
  windows: {
    runtimeId: string;
    window_id?: string;
    title: string;
    className: string;
    processId: number | undefined;
    frameworkId: string;
    bounds: { left: number; top: number; width: number; height: number } | undefined;
  }[];
  scope: string;
  total: number;
  truncated: boolean;
  elapsedMs: number;
}> {
  return (await client.requestRaw(HELPER_METHODS.LIST_WINDOWS, params, 10_000)) as {
    windows: {
      runtimeId: string;
      window_id?: string;
      title: string;
      className: string;
      processId: number | undefined;
      frameworkId: string;
      bounds: { left: number; top: number; width: number; height: number } | undefined;
    }[];
    scope: string;
    total: number;
    truncated: boolean;
    elapsedMs: number;
  };
}

export async function capture(
  client: HelperRequester,
  params: {
    runtimeId?: string;
    processId?: number;
    appName?: string;
    disableDiffing?: boolean;
    treeShownToModel?: boolean;
    budget?: { maxNodes?: number; maxDepth?: number; deadlineMs?: number };
  },
): Promise<{
  text: string;
  mode: "full" | "delta";
  stateId: string;
  windowTitle: string;
  processId: number | undefined;
  frameworkId: string;
  windowKey: string;
  nodeCount: number;
  truncated: boolean;
  truncationReason: string | undefined;
  brittleTree: boolean;
  capacityExceeded: boolean;
  coordinateRootId: string;
  coordinateSpace: { width: number; height: number };
  relatedWindows: {
    window_id: string;
    title: string;
    class_name: string;
    is_modal: boolean;
  }[];
  elements: {
    index: number;
    kind: string;
    name: string;
    value: string;
    value_known: boolean;
    input_target: boolean;
    states: string[];
    bounds: { left: number; top: number; width: number; height: number } | undefined;
    actions: string[];
  }[];
  elapsedMs: number;
}> {
  return (await client.requestRaw(HELPER_METHODS.CAPTURE, params, 20_000)) as {
    text: string;
    mode: "full" | "delta";
    stateId: string;
    windowTitle: string;
    processId: number | undefined;
    frameworkId: string;
    windowKey: string;
    nodeCount: number;
    truncated: boolean;
    truncationReason: string | undefined;
    brittleTree: boolean;
    capacityExceeded: boolean;
    coordinateRootId: string;
    coordinateSpace: { width: number; height: number };
    relatedWindows: {
      window_id: string;
      title: string;
      class_name: string;
      is_modal: boolean;
    }[];
    elements: {
      index: number;
      kind: string;
      name: string;
      value: string;
      value_known: boolean;
      input_target: boolean;
      states: string[];
      bounds: { left: number; top: number; width: number; height: number } | undefined;
      actions: string[];
    }[];
    elapsedMs: number;
  };
}

export async function windowOffscreen(
  client: HelperRequester,
  params: {
    action: "hide" | "restore";
    hwnd: number;
    x?: number;
    y?: number;
  },
): Promise<{
  ok: boolean;
  mode?: string;
  reason?: string;
  message: string;
  previousRect?: { x: number; y: number; width: number; height: number };
  targetPosition?: { x: number; y: number };
  visibleWidth?: number;
}> {
  return (await client.requestRaw(HELPER_METHODS.WINDOW_OFFSCREEN, params, 10_000)) as {
    ok: boolean;
    mode?: string;
    reason?: string;
    message: string;
    previousRect?: { x: number; y: number; width: number; height: number };
    targetPosition?: { x: number; y: number };
    visibleWidth?: number;
  };
}

export async function isolatedDesktop(client: HelperRequester): Promise<{
  capability: "unsupported" | "supported" | "enabled" | "session_ready";
  actionable: boolean;
  current_session_id: number;
  child_session_id: number | null;
  can_spawn_into_child: boolean;
  gates: {
    id: string;
    label: string;
    passed: boolean;
    detail: string;
    resolvable: boolean;
  }[];
  summary: string;
  next_step: string;
}> {
  return (await client.requestRaw(HELPER_METHODS.ISOLATED_DESKTOP, {}, 10_000)) as {
    capability: "unsupported" | "supported" | "enabled" | "session_ready";
    actionable: boolean;
    current_session_id: number;
    child_session_id: number | null;
    can_spawn_into_child: boolean;
    gates: {
      id: string;
      label: string;
      passed: boolean;
      detail: string;
      resolvable: boolean;
    }[];
    summary: string;
    next_step: string;
  };
}

export async function screenshot(
  client: HelperRequester,
  params: { stateId?: string; hwnd?: string },
): Promise<{
  mime_type: string;
  width: number;
  height: number;
  base64: string;
  byte_length: number;
  frame_id: string;
  coordinate_root_id: string;
  coordinate_space: { width: number; height: number };
  blank: boolean;
  blank_reason?: string;
  may_be_frozen: boolean;
  frozen_reason?: string;
  window_title: string;
  elapsedMs: number;
}> {
  return (await client.requestRaw(HELPER_METHODS.SCREENSHOT, params, 20_000)) as {
    mime_type: string;
    width: number;
    height: number;
    base64: string;
    byte_length: number;
    frame_id: string;
    coordinate_root_id: string;
    coordinate_space: { width: number; height: number };
    blank: boolean;
    blank_reason?: string;
    may_be_frozen: boolean;
    frozen_reason?: string;
    window_title: string;
    elapsedMs: number;
  };
}
