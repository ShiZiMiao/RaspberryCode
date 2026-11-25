/**
 * 应用启动。
 *
 * 两条路径：
 * - 可执行文件（绝对路径或 `.exe`）：`spawn` 直接拉起，能拿到 pid。
 * - 其他（开始菜单名、AUMID）：`ShellExecuteW("open")`，只能确认 dispatch，
 *   拿不到 pid。调用方应再用 `list_windows` 确认窗口出现。
 *
 * 为什么不用 `cmd /c start`：那会引入 shell 解析、引号转义和命令注入面。
 * `ShellExecuteW` 是系统 API，参数边界清晰。
 */

import { spawn } from "node:child_process";
import koffi from "koffi";

export interface LaunchResult {
  ok: boolean;
  /** 能解析到子进程时给出；ShellExecute 路径为 null。 */
  pid: number | null;
  /** 是否已把启动请求交给系统。 */
  dispatched: boolean;
  mode: "spawn" | "shell_execute";
  reason?: "launch_failed" | "unsupported_platform";
  message: string;
}

const SW_SHOWNORMAL = 1;

let shellExecute: ((...args: unknown[]) => number) | undefined;

function shellExecuteFn(): ((...args: unknown[]) => number) | undefined {
  if (process.platform !== "win32") return undefined;
  if (shellExecute) return shellExecute;
  try {
    const shell32 = koffi.load("shell32.dll");
    shellExecute = shell32.func(
      "intptr __stdcall ShellExecuteW(void *hwnd, const char16_t *op, const char16_t *file, const char16_t *params, const char16_t *dir, int show)",
    ) as unknown as (...args: unknown[]) => number;
    return shellExecute;
  } catch {
    return undefined;
  }
}

/** 判断是否像可执行文件路径。 */
function looksLikeExecutable(app: string): boolean {
  return /^[a-zA-Z]:[\\/]/u.test(app) || app.toLowerCase().endsWith(".exe");
}

/**
 * 启动应用。
 *
 * `app` 可以是：
 * - 绝对路径（`C:\Windows\System32\notepad.exe`）
 * - 可执行文件名（`notepad`）
 * - 开始菜单显示名（`记事本`）
 * - UWP AUMID（`Microsoft.WindowsCalculator_8wekyb3d8bbwe!App`）
 */
export function launchApplication(app: string): LaunchResult {
  const trimmed = app.trim();
  if (!trimmed) {
    return {
      ok: false,
      pid: null,
      dispatched: false,
      mode: "shell_execute",
      reason: "launch_failed",
      message: "app 不能为空。",
    };
  }

  if (looksLikeExecutable(trimmed)) {
    try {
      const child = spawn(trimmed, [], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      return {
        ok: true,
        pid: child.pid ?? null,
        dispatched: true,
        mode: "spawn",
        message: `已启动 ${trimmed}${child.pid ? `（pid=${child.pid}）` : ""}。`,
      };
    } catch (error) {
      return {
        ok: false,
        pid: null,
        dispatched: false,
        mode: "spawn",
        reason: "launch_failed",
        message: `启动失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const fn = shellExecuteFn();
  if (!fn) {
    return {
      ok: false,
      pid: null,
      dispatched: false,
      mode: "shell_execute",
      reason: "unsupported_platform",
      message: "按显示名启动只在 Windows 上可用；请改用可执行文件路径。",
    };
  }

  // UWP AUMID 需要 shell:AppsFolder 前缀；普通显示名直接交给 ShellExecute。
  const target = trimmed.includes("!") ? `shell:AppsFolder\\${trimmed}` : trimmed;
  const result = fn(null, "open", target, null, null, SW_SHOWNORMAL);
  // ShellExecuteW 的返回值 > 32 表示成功；<= 32 是错误码。
  if (typeof result === "number" && result > 32) {
    return {
      ok: true,
      pid: null,
      dispatched: true,
      mode: "shell_execute",
      message: `已把启动请求交给系统（${target}）。请用 list_windows 确认窗口出现。`,
    };
  }
  return {
    ok: false,
    pid: null,
    dispatched: false,
    mode: "shell_execute",
    reason: "launch_failed",
    message: `ShellExecute 失败（code=${String(result)}）。请改用可执行文件路径或确认应用已安装。`,
  };
}
