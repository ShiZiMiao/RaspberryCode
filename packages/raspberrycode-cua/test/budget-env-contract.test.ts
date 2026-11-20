/**
 * 预算/授权的环境变量契约。
 *
 * ## 这个契约连接哪两端
 *
 * ```
 * desktop main（设置快照）          CUA runtime（解析 env）
 *   ↓ 拼进 fork env                   ↓ budgetFromEnv / allowPhysicalFromEnv
 *   RASPBERRYCODE_CUA_INTERFERENCE_BUDGET = "unrestricted"
 *   RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION = "1"
 * ```
 *
 * 两端必须对「发什么 / 认什么」达成一致。断掉的症状是：用户打开开关、重启应用，
 * 键盘输入仍被拒绝，且没有任何报错——runtime 只是拿到了默认值，
 * 它没有理由认为自己被配置错了。
 *
 * ## 为什么测在 CUA 包里而不是 desktop 包
 *
 * 这两个环境变量的**权威定义在这里**（常量 + 解析器都在本包）。
 * 按仓库规范，App 业务单测已退役、测试清单显式维护；CUA 是明确保留的测试归属，
 * 且这里有独立执行入口（`pnpm --filter @raspberrycode/raspberrycode-cua test`）。
 * 把「开发端发什么、消费端认什么」钉在定义侧，比钉在某个调用方更稳。
 *
 * desktop 侧「把回调结果拼进 fork env」的行为由
 * `scripts/cua-verify-e2e-real.mjs`（真实链路）兜底，不在单测里重复。
 */

import { describe, expect, it } from "vitest";
import { createComputerUseRuntime } from "../src/runtime/index.js";
import type { CuaHelperClient } from "../src/runtime/helper-client.js";

const BUDGET_ENV = "RASPBERRYCODE_CUA_INTERFERENCE_BUDGET";
const ALLOW_ENV = "RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION";

/**
 * 假 Helper：记录调用参数、返回固定的观察结果。
 *
 * 不碰任何系统调用，因此可在无桌面的 CI 里运行。
 */
function fakeHelper() {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const record = (method: string) => (params: Record<string, unknown>) => {
    calls.push({ method, params });
    return Promise.resolve({
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
    });
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
      screenshot: () =>
        Promise.resolve({ base64: "", mime_type: "image/png", width: 1, height: 1, byte_length: 0 }),
      stop: () => Promise.resolve(),
    } as unknown as CuaHelperClient,
  };
}

const ctx = { sessionId: "t", runtimeScope: "main" as const, workspaceKey: "ws" };

/** 用给定 env 建一个 runtime，并跑一次 type（物理注入类动作）看是否被预算门拦。 */
async function typeUnderEnv(env: Record<string, string>) {
  const { client, calls } = fakeHelper();
  const rt = createComputerUseRuntime({ helperFactory: () => client, env });

  await rt.execute({
    toolName: "get_app_state",
    arguments: { app_ref: "1234", disable_diffing: true },
    context: ctx,
  });
  const result = await rt.execute({
    toolName: "type",
    arguments: { text: "x", app_ref: "1234" },
    context: ctx,
  });
  await rt.dispose();

  return {
    code: result.structuredContent?.code as string | undefined,
    reachedKey: calls.some((c) => c.method === "sendKey"),
  };
}

