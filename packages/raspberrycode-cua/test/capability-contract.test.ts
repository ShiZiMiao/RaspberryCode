/**
 * 2026-11-25 能力补全契约测试。
 *
 * 覆盖新增的观察字段、坐标路由、定向文本输入、窗口恢复、错误语义。
 * 不碰真实窗口：用假 Helper 记录 runtime 传给 Helper 的参数。
 */

import { describe, expect, it } from "vitest";
import { createComputerUseRuntime } from "../src/runtime/index.js";
import type { CuaHelperClient } from "../src/runtime/helper-client.js";
import { buildActionResult, buildObservationResult, SDK_METHODS } from "../src/runtime/sdk-contract.js";
import { classifyError, DISPATCH_ERROR_CODES } from "../src/runtime/receipts.js";
import { renderSnapshot } from "../src/helper/render.js";
import { collectElements } from "../src/helper/handler-support.js";
import { SnapshotStore } from "../src/helper/snapshot-store.js";
import { hwndFromWindowKey } from "../src/helper/window-visibility.js";
import { windowKeyOfState } from "../src/runtime/window-lanes.js";
import type { UiaSnapshot } from "../src/helper/tree.js";

function snapshot(overrides: Partial<UiaSnapshot> = {}): UiaSnapshot {
  return {
    stateId: "s-1",
    windowTitle: "Notepad",
    windowKey: "42.1",
    processId: 1234,
    frameworkId: "Win32",
    nodes: [
      {
        runtimeId: "1",
        kind: "window",
        controlType: 50032,
        name: "Notepad",
        value: "",
        valueKnown: true,
        automationId: "",
        className: "Notepad",
        depth: 0,
        parentIndex: -1,
        childIndexes: [1],
        bounds: { left: 0, top: 0, width: 100, height: 100 },
        states: [],
        interactive: false,
        inputTarget: false,
        offscreen: false,
        element: undefined,
      },
      {
        runtimeId: "2",
        kind: "edit",
        controlType: 50004,
        name: "文本编辑器",
        value: "",
        valueKnown: false,
        automationId: "edit",
        className: "Edit",
        depth: 1,
        parentIndex: 0,
        childIndexes: [],
        bounds: { left: 0, top: 0, width: 100, height: 100 },
        states: ["readonly"],
        interactive: true,
        inputTarget: false,
        offscreen: false,
        element: undefined,
      },
    ],
    truncated: false,
    truncationReason: undefined,
    elapsedMs: 1,
    brittleTree: false,
    rootElement: undefined,
    ...overrides,
  };
}

function fakeHelper(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const captureResult = {
    text: "tree",
    stateId: "s-1",
    windowTitle: "Notepad",
    processId: 1234,
    frameworkId: "Win32",
    windowKey: "42.1",
    nodeCount: 2,
    truncated: false,
    mode: "full",
    brittleTree: false,
    coordinateRootId: "0",
    coordinateSpace: { width: 1000, height: 1000 },
    relatedWindows: [],
    elapsedMs: 1,
    elements: [
      {
        index: 0,
        kind: "window",
        name: "Notepad",
        value: "",
        value_known: true,
        input_target: false,
        states: [],
        bounds: { left: 0, top: 0, width: 100, height: 100 },
        actions: [],
      },
    ],
  };
  const record = (method: string) => (params: Record<string, unknown>) => {
    calls.push({ method, params });
    const override = overrides[method];
    if (typeof override === "function") return Promise.resolve(override(params));
    if (override !== undefined) return Promise.resolve(override);
    if (method === "capture") return Promise.resolve(captureResult);
    return Promise.resolve({});
  };
  return {
    calls,
    client: {
      ensureReady: () => Promise.resolve(),
      ping: () => Promise.resolve({ sessionId: 6 }),
      listWindows: record("listWindows"),
      capture: record("capture"),
      act: record("act"),
      typeIntoElement: record("typeIntoElement"),
      sendKey: record("sendKey"),
      sendScroll: record("sendScroll"),
      drag: record("drag"),
      selectText: record("selectText"),
      launchApp: record("launchApp"),
      restoreWindow: record("restoreWindow"),
      screenshot: () =>
        Promise.resolve({
          base64: "",
          mime_type: "image/png",
          width: 1,
          height: 1,
          byte_length: 0,
          frame_id: "frame-s-1-x",
          coordinate_root_id: "0",
          coordinate_space: { width: 1000, height: 1000 },
          blank: false,
          may_be_frozen: false,
          window_title: "Notepad",
          elapsedMs: 1,
        }),
      stop: () => Promise.resolve(),
    } as unknown as CuaHelperClient,
    captureResult,
  };
}

