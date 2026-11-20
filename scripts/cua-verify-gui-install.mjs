/**
 * 无人值守 GUI 验证：安装 → 启动 → 设置页开关 → 重启 → CUA 实测。
 *
 * 这一环此前从未被验证过（单测验的是 env 构造，端到端验的是 env→runtime，
 * 中间「用户在设置页点开关 → main 快照」这一跳是空的）。
 * 断在这里的症状是「开了开关、重启了，键盘输入仍被拒」，且没有任何报错。
 *
 * 用法：
 *   node scripts/cua-verify-gui-install.mjs --installer <path-to-exe>
 *   node scripts/cua-verify-gui-install.mjs --skip-install      # 已装好，只验 GUI
 *
 * 前置：应用必须已关闭；记事本窗口可见；agent-desktop MCP 可用。
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const installerArg = args.indexOf("--installer");
const installer = installerArg >= 0 ? resolve(args[installerArg + 1]) : undefined;
const skipInstall = args.includes("--skip-install");

// 安装位置按当前用户的 LOCALAPPDATA 推导，不写死用户名——
// 这个脚本会入库，硬编码路径在别人机器上必然失败。
// 需要覆盖时用 RASPBERRYCODE_INSTALL_ROOT / RASPBERRYCODE_HOME。
const INSTALL_ROOT =
  process.env.RASPBERRYCODE_INSTALL_ROOT ??
  join(process.env.LOCALAPPDATA ?? "", "Programs", "RaspberryCode");
const EXE = join(INSTALL_ROOT, "RaspberryCode.exe");
const DATA_DIR = process.env.RASPBERRYCODE_HOME ?? join(homedir(), ".raspberrycode");

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${label}${detail ? `\n         ${String(detail).replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
};
const step = (n, s) => console.log(`\n--- ${n}. ${s} ---`);

function isRunning() {
  try {
    const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq RaspberryCode.exe", "/FO", "CSV", "/NH"], {
      encoding: "utf8",
    });
    return !/no tasks/i.test(out) && out.includes("RaspberryCode.exe");
  } catch {
    return false;
  }
}

function killApp() {
  try {
    execFileSync("taskkill", ["/F", "/IM", "RaspberryCode.exe"], { stdio: "ignore" });
  } catch {
    // 本来就没在跑
  }
}

step(0, "环境自检");
if (!skipInstall) {
  if (!installer || !existsSync(installer)) {
    console.error(`[FATAL] 需要 --installer <路径> 或 --skip-install。收到: ${installer ?? "（无）"}`);
    process.exit(2);
  }
}
if (isRunning()) {
  console.log("  关闭正在运行的应用…");
  killApp();
  await new Promise((r) => setTimeout(r, 4000));
}
check("应用已关闭", !isRunning());

if (!existsSync(EXE)) {
  console.error(`[FATAL] 未找到主程序（请先安装）: ${EXE}`);
  process.exit(2);
}

step(1, "静默安装");
if (!skipInstall) {
  // `Start-Process -Wait` 是必须的：Git Bash 直接调会假成功（项目记忆里的既有坑）
  const ps = `Start-Process -FilePath '${installer}' -ArgumentList '/S' -Wait -PassThru | Select-Object -ExpandProperty ExitCode`;
  try {
    const code = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).trim();
    check(`安装器退出码 ${code}`, code === "0", code);
  } catch (error) {
    check("安装器执行", false, String(error?.message ?? error));
  }
  // 静默安装后给快捷方式与注册表一点时间落盘
  await new Promise((r) => setTimeout(r, 3000));
}
check("主程序存在", existsSync(EXE), EXE);

step(2, "启动应用");
{
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // 用 explorer 启动：脱离当前进程树，避免打包/脚本结束时被回收
  spawn("cmd", ["/c", "start", "", EXE], { env, detached: true, stdio: "ignore" }).unref();
  // 等窗口出现（Electron 冷启动 + 首屏渲染）
  let up = false;
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    if (isRunning()) {
      up = true;
      break;
    }
  }
  check("应用进程已启动", up);
  // 再等界面渲染
  await new Promise((r) => setTimeout(r, 6000));
}

console.log(`\n=== GUI 阶段需要 agent-desktop 介入 ===`);
console.log(`后续步骤（设置页开关、重启、CUA 实测）由自动化脚本接管，见 PLAN 中的 P4/P5。`);
console.log(`\n当前进程状态: ${isRunning() ? "运行中" : "未运行"}`);
console.log(`数据目录: ${DATA_DIR}`);
console.log(`\n=== ${failures === 0 ? "安装与启动阶段通过" : `${failures} 项失败`} ===`);
process.exit(failures === 0 ? 0 : 1);