describe("预算环境变量的取值契约", () => {
  it("unrestricted + 1 时物理注入被放行", async () => {
    const out = await typeUnderEnv({ [BUDGET_ENV]: "unrestricted", [ALLOW_ENV]: "1" });
    expect(out.code).toBeUndefined();
    expect(out.reachedKey).toBe(true);
  });

  it("balanced 时物理注入被拒（默认档位，用户没开设置）", async () => {
    const out = await typeUnderEnv({ [BUDGET_ENV]: "balanced", [ALLOW_ENV]: "1" });
    expect(out.code).toBe("foreground_required");
    expect(out.reachedKey).toBe(false);
  });

  it("quiet 时同样被拒（更保守的档位不应更宽松）", async () => {
    const out = await typeUnderEnv({ [BUDGET_ENV]: "quiet", [ALLOW_ENV]: "1" });
    expect(out.code).toBe("foreground_required");
    expect(out.reachedKey).toBe(false);
  });

  it("unrestricted 但未授权时仍被拒（两个条件必须同时满足）", async () => {
    // 这是安全边界的核心：预算是「允许打扰到什么程度」，
    // 授权是「我是否接受被抢键鼠」，两者是与门，不能任一单独放开。
    //
    // 注意错误码是 authorization_required 而非 foreground_required：
    // 前者告诉模型「去找用户开授权」，后者说的是「预算不够」。
    // 报错码不同，模型该采取的下一步也不同，不能混。
    const out = await typeUnderEnv({ [BUDGET_ENV]: "unrestricted", [ALLOW_ENV]: "0" });
    expect(out.code).toBe("authorization_required");
    expect(out.reachedKey).toBe(false);
  });

  it("两个变量都不设时走最保守默认", async () => {
    const out = await typeUnderEnv({});
    expect(out.code).toBe("foreground_required");
    expect(out.reachedKey).toBe(false);
  });
});

describe("取值写法的容错契约", () => {
  it("预算值拼错时回落默认，不被当成 unrestricted", async () => {
    // 拼错一个环境变量名不该让整个电脑控制不可用，
    // 但更不能把安全边界交给一个 typo。
    const out = await typeUnderEnv({ [BUDGET_ENV]: "unrestrictd", [ALLOW_ENV]: "1" });
    expect(out.code).toBe("foreground_required");
    expect(out.reachedKey).toBe(false);
  });

  it("预算值大小写与空白不影响识别", async () => {
    const out = await typeUnderEnv({ [BUDGET_ENV]: "  UNRESTRICTED  ", [ALLOW_ENV]: "1" });
    expect(out.code).toBeUndefined();
    expect(out.reachedKey).toBe(true);
  });

  it("授权值接受多种肯定写法（desktop 只发 1，但手写 env 可能用 true/on）", async () => {
    for (const value of ["1", "true", "yes", "on", "TRUE"]) {
      const out = await typeUnderEnv({ [BUDGET_ENV]: "unrestricted", [ALLOW_ENV]: value });
      expect(out.code, `ALLOW=${value} 应被识别为已授权`).toBeUndefined();
      expect(out.reachedKey, `ALLOW=${value} 应放行`).toBe(true);
    }
  });

  it("授权值接受多种否定写法，且都等价于未授权", async () => {
    for (const value of ["0", "false", "no", "off"]) {
      const out = await typeUnderEnv({ [BUDGET_ENV]: "unrestricted", [ALLOW_ENV]: value });
      expect(out.code, `ALLOW=${value} 应视为未授权`).toBe("authorization_required");
      expect(out.reachedKey).toBe(false);
    }
  });

  it("授权值无法识别时按未授权处理（只认显式肯定）", async () => {
    // 安全方向：宁可拒绝。若把乱码当成 true，用户会莫名其妙被抢键鼠。
    const out = await typeUnderEnv({ [BUDGET_ENV]: "unrestricted", [ALLOW_ENV]: "maybe" });
    expect(out.code).toBe("authorization_required");
    expect(out.reachedKey).toBe(false);
  });
});

describe("会话上下文的优先级高于环境变量", () => {
  it("context 给 balanced 时压过 env 的 unrestricted", async () => {
    const { client, calls } = fakeHelper();
    const rt = createComputerUseRuntime({
      helperFactory: () => client,
      env: { [BUDGET_ENV]: "unrestricted", [ALLOW_ENV]: "1" },
    });

    const perRequest = { ...ctx, interferenceBudget: "balanced" as const };
    await rt.execute({
      toolName: "get_app_state",
      arguments: { app_ref: "1234", disable_diffing: true },
      context: perRequest,
    });
    const result = await rt.execute({
      toolName: "type",
      arguments: { text: "x", app_ref: "1234" },
      context: perRequest,
    });
    await rt.dispose();

    expect(result.structuredContent?.code).toBe("foreground_required");
    expect(calls.some((c) => c.method === "sendKey")).toBe(false);
  });});
