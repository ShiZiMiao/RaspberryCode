/**
 * 预算/授权环境变量的真实穿透链验证。
 *
 * ## 为什么必须单独验这个
 *
 * 前面所有验证都在**同一个进程**里 `createComputerUseRuntime({env:{...}})`，
 * 直接注入了变量。但真实链路是：
 *
 *   main → (fork, env 下发) → host → (spawn) → agent → (stdio MCP) → node-repl-host → runtime
 *
 * 中间任何一环过滤或覆盖，设置就会失效——而现象是「用户开了开关但键盘还是不能用」，
 * 且完全没有报错线索。这条链**不能被「读代码觉得没问题」替代**。
 *
 * ## 怎么验
 *
 * 用一条真实的父子进程链复刻每一跳：每跳都把 `process.env` 原样传给下一跳
 * （与 `buildMcpStdioEnv` / `workerEnvironment` 的行为一致），最后在末端
 * 读 runtime 解析出的预算。同时检查 `sanitizeRaspberryCodeRuntimeEnv`
 * 是否会把这两个键剔掉——那是链上唯一会主动删键的地方。
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd().replace(/\\/g, "/");

// 子进程脚本写到临时文件：`node -e` 在当前沙箱下 spawn 会 EPERM。
const workDir = mkdtempSync(join(tmpdir(), "cua-env-chain-"));
const hopPath = join(workDir, "hop.mjs");
writeFileSync(
  hopPath,
  `
const dist = ${JSON.stringify(`${root}/packages/raspberrycode-cua/dist`)};
const hop = process.argv[2];

if (hop === "1") {
  // 复刻 host → agent：把 process.env 原样传给下一跳
  const { spawn } = await import("node:child_process");
  const c = spawn(process.execPath, [process.argv[1], "2"], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  c.stdout.on("data", (d) => process.stdout.write(d));
  c.stderr.on("data", (d) => process.stderr.write(d));
  c.on("exit", (code) => process.exit(code ?? 0));
} else {
  // 末端：复刻 workerEnvironment() —— {...process.env} 后删两个 browser broker 键
  const env = { ...process.env };
  delete env.RASPBERRYCODE_NODE_REPL_BROWSER_BROKER_SOCKET;
  delete env.RASPBERRYCODE_NODE_REPL_BROWSER_BROKER_TOKEN;

  const { createComputerUseRuntime } = await import(\`file:///\${dist}/runtime/index.js\`);
  const rt = createComputerUseRuntime({ env });
  const { execSync } = await import("node:child_process");
  let pid = NaN;
  try {
    pid = Number.parseInt(
      execSync('tasklist /FI "IMAGENAME eq notepad.exe" /FO CSV /NH', { encoding: "utf8" })
        .split(",")[1]?.replace(/"/g, ""),
      10,
    );
  } catch {}
  const ctx = { sessionId: "chain", runtimeScope: "main", workspaceKey: ${JSON.stringify(root)} };
  const envInProcess = {
    budget: process.env.RASPBERRYCODE_CUA_INTERFERENCE_BUDGET ?? null,
    allow: process.env.RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION ?? null,
  };
  if (Number.isFinite(pid)) {
    const r = await rt.execute({ toolName: "type", arguments: { text: "x", app_ref: String(pid) }, context: ctx });
    const s = r.structuredContent ?? {};
    const code = s.error_code ?? s.code;
    console.log(JSON.stringify({
      reached: true,
      budgetSeen: code === "foreground_required" || code === "authorization_required" ? "gated" : (code ? code : "allowed"),
      envInProcess,
    }));
  } else {
    console.log(JSON.stringify({ reached: true, budgetSeen: "no-notepad", envInProcess }));
  }
  await rt.dispose();
}
`,
  "utf8",
);

// ---- 1) 先单测消毒函数不会剔除这两个键 ----
console.log("--- 1. 环境消毒是否保留这两个键 ---");
const shared = await import(
  new URL(`file:///${root}/packages/shared/dist/runtimeEnv.js`).href
).catch(() => undefined);
if (shared?.sanitizeRaspberryCodeRuntimeEnv) {
  const probe = {
    RASPBERRYCODE_CUA_INTERFERENCE_BUDGET: "unrestricted",
    RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION: "1",
    NODE_ENV: "production",
  };
  const out = shared.sanitizeRaspberryCodeRuntimeEnv({ ...probe });
  const keptBudget = out.RASPBERRYCODE_CUA_INTERFERENCE_BUDGET === "unrestricted";
  const keptAllow = out.RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION === "1";
  const droppedNodeEnv = out.NODE_ENV === undefined;
  console.log(`  budget 保留: ${keptBudget ? "是" : "否"}`);
  console.log(`  allow 保留: ${keptAllow ? "是" : "否"}`);
  console.log(`  对照组 NODE_ENV 被剔除: ${droppedNodeEnv ? "是（消毒函数确实在工作）" : "否（消毒函数未生效，结论不可信）"}`);
  if (!keptBudget || !keptAllow) {
    console.log("  >>> 结论：这两个键会被剔除，必须加入放行清单");
  }
} else {
  console.log("  [SKIP] shared/dist 未构建，跳过");
}

// ---- 2) 真实父子进程链 ----
console.log("\n--- 2. 父子进程链穿透（复刻 host→agent→node-repl）---");
function runChain(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [hopPath, "1"], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("exit", () => resolve(out.trim()));
  });
}

const gated = await runChain({});
console.log(`  A 不设变量: ${gated.split("\n").pop()}`);

const allowed = await runChain({
  RASPBERRYCODE_CUA_INTERFERENCE_BUDGET: "unrestricted",
  RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION: "1",
});
console.log(`  B 设变量:   ${allowed.split("\n").pop()}`);

const parse = (s) => {
  try {
    return JSON.parse(s.split("\n").filter((l) => l.startsWith("{")).pop() ?? "{}");
  } catch {
    return {};
  }
};
const a = parse(gated);
const b = parse(allowed);

console.log("\n--- 判定 ---");
const pass =
  a.envInProcess?.budget === null &&
  a.budgetSeen === "gated" &&
  b.envInProcess?.budget === "unrestricted" &&
  b.budgetSeen === "allowed";
console.log(`A 未设变量 → 应 gated，实际 ${a.budgetSeen}`);
console.log(`B 设变量   → 应 allowed，实际 ${b.budgetSeen}`);
console.log(`B 末端进程确实收到变量: ${b.envInProcess?.budget === "unrestricted" ? "是" : "否"}`);
console.log(pass ? "✅ 变量能穿透两跳并改变实际行为" : "❌ 链路上有断裂");
