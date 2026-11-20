/**
 * 验证预算注入：环境变量 → runtime → 4 个受门控方法是否真的可用。
 *
 * 对照组：
 *   A. 不设环境变量（当前宿主真实情况）→ type/key/paste/drag 应被拒
 *   B. 设 RASPBERRYCODE_CUA_INTERFERENCE_BUDGET=unrestricted
 *      + RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION=1 → 应可用
 *
 * 每步都从**系统读回结果**验证真的生效，而不是只看回执里的 dispatch_status。
 */

import { execSync } from "node:child_process";

const root = process.cwd().replace(/\\/g, "/");
const dist = `${root}/packages/raspberrycode-cua/dist`;
const { createComputerUseRuntime } = await import(
  new URL(`file:///${dist}/runtime/index.js`).href
);

const pid = Number.parseInt(
  execSync('tasklist /FI "IMAGENAME eq notepad.exe" /FO CSV /NH', { encoding: "utf8" })
    .split(",")[1]?.replace(/"/g, ""), 10,
);

/** 与宿主 cua-broker.ts 的 requestContext() 完全一致的形状（无预算字段）。 */
const hostCtx = {
  sessionId: "budget-probe",
  runtimeScope: "main",
  workspaceKey: root,
  workspacePath: root,
  clientMode: "desktop-continuous",
  deliveryKind: "desktop-continuous",
};

async function run(label, env) {
  const rt = createComputerUseRuntime({
    env: { RASPBERRYCODE_CUA_HELPER_ENTRY: `${dist}/helper/windows-helper.js`, ...env },
  });

  const obs = await rt.execute({
    toolName: "get_app_state",
    arguments: { app_ref: String(pid), disable_diffing: true },
    context: hostCtx,
  });
  const sc = obs.structuredContent ?? {};
  const edit = (sc.elements ?? []).find((e) => /edit|document/i.test(e.kind ?? ""));
  const stateId = sc.state_id;

  const out = {};
  for (const [name, args] of [
    ["type", { text: "-T", state_id: stateId }],
    ["key", { text: "ctrl+a", state_id: stateId }],
    ["paste", { text: "-P" }],
    ["left_click_drag", { state_id: stateId, from_target: edit?.index, to_target: edit?.index }],
  ]) {
    const r = await rt.execute({ toolName: name, arguments: args, context: hostCtx });
    const s = r.structuredContent ?? {};
    const code = s.error_code ?? s.code;
    out[name] = { ok: !code, code: code ?? null, path: s.path ?? null };
  }

  // 读回真实内容
  const after = await rt.execute({
    toolName: "get_app_state",
    arguments: { app_ref: String(pid), disable_diffing: true },
    context: hostCtx,
  });
  const editAfter = (after.structuredContent?.elements ?? []).find((e) => e.index === edit?.index);

  console.log(`\n=== ${label} ===`);
  for (const [k, v] of Object.entries(out)) {
    console.log(`  ${k.padEnd(16)} ${v.ok ? "ok  " : "拒绝"}  ${v.code ?? v.path ?? ""}`);
  }
  console.log(`  文档内容 = ${JSON.stringify(editAfter?.value)}`);
  await rt.dispose();
  return { out, value: editAfter?.value };
}

// A：宿主真实环境（不设变量）
const a = await run("A. 未设环境变量（宿主现状）", {});

// 重置内容，便于观察 B 的写入效果
const reset = createComputerUseRuntime({
  env: { RASPBERRYCODE_CUA_HELPER_ENTRY: `${dist}/helper/windows-helper.js` },
});
{
  const o = await reset.execute({
    toolName: "get_app_state",
    arguments: { app_ref: String(pid), disable_diffing: true },
    context: hostCtx,
  });
  const s = o.structuredContent ?? {};
  const ed = (s.elements ?? []).find((e) => /edit|document/i.test(e.kind ?? ""));
  await reset.execute({
    toolName: "set_value",
    arguments: { state_id: s.state_id, target: ed?.index, value: "RESET" },
    context: hostCtx,
  });
}
await reset.dispose();

// B：设了环境变量
const b = await run("B. BUDGET=unrestricted + ALLOW_PHYSICAL=1", {
  RASPBERRYCODE_CUA_INTERFERENCE_BUDGET: "unrestricted",
  RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION: "1",
});

console.log("\n=== 结论 ===");
const aBlocked = Object.values(a.out).every((v) => !v.ok);
const bWorks = Object.values(b.out).every((v) => v.ok);
console.log(`A 全部被拒（默认安全）: ${aBlocked ? "✓" : "✗"}`);
console.log(`B 全部可用（注入生效）: ${bWorks ? "✓" : "✗"}`);
console.log(`B 实际改写了文档（系统读回 ${JSON.stringify(b.value)}）: ${b.value !== "RESET" ? "✓" : "✗"}`);
