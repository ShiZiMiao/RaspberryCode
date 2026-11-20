/**
 * 子会话建立验证脚本（供用户在自己终端运行）。
 *
 * 用法：
 *   set CUA_TEST_USER=cua_test
 *   set CUA_TEST_PASSWORD=你的密码
 *   node scripts/cua-verify-child-session.mjs
 *
 * 或者一行：
 *   set CUA_TEST_USER=cua_test && set CUA_TEST_PASSWORD=xxx && node scripts/cua-verify-child-session.mjs
 *
 * 为什么用环境变量而不是命令行参数：
 *   命令行参数会出现在进程列表里，同机其他用户可见；
 *   环境变量只在进程自己的环境块里，不会落到 shell 历史。
 *   这不是绝对安全（同用户权限仍可读），但代价比明文参数低。
 *
 * 这个脚本不写任何文件，不持久化密码，跑完即弃。
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import koffi from "koffi";

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = join(here, "..", "packages", "raspberrycode-cua", "dist", "helper", "rdp-child-session.js");

const username = process.env.CUA_TEST_USER ?? "";
const password = process.env.CUA_TEST_PASSWORD ?? "";

const out = (...parts) => process.stdout.write(parts.join(" ") + "\n");

if (!username) {
  out("缺少 CUA_TEST_USER。用法：");
  out("  set CUA_TEST_USER=cua_test");
  out("  set CUA_TEST_PASSWORD=你的密码");
  out("  node scripts/cua-verify-child-session.mjs");
  process.exit(2);
}

out("=".repeat(60));
out("子会话建立验证");
out("=".repeat(60));
out(`账户: ${username}`);
out(`密码: ${password.length > 0 ? `已提供（${password.length} 字符）` : "空"}`);
out("");

// ---- 前置状态 ----
const wtsapi = koffi.load("wtsapi32.dll");
const WTSGetChildSessionId = wtsapi.func("int __stdcall WTSGetChildSessionId(_Out_ uint32 *sid)");
const WTSIsChildSessionsEnabled = wtsapi.func(
  "int __stdcall WTSIsChildSessionsEnabled(_Out_ int *enabled)",
);

const enabled = [0];
WTSIsChildSessionsEnabled(enabled);
out(`子会话开关: ${enabled[0] === 1 ? "已启用" : "未启用（需要管理员启用）"}`);

const sidBefore = [0];
const okBefore = WTSGetChildSessionId(sidBefore);
const hadBefore = okBefore && sidBefore[0] !== 0xffffffff;
out(`当前子会话: ${hadBefore ? `#${sidBefore[0]}` : "无"}`);
out("");

if (enabled[0] !== 1) {
  out("子会话开关未启用，无法继续。");
  out("启用方式：以管理员身份运行一次（这一步是系统设置，不是本应用能代做的）：");
  out("  需要调用 WTSEnableChildSessions(TRUE)，可用 PowerShell 调用或让我提供一段一次性脚本。");
  process.exit(3);
}

// ---- 建会话 ----
const { createChildSession } = await import(`file:///${distEntry.replace(/\\/g, "/")}`);

out("正在建立子会话（最长等 30 秒）...");
const startedAt = Date.now();
const result = createChildSession({
  username,
  password,
  width: 1280,
  height: 800,
});
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

out("");
out("=".repeat(60));
out(`结果: ${result.ok ? "✓ 成功" : "✗ 未完成"}   （耗时 ${elapsed}s）`);
out("=".repeat(60));
out(`原因码: ${result.reason ?? "(无)"}`);
if (result.connectionState !== undefined) {
  const states = { 0: "断开", 1: "已连接", 2: "连接中" };
  out(`连接状态: ${result.connectionState} (${states[result.connectionState] ?? "未知"})`);
}
if (result.sessionId !== undefined) {
  out(`子会话号: #${result.sessionId}`);
}
out("");
out(result.message);
out("");

// ---- 复查 ----
out("复查会话状态：");
const sidAfter = [0];
const okAfter = WTSGetChildSessionId(sidAfter);
const hasAfter = okAfter && sidAfter[0] !== 0xffffffff;
out(`  WTSGetChildSessionId: ${hasAfter ? `#${sidAfter[0]}` : "无子会话"}`);

// 再等一下，有些情况下会话是异步出现的
if (!hasAfter && result.reason === "connect_pending") {
  out("");
  out("连接仍在进行中，再观察 20 秒...");
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = [0];
    const ok = WTSGetChildSessionId(s);
    if (ok && s[0] !== 0xffffffff) {
      out(`  ✓ ${i + 1}s: 子会话 #${s[0]} 出现`);
      break;
    }
    if (i === 19) out("  20s: 仍未出现");
  }
}

out("");
out("=".repeat(60));
if (hadBefore) {
  out("提示：本次运行前已存在子会话，成功可能是复用了旧的。");
}
out("如果失败，请把上面的输出（不含密码）发给我。");
out("=".repeat(60));

process.exit(result.ok ? 0 : 1);
