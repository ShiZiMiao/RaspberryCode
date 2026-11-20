/**
 * 安装包版 CUA 端到端验证。
 *
 * 与 `cua-verify-e2e-real.mjs` 的区别：那个脚本验的是**仓库源码构建**，
 * 本脚本验的是 `C:\Users\...\Programs\RaspberryCode\resources\agent` 里
 * **真实安装后的资产**。两者必须都过，否则「源码能跑、装完不能跑」会漏到用户手里。
 *
 * 链路：外部 MCP client → 安装目录的 node-repl-host/dist/mcp/server.js
 *      → Worker 里 bootstrap 安装目录的 computer-use-client.mjs
 *      → 真实 Helper（安装目录的 koffi）→ 真实记事本。
 *
 * 用法：
 *   node scripts/cua-verify-installed.mjs
 *   RASPBERRYCODE_INSTALL_ROOT=... node scripts/cua-verify-installed.mjs
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const INSTALL_ROOT =
  process.env.RASPBERRYCODE_INSTALL_ROOT ??
  join(process.env.LOCALAPPDATA ?? "", "Programs", "RaspberryCode");
const agentRoot = join(INSTALL_ROOT, "resources", "agent");
const hostEntry = join(agentRoot, "packages", "node-repl-host", "dist", "mcp", "server.js");
const pluginRoot = join(agentRoot, "packages", "raspberrycode-cua-plugin");

let pass = 0;
let fail = 0;
const results = [];
function check(label, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        ${String(detail).slice(0, 600)}` : ""}`);
  }
  results.push({ label, ok, detail: ok ? undefined : String(detail).slice(0, 2000) });
}

console.log("=== 安装包版 CUA 端到端 ===\n");
console.log(`安装根: ${INSTALL_ROOT}`);
console.log(`host:   ${hostEntry}`);
console.log(`plugin: ${pluginRoot}\n`);

// ---------- 0) 资产存在性 ----------
console.log("--- 0. 安装资产存在性 ---");
check("安装目录 host server.js 存在", existsSync(hostEntry), hostEntry);
check(
  "安装目录 computer-use-client.mjs 存在",
  existsSync(join(pluginRoot, "scripts", "computer-use-client.mjs")),
);
const koffiNode = join(
  pluginRoot,
  "node_modules",
  "koffi",
  "build",
  "koffi",
  "win32_x64",
  "koffi.node",
);
check("安装目录 koffi.node 存在", existsSync(koffiNode), koffiNode);

if (!existsSync(hostEntry) || !existsSync(join(pluginRoot, "scripts", "computer-use-client.mjs"))) {
  console.error("\n关键资产缺失，无法继续。");
  process.exit(1);
}

// ---------- 连 host ----------
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [hostEntry],
  env: {
    ...process.env,
    RASPBERRYCODE_CUA_PLUGIN_ROOT: pluginRoot,
    // Helper 入口：安装包里的自研 CUA Helper 是独立子进程入口。
    // 生产侧应由 desktop 注入同一路径（见本脚本头部注释）。
    RASPBERRYCODE_CUA_HELPER_ENTRY: join(
      agentRoot,
      "packages",
      "raspberrycode-cua",
      "dist",
      "helper",
      "windows-helper.js",
    ),
    // 授权到 unrestricted：本次要验键盘类方法也能用（顺带验证 env 穿透）
    RASPBERRYCODE_CUA_INTERFERENCE_BUDGET: "unrestricted",
    RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION: "1",
  },
  stderr: "pipe",
});

const stderrChunks = [];
transport.stderr?.on("data", (c) => stderrChunks.push(String(c)));

const client = new Client(
  { name: "cua-installed-verify", version: "1.0.0" },
  {
    capabilities: {},
    versionNegotiation: { mode: { pin: "2026-07-28" } },
  },
);

const sessionId = `installed-verify-${Date.now()}`;
// 必须是 `com.raspberrycode/request-context` 包一层，且带 workspace 字段。
// 直接平铺 session_id 会报 "node_repl CUA request is missing session_id metadata"。
const meta = (sid) => ({
  "com.raspberrycode/request-context": {
    session_id: sid,
    workspace_key: INSTALL_ROOT.replace(/\\/g, "/"),
    workspace_path: INSTALL_ROOT.replace(/\\/g, "/"),
    runtime_scope: "main",
    client_mode: "desktop-continuous",
    delivery_kind: "desktop-continuous",
  },
});

async function runJs(code) {
  const r = await client.callTool({
    name: "js",
    arguments: { code },
    _meta: meta(sessionId),
  });
  const text = (r.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return { isError: r.isError === true, text, structured: r.structuredContent };
}

const BOOT = `
const root = process.env.RASPBERRYCODE_CUA_PLUGIN_ROOT;
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const { setupComputerUseRuntime } = await import(
  pathToFileURL(join(root, "scripts", "computer-use-client.mjs")).href
);
await setupComputerUseRuntime({ globals: globalThis });
`;

try {
  await client.connect(transport);
  console.log("\n--- 1. 连接安装目录的 host（modern era 握手）---");
  check("MCP 握手成功", true);

  // ---------- 2) bootstrap ----------
  console.log("\n--- 2. 沙箱内 bootstrap 安装目录的 client ---");
  const probe = await runJs(`
${BOOT}
return JSON.stringify({
  hasComputerUse: Boolean(agent?.computerUse),
  methodCount: Object.keys(agent?.computerUse?.computer ?? {}).filter(k => k !== "target").length,
});
`);
  const pj = (() => {
    try {
      return JSON.parse(probe.text.match(/\{.*\}/s)?.[0] ?? "{}");
    } catch {
      return {};
    }
  })();
  check("setup 后存在 agent.computerUse", pj.hasComputerUse === true, probe.text);
  check("方法数 >= 10", (pj.methodCount ?? 0) >= 10, `methodCount=${pj.methodCount}`);

  // ---------- 3) list_windows：真实 Helper + 真实 koffi ----------
  console.log("\n--- 3. list_windows（真实 Helper / 真实 koffi）---");
  const lw = await runJs(`
${BOOT}
const r = await agent.computerUse.computer.list_windows({});
return JSON.stringify(r).slice(0, 4000);
`);
  check("list_windows 无错误", lw.isError !== true, lw.text);
  // 返回结构：{ method, window_count, elapsed_ms, windows: [...] }
  // 注意 CUA 走结构化通道，cell 文本常为 "(no output)" —— 不能只判文本。
  const windowCount = lw.structured?.window_count ?? 0;
  const windows = lw.structured?.windows ?? [];
  check(
    "list_windows 返回非空窗口列表",
    Array.isArray(windows) && windows.length > 0 && windowCount > 0,
    `window_count=${windowCount}, len=${windows.length}`,
  );

  // ---------- 4) 真实记事本 set_value ----------
  console.log("\n--- 4. 记事本 set_value（真实写入并从 OS 读回）---");
  const marker = `INSTALLED-${Date.now().toString(36).toUpperCase()}`;
  const txtPath = join(tmpdir(), `cua-installed-${Date.now()}.txt`);
  writeFileSync(txtPath, "", "utf8");

  const { execSync } = await import("node:child_process");
  try {
    execSync(`start "" notepad.exe "${txtPath}"`, { stdio: "ignore", shell: true });
  } catch {
    /* start 有时返回非 0，不影响 */
  }
  await new Promise((r) => setTimeout(r, 2500));

  const setv = await runJs(`
${BOOT}
// 观察记事本，拿到真实元素表后再挑可写的元素（不写死下标）。
const obs = await agent.computerUse.computer.get_app_state({ app_ref: { name: "Notepad" } });
const sc = obs?.structuredContent ?? obs;
const stateId = sc?.state_id;
const els = Array.isArray(sc?.elements) ? sc.elements : [];
if (!stateId) return JSON.stringify({ step: "observe", failed: true, keys: Object.keys(sc ?? {}), raw: String(obs?.content?.[0]?.text ?? "").slice(0, 800) }).slice(0, 3000);

// 选第一个声明支持 set_value 的元素；没有就退回 index 与数组下标一致的可编辑项。
const target = els.find(e => Array.isArray(e?.actions) && e.actions.includes("set_value"))
            ?? els.find(e => e?.role === "document" || e?.kind === "document")
            ?? els.find(e => typeof e?.index === "number");
const idx = target?.index;
if (typeof idx !== "number") return JSON.stringify({ step: "pick", failed: true, count: els.length, sample: els.slice(0, 6) }).slice(0, 3000);

const act = await agent.computerUse.computer.set_value({
  app_ref: { name: "Notepad" },
  target: { type: "element", index: idx },
  value: ${JSON.stringify(marker)},
});
return JSON.stringify({ step: "set_value", stateId, idx, role: target?.role, kind: target?.kind, act: act?.structuredContent ?? act }).slice(0, 4000);
`);
  check("get_app_state + set_value 流程无错误", setv.isError !== true, setv.text);

  // 从 OS 侧独立读回文件内容（不信 Agent 自己的回执）
  await new Promise((r) => setTimeout(r, 1200));
  let fileContent = "";
  try {
    const { readFileSync } = await import("node:fs");
    fileContent = readFileSync(txtPath, "utf8");
  } catch {
    /* ignore */
  }
  check(
    `从磁盘读回写入内容（=${marker}）`,
    fileContent.includes(marker),
    `实际内容: ${JSON.stringify(fileContent.slice(0, 200))}`,
  );

  try {
    execSync("taskkill /IM notepad.exe /F", { stdio: "ignore", shell: true });
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(txtPath);
  } catch {
    /* ignore */
  }

  await client.close();
} catch (error) {
  check("端到端流程未抛异常", false, error?.stack ?? String(error));
  try {
    await client.close();
  } catch {
    /* ignore */
  }
} finally {
  if (stderrChunks.length) {
    const joined = stderrChunks.join("");
    const interesting = joined
      .split("\n")
      .filter((l) => /error|fail|cannot|MODULE_NOT_FOUND|koffi/i.test(l))
      .slice(0, 10);
    if (interesting.length) {
      console.log("\n--- host stderr（过滤后）---");
      for (const l of interesting) console.log(`  ${l.slice(0, 300)}`);
    }
  }
}

console.log(`\n=== 结果：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