const ctx = { sessionId: "t", runtimeScope: "main" as const, workspaceKey: "ws" };

describe("观察契约扩展", () => {
  it("渲染 input_target=false 与 value=unknown", () => {
    const text = renderSnapshot(snapshot());
    expect(text).toContain("input_target=false");
    expect(text).toContain("value=unknown");
  });

  it("结构化元素表带 input_target / value_known", () => {
    const elements = collectElements(snapshot());
    expect(elements[1]?.input_target).toBe(false);
    expect(elements[1]?.value_known).toBe(false);
  });

  it("可输入 document 即使不是 interactive kind 也保留输入目标与动作", () => {
    // 回归：记事本编辑区是 Document 控件，不在 INTERACTIVE_KINDS 里。
    // 若 inputTarget 绑死 interactive，这类应用永远没有可输入目标。
    const doc = snapshot({
      nodes: [
        {
          runtimeId: "1",
          kind: "document",
          controlType: 50030,
          name: "文本编辑器",
          value: "",
          valueKnown: true,
          automationId: "TextEditor",
          className: "RichEditD2DPT",
          depth: 0,
          parentIndex: -1,
          childIndexes: [],
          bounds: { left: 0, top: 0, width: 100, height: 100 },
          states: [],
          interactive: false,
          inputTarget: true,
          offscreen: false,
          element: undefined,
        },
      ],
    });
    const elements = collectElements(doc);
    expect(elements[0]?.input_target).toBe(true);
    expect(elements[0]?.actions).toEqual(expect.arrayContaining(["click", "set_value"]));
    expect(renderSnapshot(doc)).not.toContain("input_target=false");
  });

  it("观察结果带 coordinate_root_id / coordinate_space / related_windows", () => {
    const result = buildObservationResult({
      text: "tree",
      stateId: "s-1",
      appName: "Notepad",
      processId: 1234,
      frameworkId: "Win32",
      mode: "full",
      nodeCount: 1,
      truncated: false,
      truncationReason: undefined,
      brittleTree: false,
      elapsedMs: 1,
      windowKey: "42.1",
      coordinateRootId: "0",
      coordinateSpace: { width: 1000, height: 1000 },
      relatedWindows: [
        { window_id: "42.2", title: "Dialog", class_name: "#32770", is_modal: true },
      ],
      elements: [],
    });
    expect(result.structuredContent?.coordinate_root_id).toBe("0");
    expect(result.structuredContent?.coordinate_space).toEqual({ width: 1000, height: 1000 });
    expect(result.structuredContent?.related_windows).toHaveLength(1);
  });

  it("get_app_state 登记 stateId → windowKey", async () => {
    const { client } = fakeHelper();
    const rt = createComputerUseRuntime({ helperFactory: () => client });
    const result = await rt.execute({
      toolName: "get_app_state",
      arguments: { app_ref: "1234", disable_diffing: true },
      context: ctx,
    });
    const stateId = result.structuredContent?.state_id as string;
    expect(windowKeyOfState(stateId)).toBe("42.1");
    await rt.dispose();
  });
});

