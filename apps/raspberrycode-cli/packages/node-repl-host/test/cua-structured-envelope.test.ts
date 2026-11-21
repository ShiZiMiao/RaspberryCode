import { describe, expect, it, vi } from "vitest";

/**
 * bound API 的结构化保真（2026-11-21 外部真机报告驱动）。
 *
 * 两个缺陷都表现为「拿不到结构化数据，只能拿渲染文本」，但根因不同：
 *
 * 1. `unwrapEnvelope` 在 text 不是 JSON 时无条件 `return text`，把
 *    `structuredContent` 整份丢掉。观察类工具（`list_windows`）的 content
 *    本来就是给人看的渲染行，结构化数据只在 structuredContent 里，于是
 *    `window_id` 永远取不到，调用方只能改用 pid 绑定绕过。
 *
 * 2. `inventory` 只看 `parsed.apps` 与裸数组。而 Windows 自研 helper 上
 *    `list_apps` 复用 `handleListWindows`，结构化数据在
 *    `structuredContent.windows`，**没有 apps 字段**，于是 `listApps()` 恒返回 []。
 *    九月修过一次同类问题（裸数组 vs parseJsonRecord），那次只解决了「解析器
 *    认不认数组」，没解决「字段名根本不同」。
 */

async function makeHarness(callImpl: (method: string, args: unknown) => unknown) {
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const clientUrl = fileURLToPath(
    new URL("../../raspberrycode-cua-plugin/scripts/computer-use-client.mjs", import.meta.url),
  );
  const documentationRoot = join(dirname(clientUrl), "..", "docs");
  const bridge = {
    call: vi.fn(async (method: string, args: unknown) => callImpl(method, args)),
    assertAvailable: () => {},
    documentationRoot,
  };
  const globals: Record<PropertyKey, unknown> = {
    [Symbol.for("raspberrycode.node-repl.computer-use-bridge")]: bridge,
    nodeRepl: { write: () => {} },
  };
  const mod = await import(clientUrl);
  await mod.setupComputerUseRuntime({ globals });
  return { globals: globals as { agent: { computerUse: any } }, bridge };
}

/** 复刻 handleListWindows 的真实返回形态：文本 + structuredContent.windows。 */
const listWindowsResult = {
  content: [
    {
      type: "text",
      text: 'Top-level windows (2, 43ms):\n1234 [Win32] "记事本" 800x600@0,0\n5678 [Win32] "资源管理器" 1024x768@100,100',
    },
  ],
  structuredContent: {
    method: "list_windows",
    window_count: 2,
    elapsed_ms: 43,
    windows: [
      {
        process_id: 1234,
        title: "记事本",
        class_name: "Notepad",
        framework: "Win32",
        bounds: { left: 0, top: 0, width: 800, height: 600 },
        app_ref: "1234",
      },
      {
        process_id: 5678,
        title: "资源管理器",
        class_name: "CabinetWClass",
        framework: "Win32",
        bounds: { left: 100, top: 100, width: 1024, height: 768 },
        app_ref: "5678",
      },
    ],
  },
};

describe("bound API keeps structured data", () => {
  it("list_windows returns the structured object, not the rendered text", async () => {
    const { globals } = await makeHarness(() => listWindowsResult);
    const result = await globals.agent.computerUse.computer.list_windows({});

    // 关键断言：拿到的是对象而不是字符串，且带 windows 数组。
    expect(typeof result).toBe("object");
    expect(result).not.toBeNull();
    expect(Array.isArray(result.windows)).toBe(true);
    expect(result.windows).toHaveLength(2);

    // window_id / bounds 这类只存在于 structuredContent 的字段必须可达。
    expect(result.windows[0].process_id).toBe(1234);
    expect(result.windows[0].title).toBe("记事本");
    expect(result.windows[0].bounds.width).toBe(800);
  });

  it("falls back to the text when a tool has no structuredContent", async () => {
    // buildTextResult(text) 不传第二参时没有 structuredContent；
    // 这时必须仍返回文本，不能变成 undefined。
    const { globals } = await makeHarness(() => ({
      content: [{ type: "text", text: "plain observation text" }],
    }));
    const result = await globals.agent.computerUse.computer.list_windows({});
    expect(result).toBe("plain observation text");
  });

  it("still parses a JSON text envelope into a bare value", async () => {
    // 原有行为不能回退：JSON 文本仍解封成裸值。
    const { globals } = await makeHarness(() => ({
      content: [{ type: "text", text: '{"ready":true}' }],
    }));
    const result = await globals.agent.computerUse.computer.request_access({});
    expect(result).toEqual({ ready: true });
  });
});

describe("listApps reads windows when apps is absent", () => {
  it("maps structuredContent.windows into apps", async () => {
    const { globals } = await makeHarness((method) =>
      method === "list_apps" ? listWindowsResult : { content: [{ type: "text", text: "ok" }] },
    );
    const apps = await globals.agent.computerUse.listApps({ emit: false });

    expect(Array.isArray(apps)).toBe(true);
    expect(apps).toHaveLength(2);
    expect(apps[0]).toMatchObject({ name: "记事本", pid: 1234 });
    expect(apps[1]).toMatchObject({ name: "资源管理器", pid: 5678 });
  });

  it("keeps using apps when the envelope really carries them", async () => {
    // 有 apps 字段时不能被 windows 覆盖，否则是另一种回归。
    const { globals } = await makeHarness(() => ({
      content: [{ type: "text", text: JSON.stringify({ apps: [{ name: "Safari", pid: 9 }] }) }],
    }));
    const apps = await globals.agent.computerUse.listApps({ emit: false });
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ name: "Safari", pid: 9 });
  });

  it("returns an empty array rather than throwing when there is nothing", async () => {
    const { globals } = await makeHarness(() => ({
      content: [{ type: "text", text: "Top-level windows (0, 5ms):" }],
      structuredContent: { window_count: 0, windows: [] },
    }));
    const apps = await globals.agent.computerUse.listApps({ emit: false });
    expect(apps).toEqual([]);
  });
});
