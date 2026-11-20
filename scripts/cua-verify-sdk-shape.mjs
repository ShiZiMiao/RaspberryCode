/**
 * SDK 真实调用形状验证（最重要的一条）。
 *
 * 这个脚本存在的理由：早先的验证都用 `state_id` 显式传参，于是得到
 * 「14/14 通过」的错误结论——而 SDK **从不发送 state_id**，它发的是
 * `app_ref` + `target:{type:"element",index}`。真实链路下所有元素类动作
 * 都会报 `state_invalidated`，且 `app_ref` 常是 `{name}` / `{bundle_id}`
 * 对象而非字符串。
 *
 * 因此本脚本严格按 `computer-use-client.mjs` 的 `act()` 与 `observe()`
 * 生成参数，不额外补任何字段。这才能回答「用户真的能用吗」。
 *
 * 覆盖：
 *   1. `getApp(name)` → `app_ref: {name}` 观察
 *   2. `app_ref: {pid}` 观察
 *   3. 无 state_id 的动作（setValue / selectText / click / scroll）
 *   4. 跨应用隔离：观察 A 后操作 B，索引不能串
 *   5. app_ref 写错时给出可用窗口列表，而不是含糊报错
 */

import { execSync } from "node:child_process";

const root = process.cwd().replace(/\\/g, "/");
const dist = `${root}/packages/raspberrycode-cua/dist`;
const { createComputerUseRuntime } = await import(
  new URL(`file:///${dist}/runtime/index.js`).href
);

const rt = createComputerUseRuntime({
  env: {
    RASPBERRYCODE_CUA_HELPER_ENTRY: `${dist}/helper/windows-helper.js`,
    // 放开物理注入，让"能不能真的做到"不被预算门挡住
    RASPBERRYCODE_CUA_INTERFERENCE_BUDGET: "unrestricted",
    RASPBERRYCODE_CUA_ALLOW_PHYSICAL_INJECTION: "1",
  },
});
const ctx = { sessionId: "sdk-shape", runtimeScope: "main", workspaceKey: root };

const pid = Number.parseInt(
  execSync('tasklist /FI "IMAGENAME eq notepad.exe" /FO CSV /NH', { encoding: "utf8" })
    .split(",")[1]?.replace(/"/g, ""), 10,
);
if (!Number.isFinite(pid)) {
  // 无桌面环境（CI 容器、无交互会话）下这不是失败，而是「本机没法测」。
  // 用退出码 0 + 显式说明，避免把环境缺失误报成功能回归。
  // 参数形状的契约另有 test/sdk-shape.test.ts 覆盖，那个不依赖真实窗口。
  console.log("[SKIP] 未发现记事本窗口：本脚本必须在有桌面会话的环境中运行。");
  console.log("       参数形状契约由 packages/raspberrycode-cua/test/sdk-shape.test.ts 覆盖。");
  process.exit(0);
}

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${label}${detail ? `  ${detail}` : ""}`);
};

const run = (toolName, args) => rt.execute({ toolName, arguments: args, context: ctx });
const codeOf = (r) => r.structuredContent?.error_code ?? r.structuredContent?.code;

// ---- 1) {name} 形式观察 ----
console.log("\n--- 1. app_ref 对象形式 ---");
for (const [label, ref] of [
  ['{name:"Notepad"}', { name: "Notepad" }],
  [`{pid:${pid}}`, { pid }],
  [`"${pid}"`, String(pid)],
]) {
  const r = await run("get_app_state", { app_ref: ref, disable_diffing: true });
  const code = codeOf(r);
  check(`get_app_state(app_ref=${label})`, !code, code ?? `state=${r.structuredContent?.state_id}`);
}

// ---- 2) 无 state_id 的动作链（SDK 的真实形状）----
console.log("\n--- 2. 无 state_id 的动作链 ---");
const appRef = { name: "Notepad" };
const obs = await run("get_app_state", { app_ref: appRef, disable_diffing: true });
const sc = obs.structuredContent ?? {};
const edit = (sc.elements ?? []).find((e) => /edit|document/i.test(e.kind ?? ""));
check("观察拿到 edit 元素", Boolean(edit), `index=${edit?.index}`);

const tgt = { type: "element", index: edit?.index };

const w = await run("set_value", { target: tgt, app_ref: appRef, value: "HELLO-SDK" });
check("set_value（无 state_id）", !codeOf(w), codeOf(w) ?? w.structuredContent?.path);

const sel = await run("select_text", { target: tgt, app_ref: appRef, text_range: [0, 5] });
check(
  "select_text（无 state_id）",
  sel.structuredContent?.selection?.selected_text === "HELLO",
  JSON.stringify(sel.structuredContent?.selection ?? codeOf(sel)),
);

const ck = await run("left_click", {
  target: tgt, app_ref: appRef, mouse_button: "left", click_count: 1,
});
check("left_click（无 state_id）", !codeOf(ck), codeOf(ck) ?? ck.structuredContent?.path);

const scr = await run("scroll", {
  target: tgt, app_ref: appRef, scroll_direction: "down", scroll_amount: 1,
});
check("scroll（无 state_id）", !codeOf(scr), codeOf(scr) ?? scr.structuredContent?.path);

// ---- 3) 跨应用隔离 ----
console.log("\n--- 3. 跨应用隔离 ---");
const list = await run("list_windows", {});
const bar = (list.structuredContent?.windows ?? []).find((w2) => /任务栏|Taskbar/i.test(w2.title ?? ""));
if (bar) {
  const obs2 = await run("get_app_state", { app_ref: { pid: bar.process_id }, disable_diffing: true });
  const btn = (obs2.structuredContent?.elements ?? []).find((e) => e.kind === "button");
  const cross = await run("left_click", {
    target: { type: "element", index: btn?.index },
    app_ref: { pid: bar.process_id },
  });
  // 关键：不能因为「记事本刚观察过」就把 taskbar 的索引解析到记事本快照
  const resolvedOwnApp = !codeOf(cross);
  check("观察 A 后操作 B 不串快照", resolvedOwnApp, codeOf(cross) ?? cross.structuredContent?.path);
} else {
  console.log("[SKIP] 未找到任务栏窗口");
}

// ---- 4) 错误提示要可行动 ----
console.log("\n--- 4. 错误提示 ---");
const bad = await run("get_app_state", { app_ref: { name: "不存在的应用XYZ" }, disable_diffing: true });
const badText = (bad.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join(" ");
check(
  "找不到应用时列出可用窗口",
  /Notepad|窗口/.test(badText),
  badText.replace(/\s+/g, " ").slice(0, 110),
);

await rt.dispose();
console.log(`\n=== ${failures === 0 ? "全部通过" : `${failures} 项失败`} ===`);
process.exit(failures === 0 ? 0 : 1);
