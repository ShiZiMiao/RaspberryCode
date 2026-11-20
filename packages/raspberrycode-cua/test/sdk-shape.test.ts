/**
 * SDK 参数形状契约测试。
 *
 * ## 这个测试防的是什么
 *
 * 2026-11-19 的一次真实失误：CUA 的所有验证脚本都手动传了 `state_id`，
 * 于是得到「14/14 通过」的结论——而 SDK **从不发送 `state_id`**，
 * 它发的是 `app_ref` + `target:{type:"element",index}`。真实链路下所有
 * 元素类动作全部报 `state_invalidated`，等于功能完全不可用。
 *
 * 这类缺陷的共同点是：**测试自己补了参数，于是测的不是真实路径**。
 * 单元测试挡不住「验证脚本写错」，但可以钉住「我们接受哪些参数形状」，
 * 让偏离契约的改动在 CI 里立刻失败。
 *
 * ## 为什么不用真实窗口
 *
 * CI 无桌面环境。这里用假 Helper 客户端注入，只验证 runtime 侧的
 * 参数解析与路由决定，不碰任何系统调用。
 */

import { describe, expect, it } from "vitest";
import { createComputerUseRuntime } from "../src/runtime/index.js";
import type { CuaHelperClient } from "../src/runtime/helper-client.js";

/** 构造只记录调用、返回固定结果的假 Helper。 */
function fakeHelper(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const record = (method: string) => (params: Record<string, unknown>) => {
    calls.push({ method, params });
    const override = overrides[method];
    if (typeof override === "function") return Promise.resolve(override(params));
    return Promise.resolve(
      override ?? {
        text: "tree",
        stateId: "s-1",
        windowTitle: "Notepad",
        processId: 1234,
        frameworkId: "Win32",
        windowKey: "42.1",
        nodeCount: 1,
        truncated: false,
        mode: "full",
        brittleTree: false,
        elapsedMs: 1,
        elements: [
          {
            index: 0,
            kind: "document",
            name: "文本编辑器",
            value: "hello",
            states: [],
            bounds: { left: 0, top: 0, width: 10, height: 10 },
            actions: ["click", "set_value"],
          },
        ],
      },
    );
  };

  return {
    calls,
    client: {
      ensureReady: () => Promise.resolve(),
      ping: () => Promise.resolve({ sessionId: 6 }),
      listWindows: () => Promise.resolve({ windows: [], elapsedMs: 1 }),
      capture: record("capture"),
      act: record("act"),
      sendKey: record("sendKey"),
      sendScroll: record("sendScroll"),
      drag: record("drag"),
      selectText: record("selectText"),
      screenshot: () => Promise.resolve({ base64: "", mime_type: "image/png", width: 1, height: 1, byte_length: 0 }),
      stop: () => Promise.resolve(),
    } as unknown as CuaHelperClient,
  };
}

const ctx = { sessionId: "t", runtimeScope: "main" as const, workspaceKey: "ws" };