describe("收据与错误语义", () => {
  it("动作收据带 delivery / receiver_focus / next_step", () => {
    const result = buildActionResult(
      {
        path: "ax_text",
        dispatchStatus: "sent",
        effect: "unverifiable",
        escalated: false,
        budget: "balanced",
        stateId: "s-1",
        index: 1,
        elementKind: "edit",
        elementName: "文本编辑器",
        receiverFocus: "unknown",
        availableSemantic: [],
        messages: [],
        elapsedMs: 1,
      },
      SDK_METHODS.TYPE,
    );
    const receipt = result.structuredContent?.action_receipt as Record<string, unknown>;
    expect(receipt.delivery).toBe("sent");
    expect(receipt.next_step).toBe("verify");
    expect(result.structuredContent?.receiver_focus).toBe("unknown");
  });

  it("错误分类带 next_step", () => {
    const stale = classifyError(Object.assign(new Error("stale stateId"), { code: "state_invalidated" }));
    expect(stale.code).toBe(DISPATCH_ERROR_CODES.STATE_INVALIDATED);
    expect(stale.nextStep).toBe("reobserve");

    const auth = classifyError(Object.assign(new Error("no"), { code: "authorization_required" }));
    expect(auth.nextStep).toBe("stop");
  });

  it("Helper 重启/清理映射为目标隔离/清理中", () => {
    const restart = classifyError(
      Object.assign(new Error("helper 重启失败"), {
        code: "helper_unavailable",
        detail: { reason: "restart" },
      }),
    );
    expect(restart.code).toBe(DISPATCH_ERROR_CODES.TARGET_QUARANTINED);
    expect(restart.nextStep).toBe("stop");

    const cleanup = classifyError(
      Object.assign(new Error("helper 清理中"), {
        code: "helper_unavailable",
        detail: { reason: "cleanup" },
      }),
    );
    expect(cleanup.code).toBe(DISPATCH_ERROR_CODES.CLEANUP_PENDING);
    expect(cleanup.nextStep).toBe("stop");
  });

  it("目标窗口已关闭映射为 cleanup_pending", () => {
    // 回归：窗口关闭后快照里的 HWND 变成悬空句柄。Helper 主动返回
    // window_closed，runtime 必须映射成 cleanup_pending，而不是
    // 让模型把「窗口没了」当成参数错误反复重试。
    const closed = classifyError(
      Object.assign(new Error("目标窗口已关闭（stateId=s-1）"), { code: "window_closed" }),
    );
    expect(closed.code).toBe(DISPATCH_ERROR_CODES.CLEANUP_PENDING);
    expect(closed.actionSent).toBe(false);
    expect(closed.nextStep).toBe("stop");
  });

  it("从 windowKey 解析窗口句柄", () => {
    // 用 windowKey 判定窗口存活，避免在窗口关闭后触碰失效的 COM 指针。
    expect(hwndFromWindowKey("hwnd-0x1a2b3c")).toBe(0x1a2b3cn);
    expect(hwndFromWindowKey("pid-1234:Notepad")).toBeUndefined();
    expect(hwndFromWindowKey(undefined)).toBeUndefined();
    expect(hwndFromWindowKey("hwnd-0xzz")).toBeUndefined();
  });
});

describe("快照容量", () => {
  it("超过历史上限时返回 evicted", () => {
    const store = new SnapshotStore();
    for (let i = 0; i < 8; i += 1) {
      expect(store.record("42.1", snapshot({ stateId: `s-${i}` })).evicted).toBe(false);
    }
    expect(store.record("42.1", snapshot({ stateId: "s-8" })).evicted).toBe(true);
  });
});

describe("坐标路由", () => {
  it("left_click 坐标目标把 coordinate 传给 Helper", async () => {
    const { client, calls } = fakeHelper({
      act: {
        path: "post_message",
        dispatchStatus: "sent",
        effect: "unverifiable",
        escalated: false,
        budget: "balanced",
        stateId: "s-1",
        index: 0,
        elementKind: "window",
        elementName: "Notepad",
        availableSemantic: [],
        messages: [],
        elapsedMs: 1,
      },
    });
    const rt = createComputerUseRuntime({ helperFactory: () => client });

    await rt.execute({
      toolName: "get_app_state",
      arguments: { app_ref: "1234", disable_diffing: true },
      context: ctx,
    });
    await rt.execute({
      toolName: "left_click",
      arguments: {
        target: { type: "coordinate", x: 10, y: 20 },
        app_ref: "1234",
        coordinate_space: { width: 1000, height: 1000 },
      },
      context: ctx,
    });

    const act = calls.find((c) => c.method === "act");
    expect(act?.params.coordinate).toEqual({ x: 10, y: 20 });
    expect(act?.params.coordinate_space).toEqual({ width: 1000, height: 1000 });
    expect(act?.params.stateId).toBe("s-1");

    await rt.dispose();
  });
});

