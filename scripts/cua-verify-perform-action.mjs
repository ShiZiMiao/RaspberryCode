/**
 * perform_action 修复验证。
 *
 * 三条路径都必须正确：
 *   1. 动作名合法且元素声明了 → 真的走语义动作（回执 semantic 非空，非 post_message）
 *   2. 动作名非法/元素没声明 → 明确报错并列出可用动作（不再静默落到 post_message）
 *   3. 动作名合法但元素没声明 → 同样明确报错
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
const rt = createComputerUseRuntime({
  env: { RASPBERRYCODE_CUA_HELPER_ENTRY: `${dist}/helper/windows-helper.js` },
});
const ctx = { sessionId: "pa", runtimeScope: "main", workspaceKey: root };

const obs = await rt.execute({
  toolName: "get_app_state",
  arguments: { app_ref: String(pid), disable_diffing: true },
  context: ctx,
});
const sc = obs.structuredContent ?? {};
const els = sc.elements ?? [];
const stateId = sc.state_id;

// 找一个声明了动作的元素
const withAction = els.find((e) => (e.actions ?? []).length > 0);
const noAction = els.find((e) => (e.actions ?? []).length === 0 && e.bounds);
console.log(`状态 ${stateId}`);
console.log(`有动作的元素: index=${withAction?.index} kind=${withAction?.kind} actions=${JSON.stringify(withAction?.actions)}`);
console.log(`无动作的元素: index=${noAction?.index} kind=${noAction?.kind}\n`);

const show = async (label, args) => {
  const r = await rt.execute({ toolName: "perform_action", arguments: args, context: ctx });
  const s = r.structuredContent ?? {};
  const code = s.error_code ?? s.code;
  const text = (r.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join(" ").replace(/\s+/g, " ");
  console.log(`[${code ?? "ok"}] ${label}`);
  console.log(`    path=${s.path ?? "-"} semantic=${s.semantic_action ?? "(空)"}`);
  console.log(`    ${text.slice(0, 200)}`);
  return s;
};

// 1) 合法动作名
if (withAction) {
  await show(`① 合法动作 "${withAction.actions[0]}" 用在声明了它的元素上`, {
    state_id: stateId, target: withAction.index, action: withAction.actions[0],
  });
}

// 2) 非法动作名（就是此前造成静默降级的典型误用）
if (withAction) {
  await show(`② 非法动作 "click"（UIA 无此动作名）`, {
    state_id: stateId, target: withAction.index, action: "click",
  });
}

// 3) 合法名字但该元素没声明
if (noAction) {
  await show(`③ 合法动作 "toggle" 用在没有动作的元素上`, {
    state_id: stateId, target: noAction.index, action: "toggle",
  });
}

await rt.dispose();
