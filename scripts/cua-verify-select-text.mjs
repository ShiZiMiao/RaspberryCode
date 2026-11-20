/**
 * select_text 端到端验证（真实记事本）。
 *
 * 按用户的真实路径走：观察 → 拿到元素索引与 value → 请求选中其中一段文本
 * → 再从系统读回真实选区比对。
 *
 * 同时验证三件事：
 *   1. 正常选区成功，且选中的正好是请求的那段。
 *   2. 越界（start+length > 文档长度）被明确拒绝，不静默夹取。
 *   3. 不支持 TextPattern 的目标给出可执行的替代建议，而不是含糊的「不支持」。
 */

const root = process.cwd().replace(/\\/g, "/");
const dist = `${root}/packages/raspberrycode-cua/dist`;
const { createComputerUseRuntime } = await import(
  new URL(`file:///${dist}/runtime/index.js`).href
);
const { execSync } = await import("node:child_process");

const rt = createComputerUseRuntime({
  env: { RASPBERRYCODE_CUA_HELPER_ENTRY: `${dist}/helper/windows-helper.js` },
});
const ctx = { sessionId: "sel-e2e", runtimeScope: "main", workspaceKey: root };

const pid = Number.parseInt(
  execSync('tasklist /FI "IMAGENAME eq notepad.exe" /FO CSV /NH', { encoding: "utf8" })
    .split(",")[1]
    ?.replace(/"/g, ""),
  10,
);
console.log("记事本 pid =", pid);

const obs = await rt.execute({
  toolName: "get_app_state",
  arguments: { app_ref: String(pid), disable_diffing: true },
  context: ctx,
});
const sc = obs.structuredContent ?? {};
let elements = sc.elements ?? [];
const edit = elements.find((e) => /edit|document/i.test(e.kind ?? ""));
const stateId = sc.state_id;
console.log(`观察: state=${stateId} 目标 index=${edit?.index} value=${JSON.stringify(edit?.value)}`);

const text = edit?.value ?? "";
const target = text.indexOf("hello");
console.log(`要在 value 里定位 "hello" → 偏移 ${target}\n`);

const show = (label, r) => {
  const s = r.structuredContent ?? {};
  const code = s.error_code ?? s.code;
  const body = (r.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join(" ");
  console.log(`[${code ? "FAIL:" + code : "ok"}] ${label}`);
  console.log(`   ${body.replace(/\s+/g, " ").slice(0, 220)}`);
  return s;
};

// ---- 1) 正常选区 ----
if (target >= 0) {
  const r1 = await rt.execute({
    toolName: "select_text",
    arguments: { state_id: stateId, target: edit.index, text_range: [target, 5] },
    context: ctx,
  });
  const s1 = show("选中 \"hello\"（偏移 " + target + ", 长度 5）", r1);
  const sel = s1.selection;
  const pass1 = sel?.selected_text === "hello";
  console.log(`   → 系统读回选区 = ${JSON.stringify(sel?.selected_text)}  ${pass1 ? "✓ 与请求一致" : "✗ 不一致"}`);
}

// ---- 2) 越界拒绝 ----
const r2 = await rt.execute({
  toolName: "select_text",
  arguments: { state_id: stateId, target: edit.index, text_range: [0, text.length + 100] },
  context: ctx,
});
show(`越界请求 [0, ${text.length + 100})（文档长 ${text.length}）`, r2);

// ---- 3) 缺少 text_range ----
const r3 = await rt.execute({
  toolName: "select_text",
  arguments: { state_id: stateId, target: edit.index },
  context: ctx,
});
show("缺少 text_range", r3);

// ---- 4) 不支持 TextPattern 的目标（任务栏按钮）----
const list = await rt.execute({ toolName: "list_windows", arguments: {}, context: ctx });
const other = (list.structuredContent?.windows ?? []).find((w) => /任务栏|Taskbar/i.test(w.title ?? ""));
if (other) {
  const obs2 = await rt.execute({
    toolName: "get_app_state",
    arguments: { app_ref: String(other.process_id), disable_diffing: true },
    context: ctx,
  });
  const els = obs2.structuredContent?.elements ?? [];
  const btn = els.find((e) => e.kind === "button");
  if (btn) {
    const r4 = await rt.execute({
      toolName: "select_text",
      arguments: { state_id: obs2.structuredContent.state_id, target: btn.index, text_range: [0, 3] },
      context: ctx,
    });
    show(`对不支持 TextPattern 的元素（${btn.kind} "${btn.name}") 选文本`, r4);
  }
}

await rt.dispose();
