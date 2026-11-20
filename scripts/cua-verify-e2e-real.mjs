/**
 * 真实端到端：外部 MCP 客户端 → 独立 node-repl-host 子进程 → 真实 CUA Helper → 真实记事本。
 *
 * ## 与之前所有验证的区别
 *
 * 之前的脚本都是 `import { createComputerUseRuntime }` 直连，等价于「在 runtime 里测 runtime」。
 * 本脚本走完整的生产链路：
 *
 *   本进程（MCP client）
 *     → stdio → **独立子进程** `node-repl-host/dist/mcp/server.js`
 *       → `captureComputerUseRuntimeFromEnvironment()` 读 env
 *         → JS Worker 里 `setupComputerUseRuntime({globals})` 挂出 agent.computerUse
 *           → 真实 CUA Helper 子进程（koffi 直调 Win32）
 *             → 真实记事本窗口
 *
 * 这条链上任何一环断掉（koffi 没进 bundle、env 没穿透、setup 缺失、
 * bridge 没挂上、MCP 工具没注册），本脚本都会失败——直连测试全都发现不了。
 *
 * ## 两个必须知道的坑（都是实测踩出来的）
 *
 * 1. **每个 js cell 都是全新 Worker**：`agent.computerUse` 不是预置的，
 *    必须在**同一个 cell 内**先动态 import `computer-use-client.mjs`
 *    再 `setupComputerUseRuntime({globals: globalThis})`。见 SKILL.md 的 Bootstrap。
 *
 * 2. **CUA 的结果走结构化通道**：SDK 的 `projectToHost` 会把结果交给
 *    `nodeRepl.emitStructuredResult`，于是 cell 的**文本**可能只是 `(no output)`。
 *    判断成败要看 `structuredContent` 与树文本，不能只看 content 里的第一段文字。
 *    早期我按文本判断，误以为「静默失败」，其实是结果被搬到了结构化通道。
 *
 * ## 用法
 *
 * 需先在有桌面会话的环境启动记事本。无记事本时跳过（退出码 0）。
 */

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().replace(/\\/g, "/");
const hostEntry = `${root}/apps/raspberrycode-cli/packages/node-repl-host/dist/mcp/server.js`;
const cuaDist = `${root}/packages/raspberrycode-cua/dist`;

/**
 * 找 CUA 插件的 `computer-use-client.mjs`。
 *
 * `bundled-agents/<platform>/agent/packages/raspberrycode-cua-plugin` 是**构建产物**，
 * 会被清理或只构建了部分平台（实测出现过 win32-x64 目录空着、win32-arm64 有内容）。
 * 写死一个平台会得到 `Cannot find module`，而那看起来像功能坏了、其实是脚本找不到文件。
 * 所以按顺序探：当前平台 → 其它已构建平台 → 仓库源码目录。
 */
function findPluginRoot() {
  const candidates = [
    `${root}/packages/desktop/bundled-agents/win32-x64/agent/packages/raspberrycode-cua-plugin`,
    `${root}/packages/desktop/bundled-agents/win32-arm64/agent/packages/raspberrycode-cua-plugin`,
    `${root}/packages/desktop/bundled-agents/darwin-arm64/agent/packages/raspberrycode-cua-plugin`,
    `${root}/packages/desktop/bundled-agents/darwin-x64/agent/packages/raspberrycode-cua-plugin`,
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "scripts", "computer-use-client.mjs"))) return candidate;
  }
  return undefined;
}

const pluginRoot = findPluginRoot();
if (!pluginRoot) {
  console.log("[SKIP] 找不到 CUA 插件的 computer-use-client.mjs（bundled-agents 未构建）");
  console.log("       先跑 pnpm dev:desktop 或构建插件资产后再试。");
  process.exit(0);
}
console.log(`插件根目录：${pluginRoot.replace(root, ".")}`);

if (!existsSync(hostEntry)) {
  console.log(`[SKIP] 未找到 host 产物：${hostEntry}\n       先跑 pnpm --filter @raspberrycode/node-repl-host build`);
  process.exit(0);
}