describe("SDK 参数形状", () => {
  it("动作不带 state_id 时，按 app_ref 解析到该应用最近一次观察", async () => {
    const { client, calls } = fakeHelper();
    const rt = createComputerUseRuntime({ helperFactory: () => client });

    // 观察：SDK 用 app_ref 绑定应用
    const obs = await rt.execute({
      toolName: "get_app_state",
      arguments: { app_ref: "1234", disable_diffing: true },
      context: ctx,
    });
    expect(obs.structuredContent?.state_id).toBe("s-1");

    // 动作：**故意不传 state_id**（SDK 的真实形状）
    const click = await rt.execute({
      toolName: "left_click",
      arguments: { target: { type: "element", index: 0 }, app_ref: "1234", mouse_button: "left", click_count: 1 },
      context: ctx,
    });

    expect(click.structuredContent?.code).toBeUndefined();
    const actCall = calls.find((c) => c.method === "act");
    // 关键断言：runtime 把 app_ref 解析成了 stateId 传给 Helper
    expect(actCall?.params.stateId).toBe("s-1");
    expect(actCall?.params.index).toBe(0);

    await rt.dispose();
  });

  it("app_ref 为 {pid} 对象时也能解析", async () => {
    const { client, calls } = fakeHelper();
    const rt = createComputerUseRuntime({ helperFactory: () => client });

    await rt.execute({
      toolName: "get_app_state",
      arguments: { app_ref: { pid: 1234 }, disable_diffing: true },
      context: ctx,
    });
    const capture = calls.find((c) => c.method === "capture");
    expect(capture?.params.processId).toBe(1234);

    await rt.execute({
      toolName: "set_value",
      arguments: { target: { type: "element", index: 0 }, app_ref: { pid: 1234 }, value: "x" },
      context: ctx,
    });
    expect(calls.find((c) => c.method === "act")?.params.stateId).toBe("s-1");

    await rt.dispose();
  });

  it("app_ref 为 {name} 对象时按应用名交给 Helper 匹配", async () => {
    const { client, calls } = fakeHelper();
    const rt = createComputerUseRuntime({ helperFactory: () => client });

    await rt.execute({
      toolName: "get_app_state",
      arguments: { app_ref: { name: "Notepad" }, disable_diffing: true },
      context: ctx,
    });
    const capture = calls.find((c) => c.method === "capture");
    expect(capture?.params.appName).toBe("Notepad");

    await rt.dispose();
  });

  it("完全没有观察过的应用，动作报可解释的错而不是崩溃", async () => {
    const { client } = fakeHelper();
    const rt = createComputerUseRuntime({ helperFactory: () => client });

    const r = await rt.execute({
      toolName: "left_click",
      arguments: { target: { type: "element", index: 0 }, app_ref: "9999" },
      context: ctx,
    });
    expect(r.structuredContent?.code).toBe("state_invalidated");
    expect(JSON.stringify(r.content)).toContain("9999");

    await rt.dispose();
  });

  it("text_range 被转成 Helper 的 start/length", async () => {
    const { client, calls } = fakeHelper({ selectText: { path: "ax", dispatchStatus: "sent", effect: "unverifiable", activatesWindow: true, grabInput: false, semanticAction: "select_text", selection: { start: 2, length: 3, selectedText: "llo", documentLength: 5 }, elapsedMs: 1 } });
    const rt = createComputerUseRuntime({ helperFactory: () => client });

    await rt.execute({
      toolName: "get_app_state",
      arguments: { app_ref: "1234", disable_diffing: true },
      context: ctx,
    });
    await rt.execute({
      toolName: "select_text",
      arguments: { target: { type: "element", index: 0 }, app_ref: "1234", text_range: [2, 3] },
      context: ctx,
    });

    const sel = calls.find((c) => c.method === "selectText");
    expect(sel?.params.start).toBe(2);
    expect(sel?.params.length).toBe(3);

    await rt.dispose();
  });
});

describe("预算解析优先级", () => {
  it("context 的预算优先于环境变量", async () => {
    const { client, calls } = fakeHelper();
    const rt = createComputerUseRuntime({
      helperFactory: () => client,
      env: { RASPBERRYCODE_CUA_INTERFERENCE_BUDGET: "quiet" },
    });

    await rt.execute({
      toolName: "get_app_state",
      arguments: { app_ref: "1234", disable_diffing: true },
      context: { ...ctx, interferenceBudget: "unrestricted", allowPhysicalInjection: true },
    });
    await rt.execute({
      toolName: "left_click",
      arguments: { target: { type: "element", index: 0 }, app_ref: "1234" },
      context: { ...ctx, interferenceBudget: "unrestricted", allowPhysicalInjection: true },
    });

    const act = calls.find((c) => c.method === "act");
    expect(act?.params.budget).toBe("unrestricted");
    expect(act?.params.allowPhysicalInjection).toBe(true);

    await rt.dispose();
  });

  it("context 未给预算时用环境变量", async () => {
    const { client, calls } = fakeHelper();
    const rt = createComputerUseRuntime({
      helperFactory: () => client,
      env: {
        RASPBERRYCODE_CUA_INTERFERENCE_BUDGET: "unrestricted",
        RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION: "1",
      },
    });

    await rt.execute({
      toolName: "get_app_state",
      arguments: { app_ref: "1234", disable_diffing: true },
      context: ctx,
    });
    await rt.execute({
      toolName: "type",
      arguments: { text: "x", app_ref: "1234" },
      context: ctx,
    });

    const key = calls.find((c) => c.method === "sendKey");
    // 环境变量放开了物理注入，所以 type 不会被拒
    expect(key).toBeDefined();

    await rt.dispose();
  });

  it("两处都没给时 default 为 balanced 且拒绝物理注入", async () => {
    const { client } = fakeHelper();
    const rt = createComputerUseRuntime({ helperFactory: () => client, env: {} });

    const r = await rt.execute({
      toolName: "type",
      arguments: { text: "x", app_ref: "1234" },
      context: ctx,
    });
    expect(r.structuredContent?.code).toBe("foreground_required");

    await rt.dispose();
  });

  it("环境变量拼错时回落默认，不被当成 unrestricted", async () => {
    const { client } = fakeHelper();
    const rt = createComputerUseRuntime({
      helperFactory: () => client,
      env: { RASPBERRYCODE_CUA_INTERFERENCE_BUDGET: "unrestrictd", RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION: "yes-please" },
    });

    const r = await rt.execute({
      toolName: "type",
      arguments: { text: "x", app_ref: "1234" },
      context: ctx,
    });
    // 拼错 → 回落 balanced + 未授权 → 必须拒绝
    expect(r.structuredContent?.code).toBe("foreground_required");

    await rt.dispose();
  });
});