describe("定向文本输入", () => {
  it("type 有元素目标时优先走 typeIntoElement", async () => {
    const { client, calls } = fakeHelper({
      typeIntoElement: {
        path: "ax_text",
        dispatchStatus: "sent",
        effect: "unverifiable",
        escalated: false,
        budget: "balanced",
        stateId: "s-1",
        index: 0,
        elementKind: "edit",
        elementName: "文本编辑器",
        receiverFocus: "unknown",
        availableSemantic: [],
        messages: [],
        elapsedMs: 1,
      },
    });
    const rt = createComputerUseRuntime({ helperFactory: () => client });

    await rt.execute({
      toolName: "get_app_state",
      arguments: { app_ref: "1234", disable_diffing: true },
      context: ctx,
    });
    const result = await rt.execute({
      toolName: "type",
      arguments: { target: { type: "element", index: 0 }, app_ref: "1234", text: "hello" },
      context: ctx,
    });

    expect(calls.some((c) => c.method === "typeIntoElement")).toBe(true);
    expect(calls.some((c) => c.method === "sendKey")).toBe(false);
    expect(result.structuredContent?.path).toBe("ax_text");

    await rt.dispose();
  });
});

describe("窗口恢复", () => {
  it("prepare 不需要授权，restore 需要 allowWindowRestore + unrestricted", async () => {
    const { client, calls } = fakeHelper({
      restoreWindow: (params: Record<string, unknown>) =>
        params.phase === "prepare"
          ? { ok: true, recovery_id: "r-1", message: "prepared" }
          : { ok: true, restored: true, foreground: true, message: "restored" },
    });
    const rt = createComputerUseRuntime({ helperFactory: () => client });

    const prepared = await rt.execute({
      toolName: "restore_window",
      arguments: { phase: "prepare", pid: 1234 },
      context: ctx,
    });
    expect(prepared.structuredContent?.recovery_id).toBe("r-1");

    const denied = await rt.execute({
      toolName: "restore_window",
      arguments: { phase: "restore", pid: 1234, recovery_id: "r-1", foreground: true },
      context: ctx,
    });
    expect(denied.structuredContent?.code).toBe("authorization_required");

    const restored = await rt.execute({
      toolName: "restore_window",
      arguments: { phase: "restore", pid: 1234, recovery_id: "r-1", foreground: true },
      context: { ...ctx, interferenceBudget: "unrestricted", allowWindowRestore: true },
    });
    expect(restored.structuredContent?.restored).toBe(true);
    expect(calls.filter((c) => c.method === "restoreWindow")).toHaveLength(2);

    await rt.dispose();
  });
});

describe("启动应用", () => {
  it("launch_app 返回 pid / dispatched", async () => {
    const { client } = fakeHelper({
      launchApp: {
        ok: true,
        pid: 4321,
        dispatched: true,
        mode: "spawn",
        message: "launched",
        elapsedMs: 1,
      },
    });
    const rt = createComputerUseRuntime({ helperFactory: () => client });

    const result = await rt.execute({
      toolName: "launch_app",
      arguments: { app: "notepad.exe" },
      context: ctx,
    });
    expect(result.structuredContent?.pid).toBe(4321);
    expect(result.structuredContent?.dispatched).toBe(true);

    await rt.dispose();
  });
});