const pid = Number.parseInt(
  execSync('tasklist /FI "IMAGENAME eq notepad.exe" /FO CSV /NH', { encoding: "utf8" })
    .split(",")[1]?.replace(/"/g, ""), 10,
);
if (!Number.isFinite(pid)) {
  console.log("[SKIP] 未发现记事本窗口（本脚本需在有桌面会话的环境中运行）");
  console.log("       无桌面时的参数契约由 packages/raspberrycode-cua/test/sdk-shape.test.ts 覆盖。");
  process.exit(0);
}
console.log(`目标应用：记事本 pid=${pid}\n`);

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  const body = detail === undefined ? "" : `\n         ${String(detail).replace(/\s+/g, " ").slice(0, 240)}`;
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${label}${body}`);
};

const meta = (sessionId) => ({
  "com.raspberrycode/request-context": {
    session_id: sessionId,
    workspace_key: root,
    workspace_path: root,
    runtime_scope: "main",
    client_mode: "desktop-continuous",
    delivery_kind: "desktop-continuous",
  },
});

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [hostEntry],
  env: {
    ...process.env,
    RASPBERRYCODE_CUA_HELPER_ENTRY: `${cuaDist}/helper/windows-helper.js`,
    RASPBERRYCODE_CUA_PLUGIN_ROOT: pluginRoot,
    // 物理注入授权：端到端要验键盘类方法真的可用（也顺带验证 env 穿透到 host 子进程）
    RASPBERRYCODE_CUA_INTERFERENCE_BUDGET: "unrestricted",
    RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION: "1",
  },
  stderr: "pipe",
});

// host 用 `legacy: "reject"` 启动，只接受 modern era（2026-07-28+）的
// `server/discover` 握手。生产里的 plugin host 也是这么连的
// （见 bundle-smoke.test.ts 的 `versionNegotiation: { mode: { pin: "2026-07-28" } }`）。
const client = new Client(
  { name: "e2e-real", version: "0.0.1" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);

let hostStderr = "";
transport.stderr?.on("data", (d) => {
  hostStderr += d.toString();
});

console.log("--- 启动 host 子进程并完成 MCP 握手 ---");
try {
  await client.connect(transport);
  check("MCP 握手成功", true, client.getServerVersion()?.name);
  check("协商到 modern 协议版本", client.getNegotiatedProtocolVersion?.() === "2026-07-28", client.getNegotiatedProtocolVersion?.());
} catch (error) {
  check("MCP 握手成功", false, error instanceof Error ? error.message : String(error));
  console.log(`host stderr:\n${hostStderr.slice(0, 2000)}`);
  process.exit(1);
}

const tools = await client.listTools();
const toolNames = (tools.tools ?? []).map((t) => t.name);
check("node_repl 注册了 js 工具", toolNames.includes("js"), toolNames.join(","));

/**
 * 在 host 的 JS 沙箱里执行代码。
 *
 * 返回值同时给出文本与结构化内容：CUA 的结果会被 `projectToHost`
 * 搬到结构化通道，只读文本会误判成空。
 */
async function runJs(code, sessionId = "e2e-real") {
  const r = await client.callTool({
    name: "js",
    arguments: { code, title: "端到端验证" },
    _meta: meta(sessionId),
  });
  const text = (r.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return { isError: r.isError === true, text, structured: r.structuredContent };
}

/** 照 SKILL.md：每个 cell 内先 bootstrap，再操作。 */
const BOOT = `
const root = process.env.RASPBERRYCODE_CUA_PLUGIN_ROOT;
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const { setupComputerUseRuntime } = await import(
  pathToFileURL(join(root, "scripts", "computer-use-client.mjs")).href
);
await setupComputerUseRuntime({ globals: globalThis });
`;

// ---- 1) bootstrap ----
console.log("\n--- 1. JS 沙箱内的 CUA bootstrap（真实 Worker）---");
const probe = await runJs(`
${BOOT}
return JSON.stringify({
  hasComputerUse: Boolean(agent?.computerUse),
  hasComputer: Boolean(agent?.computerUse?.computer),
  sampleMethods: Object.keys(agent?.computerUse?.computer ?? {}).filter((k) => k !== "target").slice(0, 5),
});
`);
const probeJson = (() => {
  try {
    return JSON.parse(probe.text.match(/\{.*\}/s)?.[0] ?? "{}");
  } catch {
    return {};
  }
})();
check("setup 后沙箱内存在 agent.computerUse", probeJson.hasComputerUse === true, probe.text);

// ---- 2) list_windows：真实 Helper 子进程 ----
console.log("\n--- 2. list_windows（真实 Helper）---");
const list = await runJs(`
${BOOT}
await agent.computerUse.computer.list_windows({});
return "done";
`);
const listCount = list.structured?.window_count;
check(
  "list_windows 枚举到窗口（结构化通道）",
  typeof listCount === "number" && listCount > 0,
  `window_count=${listCount} structured.text=${String(list.structured?.text ?? "").slice(0, 160)}`,
);
check(
  "枚举结果里包含记事本",
  /Notepad|记事本/i.test(JSON.stringify(list.structured ?? {})),
  JSON.stringify(list.structured?.windows ?? []).slice(0, 200),
);

// ---- 3) getApp(name) + getAXState ----
console.log("\n--- 3. getApp(\"Notepad\") + getAXState ---");
const state = await runJs(`
${BOOT}
const app = await agent.computerUse.getApp("Notepad");
return await app.getAXState({ disableDiffing: true });
`);
check(
  "按应用名绑定并拿到无障碍树",
  /document|edit|文本编辑器/i.test(state.text),
  state.text.slice(0, 200),
);
check(
  "结构化结果含 state_id / app / window / elements",
  Boolean(
    state.structured?.state_id &&
      state.structured?.app?.process_id &&
      state.structured?.window?.key &&
      (Array.isArray(state.structured?.elements) || typeof state.structured?.element_count === "number"),
  ),
  JSON.stringify({
    state_id: state.structured?.state_id,
    app_pid: state.structured?.app?.process_id,
    window_key: state.structured?.window?.key,
    elements: Array.isArray(state.structured?.elements)
      ? state.structured.elements.length
      : state.structured?.element_count,
  }),
);

// ---- 4) setValue：真实写入 ----
console.log("\n--- 4. setValue（真实写入记事本）---");
const marker = `E2E-${Date.now().toString(36).toUpperCase()}`;
const setv = await runJs(`
${BOOT}
const app = await agent.computerUse.getApp("Notepad");
await app.getAXState({ disableDiffing: true });
const els = await app.elements();
const edit = els.find((e) => /edit|document/i.test(e.kind ?? ""));
await app.setValue(edit.index, ${JSON.stringify(marker)});
return "done";
`);
check("setValue 未报错", !setv.isError, setv.text.slice(0, 200));

// ---- 5) 从系统读回 ----
console.log("\n--- 5. 从系统读回验证（真的写进去了吗）---");
const readback = await runJs(`
${BOOT}
const app = await agent.computerUse.getApp("Notepad");
return await app.getAXState({ disableDiffing: true });
`);
check("无障碍树里读到了写入值", readback.text.includes(marker), readback.text.slice(0, 200));

// 第二重：从 OS 侧读窗口标题（记事本标题 = 文档名，未保存时带 *）
const title = execSync(
  `powershell -NoProfile -Command "(Get-Process -Id ${pid}).MainWindowTitle"`,
  { encoding: "utf8" },
).trim();
check("窗口标题反映新内容（OS 侧独立验证）", title.includes(marker), `title="${title}"`);

// ---- 6) selectText：新实现的 TextPattern 在真实链路上 ----
console.log("\n--- 6. selectText（TextPattern 真实链路）---");
// 选区必须选**当前存在**的文本。上一轮 setValue 已把内容换成 marker，
// 所以这里选 marker 的前 4 个字符，而不是写死的 "E2E"。
const sel = await runJs(`
${BOOT}
const app = await agent.computerUse.getApp("Notepad");
await app.getAXState({ disableDiffing: true });
const els = await app.elements();
const edit = els.find((e) => /edit|document/i.test(e.kind ?? ""));
const value = String(edit.value ?? "");
if (value.length < 4) throw new Error("文档太短，无法验证选区：" + JSON.stringify(value));
await app.selectText(edit.index, value.slice(0, 4));
return "selected " + JSON.stringify(value.slice(0, 4));
`);
check("selectText 成功（不再是 unsupported_platform）", !sel.isError, sel.text.slice(0, 280));

// ---- 7) 键盘输入（验证 env 穿透到 host 子进程）----
console.log("\n--- 7. typeText（物理注入，验证 env 真的穿透）---");
const typed = await runJs(`
${BOOT}
const app = await agent.computerUse.getApp("Notepad");
await app.getAXState({ disableDiffing: true });
await app.typeText("-T");
return "done";
`);
check("typeText 未被预算门拒绝（env 穿透成功）", !typed.isError, typed.text.slice(0, 260));

// ---- 收尾 ----
await client.close();
console.log(`\n=== ${failures === 0 ? "真实端到端全部通过" : `${failures} 项失败`} ===`);
if (failures > 0) {
  console.log(`\nhost stderr（末尾 3000 字）:\n${hostStderr.slice(-3000)}`);
}
process.exit(failures === 0 ? 0 : 1);
