/**
 * 14 个 SDK 方法的最终实现状态核验（真实调用，非读代码）。
 *
 * **参数形状严格按 SDK 真实发送的内容**：不带 `state_id`，只带
 * `app_ref` + `target:{type:"element", index}`。这是最容易验证错的地方——
 * 早先版本手动传了 `state_id`，于是绕过了「SDK 根本不传它」这个事实，
 * 得出「14/14 通过」的错误结论；实际真实链路下所有元素类动作都会
 * 报 state_invalidated。见 handlers.ts 的 ensureObservation 注释。
 *
 * 两轮对照：
 *   A. 宿主真实 context（无预算字段）→ 反映「用户不开设置时」的能力
 *   B. 开物理注入授权后 → 反映「用户打开设置后」的能力
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

const hostCtx = {
  sessionId: "final-check",
  runtimeScope: "main",
  workspaceKey: root,
  workspacePath: root,
  clientMode: "desktop-continuous",
  deliveryKind: "desktop-continuous",
};

function classify(r) {
  const s = r.structuredContent ?? {};
  const code = s.error_code ?? s.code;
  const text = (r.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join(" ");
  if (!code) return { kind: "ok", code: "", text };
  if (code === "unsupported_platform") return { kind: "unsupported", code, text };
  if (code === "foreground_required" || code === "authorization_required") return { kind: "gated", code, text };
  return { kind: "error", code, text };
}

async function sweep(label, env) {
  const rt = createComputerUseRuntime({
    env: { RASPBERRYCODE_CUA_HELPER_ENTRY: `${dist}/helper/windows-helper.js`, ...env },
  });

  const seedObs = await rt.execute({
    toolName: "get_app_state",
    arguments: { app_ref: String(pid), disable_diffing: true },
    context: hostCtx,
  });
  const seedSc = seedObs.structuredContent ?? {};
  const edit0 = (seedSc.elements ?? []).find((e) => /edit|document/i.test(e.kind ?? ""));
  const seedWrite = await rt.execute({
    toolName: "set_value",
    arguments: { target: { type: "element", index: edit0?.index }, app_ref: String(pid), value: "ABCDE hello world" },
    context: hostCtx,
  });
  if (seedWrite.structuredContent?.error_code) {
    throw new Error(`种子写入失败: ${seedWrite.structuredContent.error_code}`);
  }

  const obs = await rt.execute({
    toolName: "get_app_state",
    arguments: { app_ref: String(pid), disable_diffing: true },
    context: hostCtx,
  });
  const sc = obs.structuredContent ?? {};
  const elements = sc.elements ?? [];
  const edit = elements.find((e) => /edit|document/i.test(e.kind ?? ""));
  const btn = elements.find((e) => e.kind === "button");
  const text = edit?.value ?? "";
  const helloAt = text.indexOf("hello");
  const selStart = helloAt >= 0 ? helloAt : 0;
  const selLen = Math.min(5, Math.max(0, text.length - selStart));

  // === SDK 真实参数形状：无 state_id，只有 app_ref + target ===
  const appRef = String(pid);
  const tgt = (i) => ({ type: "element", index: i });

  const cases = [
    ["list_apps", {}],
    ["list_windows", {}],
    ["get_app_state", { app_ref: appRef }],
    ["left_click", { target: tgt(edit?.index), app_ref: appRef, mouse_button: "left", click_count: 1 }],
    ["scroll", { target: tgt(edit?.index), app_ref: appRef, scroll_direction: "down", scroll_amount: 1 }],
    ["select_text", { target: tgt(edit?.index), app_ref: appRef, text_range: [selStart, selLen] }],
    ["set_value", { target: tgt(edit?.index), app_ref: appRef, value: "SEED" }],
    ["left_click_drag", { from_target: tgt(edit?.index), to_target: tgt(edit?.index), app_ref: appRef }],
    ["type", { text: "x", app_ref: appRef }],
    ["key", { text: "ctrl+a", app_ref: appRef }],
    ["perform_action", { target: tgt(btn?.index), app_ref: appRef, action: "click" }],
    ["paste", { text: "p", app_ref: appRef }],
    ["request_access", {}],
    ["stop_computer_control", {}],
  ];

  const results = [];
  console.log(`\n===== ${label} =====`);
  for (const [name, args] of cases) {
    let out;
    try {
      const r = await rt.execute({ toolName: name, arguments: args, context: hostCtx });
      out = classify(r);
    } catch (e) {
      out = { kind: "throw", code: "?", text: String(e?.message ?? e) };
    }
    results.push({ name, ...out });
    const mark = out.kind === "ok" ? "ok        " : out.kind === "gated" ? "gated     " : out.kind.padEnd(10);
    console.log(`  ${mark} ${name.padEnd(22)} ${out.code.padEnd(22)} ${out.text.replace(/\s+/g, " ").slice(0, 90)}`);
  }

  await rt.dispose();
  return results;
}

const a = await sweep("A. 宿主现状（未开物理注入）", {});
const b = await sweep("B. 用户已开启物理注入", {
  RASPBERRYCODE_CUA_INTERFERENCE_BUDGET: "unrestricted",
  RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION: "1",
});

console.log("\n===== 14 个方法总表 =====");
console.log("方法".padEnd(24) + "A(未开)".padEnd(14) + "B(已开)");
for (let i = 0; i < a.length; i++) {
  console.log(
    a[i].name.padEnd(24) + a[i].kind.padEnd(14) + b[i].kind,
  );
}

const bOk = b.filter((r) => r.kind === "ok").length;
const bFail = b.filter((r) => r.kind !== "ok");
console.log(`\nB 轮成功: ${bOk}/14`);
if (bFail.length) {
  console.log("仍不成功的方法:");
  for (const f of bFail) console.log(`  - ${f.name} [${f.code}] ${f.text.replace(/\s+/g, " ").slice(0, 160)}`);
}
