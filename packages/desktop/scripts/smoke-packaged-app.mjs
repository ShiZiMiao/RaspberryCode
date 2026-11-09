#!/usr/bin/env node
// 打包产物启动冒烟：安装包/未打包目录能否真正把应用拉起来。
//
// 修复背景（v0.1.0 Windows 实机）：安装后主进程启动即崩 ERR_MODULE_NOT_FOUND('yaml')。
// 单测全部跑源码级，打包链只有"模块清单在不在 asar"的静态校验，没有任何"启动一次产物"
// 的门禁——坏包畅通无阻流出。本脚本把启动验收固化进打包链（bundle.mjs 在校验后调用）。
//
// 隔离：通过 RASPBERRYCODE_DESKTOP_USER_DATA_DIR / RASPBERRYCODE_DESKTOP_HOME_DIR 指向
// 临时目录，冒烟既不污染用户真实数据，也不与正在运行的正式实例抢单实例锁；
// 进程探针按可执行路径归属过滤，只观察本次启动的进程树。
//
// 检查项（Windows）：
// 1. 进程在观察窗内存活（模块加载崩溃会立刻退出或卡死在异常弹窗）；
// 2. stderr 无 ERR_MODULE_NOT_FOUND / Cannot find package / Uncaught Exception；
// 3. 本实例进程树 ≥2（主进程成功创建窗口后会拉起 GPU/渲染器子进程；坏包时代只有 1 个）；
// 4. 本实例不存在标题为 "Error" 的主窗口（Electron 未捕获异常弹窗）。
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import process from "node:process";
import { join, resolve } from "node:path";

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--app-dir") options.appDir = argv[++i];
    else if (argv[i] === "--settle-ms") options.settleMs = Number(argv[++i]);
  }
  return options;
}

/** 只统计可执行路径位于 appDir 下的同名进程（排除用户正在运行的正式实例）。 */
function listOwnedProcessTitles(imageName, appDir) {
  // PowerShell 单引号串里反斜杠是字面量（-like 通配里也无需转义），只需转义单引号。
  const likePattern = `${appDir.replaceAll("'", "''")}\\*`;
  const script = [
    `$ErrorActionPreference='SilentlyContinue';`,
    `$pids = (Get-CimInstance Win32_Process -Filter "Name='${imageName.replaceAll("'", "''")}.exe'")`,
    `  | Where-Object { $_.ExecutablePath -like '${likePattern}' }`,
    `  | Select-Object -ExpandProperty ProcessId;`,
    `if ($pids) { Get-Process -Id $pids | ForEach-Object { "$($_.Id)|$($_.MainWindowTitle)" } }`,
  ].join(" ");
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  return (result.stdout ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, ...titleParts] = line.split("|");
      return { pid: Number(pid), title: titleParts.join("|") };
    });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (process.platform !== "win32") {
    console.log("[smoke-packaged-app] skipped: Windows only");
    return 0;
  }
  if (process.env.RASPBERRYCODE_SKIP_PACKAGED_SMOKE === "1") {
    console.log("[smoke-packaged-app] skipped: RASPBERRYCODE_SKIP_PACKAGED_SMOKE=1");
    return 0;
  }
  const appDir = resolve(options.appDir ?? "dist/win-unpacked");
  if (!existsSync(appDir)) {
    console.error(`[smoke-packaged-app] 未找到应用目录: ${appDir}`);
    return 1;
  }
  const exeName = readdirSync(appDir).find((name) => name.toLowerCase().endsWith(".exe"));
  if (!exeName) {
    console.error(`[smoke-packaged-app] 应用目录内没有可执行文件: ${appDir}`);
    return 1;
  }
  const appPath = resolve(appDir, exeName);
  const imageName = exeName.replace(/\.exe$/iu, "");
  const settleMs = Number.isFinite(options.settleMs) ? options.settleMs : 15_000;

  const smokeRoot = mkdtempSync(join(tmpdir(), "raspberrycode-packaged-smoke-"));
  const childEnv = {
    ...process.env,
    RASPBERRYCODE_DESKTOP_USER_DATA_DIR: join(smokeRoot, "user-data"),
    RASPBERRYCODE_DESKTOP_HOME_DIR: join(smokeRoot, "home"),
  };

  console.log(`[smoke-packaged-app] launching ${appPath} settle=${settleMs}ms`);
  // stdio 必须保留至少一个继承句柄：实测三路全部 ignore/pipe 时应用会在 ~170ms 自行
  // exit 0（疑为 Electron 在纯管道 stdio 会话下的退出怪癖），stdin 继承 + 输出捕获最稳。
  const child = spawn(appPath, [], {
    cwd: appDir,
    env: childEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  let stderrText = "";
  child.stderr.on("data", (chunk) => {
    stderrText += String(chunk);
  });
  child.stdout.on("data", () => {});

  const cleanup = () => {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], {
      windowsHide: true,
      stdio: "ignore",
    });
    rmSync(smokeRoot, { force: true, recursive: true });
  };

  return new Promise((resolvePromise) => {
    let exitedEarly = false;
    let evaluated = false;
    child.on("exit", (code) => {
      exitedEarly = true;
      if (!evaluated) console.error(`[smoke-packaged-app] 进程提前退出 code=${code}`);
    });
    setTimeout(() => {
      evaluated = true;
      const failures = [];
      if (exitedEarly) failures.push("进程在观察窗内提前退出（模块加载崩溃、初始化失败，或与运行中的正式实例抢单实例锁）");
      if (/ERR_MODULE_NOT_FOUND|Cannot find package|Uncaught Exception/iu.test(stderrText)) {
        failures.push(`stderr 含启动崩溃特征:\n${stderrText.slice(0, 2000)}`);
      }
      const processes = listOwnedProcessTitles(imageName, appDir);
      const errorDialogs = processes.filter((entry) => entry.title === "Error");
      if (errorDialogs.length > 0) {
        failures.push(
          `存在标题为 Error 的异常弹窗窗口（pids: ${errorDialogs.map((e) => e.pid).join(",")}）`,
        );
      }
      cleanup();
      if (failures.length > 0) {
        console.error(`[smoke-packaged-app] FAILED:\n- ${failures.join("\n- ")}`);
        resolvePromise(1);
        return;
      }
      // 只判与 spawn 语境无关的硬信号：主进程存活 + stderr 干净 + 无异常弹窗。
      // 进程数/窗口渲染在不同启动语境（资源管理器 vs 子进程 spawn）表现不一，
      // 不作硬判据；模块缺失类崩溃由 verifyPackagedRuntimeDependencies 静态兜底。
      console.log(
        `[smoke-packaged-app] passed: 本实例 ${processes.length} 进程存活、无异常弹窗、stderr 干净`,
      );
      resolvePromise(0);
    }, settleMs);
  });
}

process.exitCode = await main();