describe("高风险确认", () => {
  it("requires_confirmation 先返回 confirmation_required，带 id 重试后执行", async () => {
    const { client, calls } = fakeHelper({
      act: {
        path: "post_message",
        dispatchStatus: "sent",
        effect: "unverifiable",
        escalated: false,
        budget: "balanced",
        stateId: "s-1",
        index: 0,
        elementKind: "window",
        elementName: "Notepad",
        availableSemantic: [],
        messages: [],
        elapsedMs: 1,
      },
    });
    const rt = createComputerUseRuntime({ helperFactory: () => client });

    await rt.execute({
      toolName: "get_app_state",
      arguments: { app_ref: "1234", disable_diffing: true },
      context: ctx,
    });

    const first = await rt.execute({
      toolName: "left_click",
      arguments: {
        target: { type: "element", index: 0 },
        app_ref: "1234",
        requires_confirmation: true,
        confirmation_summary: "删除这条记录",
      },
      context: ctx,
    });
    expect(first.structuredContent?.code).toBe("confirmation_required");
    const detail = first.structuredContent?.detail as Record<string, unknown> | undefined;
    const confirmationId = detail?.confirmation_id;
    expect(typeof confirmationId).toBe("string");
    expect(calls.some((c) => c.method === "act")).toBe(false);

    const second = await rt.execute({
      toolName: "left_click",
      arguments: {
        target: { type: "element", index: 0 },
        app_ref: "1234",
        requires_confirmation: true,
        confirmation_id: confirmationId,
      },
      context: ctx,
    });
    expect(second.structuredContent?.code).toBeUndefined();
    expect(calls.some((c) => c.method === "act")).toBe(true);

    await rt.dispose();
  });

  it("宿主 requestConfirmation 返回 false 时拒绝执行", async () => {
    const { client, calls } = fakeHelper({
      act: {
        path: "post_message",
        dispatchStatus: "sent",
        effect: "unverifiable",
        escalated: false,
        budget: "balanced",
        stateId: "s-1",
        index: 0,
        elementKind: "window",
        elementName: "Notepad",
        availableSemantic: [],
        messages: [],
        elapsedMs: 1,
      },
    });
    const rt = createComputerUseRuntime({
      helperFactory: () => client,
      requestConfirmation: async () => false,
    });

    await rt.execute({
      toolName: "get_app_state",
      arguments: { app_ref: "1234", disable_diffing: true },
      context: ctx,
    });
    const result = await rt.execute({
      toolName: "left_click",
      arguments: {
        target: { type: "element", index: 0 },
        app_ref: "1234",
        risk: "delete",
      },
      context: ctx,
    });
    expect(result.structuredContent?.code).toBe("confirmation_denied");
    expect(calls.some((c) => c.method === "act")).toBe(false);

    await rt.dispose();
  });

  it("宿主确认通道故障时退回 confirmation_required 两步协议", async () => {
    // 回归：客户端未声明 elicitation 能力时 server.request 会抛错。
    // 通道故障不能当成用户拒绝，否则模型会被告知「用户拒绝」而放弃动作。
    const { client, calls } = fakeHelper({
      act: {
        path: "post_message",
        dispatchStatus: "sent",
        effect: "unverifiable",
        escalated: false,
        budget: "balanced",
        stateId: "s-1",
        index: 0,
        elementKind: "window",
        elementName: "Notepad",
        availableSemantic: [],
        messages: [],
        elapsedMs: 1,
      },
    });
    const rt = createComputerUseRuntime({
      helperFactory: () => client,
      requestConfirmation: async () => {
        throw new Error("elicitation/create is not supported by this client");
      },
    });

    await rt.execute({
      toolName: "get_app_state",
      arguments: { app_ref: "1234", disable_diffing: true },
      context: ctx,
    });
    const result = await rt.execute({
      toolName: "left_click",
      arguments: {
        target: { type: "element", index: 0 },
        app_ref: "1234",
        risk: "delete",
      },
      context: ctx,
    });
    expect(result.structuredContent?.code).toBe("confirmation_required");
    expect(result.structuredContent?.detail).toMatchObject({
      confirmation_id: expect.any(String),
      risk: "delete",
    });
    expect(calls.some((c) => c.method === "act")).toBe(false);

    await rt.dispose();
  });
});
