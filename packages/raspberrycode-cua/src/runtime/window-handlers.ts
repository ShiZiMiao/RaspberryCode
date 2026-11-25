/**
 * 应用启动与窗口恢复的 runtime handler。
 *
 * 从 `handlers.ts` 抽出：这两个方法都围绕「窗口生命周期」，
 * 与观察/动作的参数解析不是同一类职责。抽出的另一个收益是
 * `handlers.ts` 不再因为新增能力持续膨胀。
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CuaHelperClient } from "./helper-client.ts";
import { DISPATCH_ERROR_CODES, buildErrorResult, buildTextResult } from "./receipts.ts";
import { SDK_METHODS, type DispatchPolicy } from "./sdk-contract.ts";

/**
 * 显式启动应用。
 *
 * 返回 `pid` 只在能解析到子进程时给出；ShellExecute 路径返回
 * `dispatched: true` + `pid: null`，调用方应再用 `list_windows` 确认。
 */
export async function handleLaunchApp(
  client: CuaHelperClient,
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const app = typeof params.app === "string" ? params.app.trim() : undefined;
  if (!app) {
    return buildErrorResult(DISPATCH_ERROR_CODES.BAD_REQUEST, "launch_app 需要 app", {
      tool: SDK_METHODS.LAUNCH_APP,
      actionSent: false,
    });
  }
  const result = await client.launchApp({ app });
  return buildTextResult(
    result.ok
      ? `launched ${app}${result.pid ? ` pid=${result.pid}` : ""} (${result.mode})`
      : `launch failed: ${result.message}`,
    {
      method: SDK_METHODS.LAUNCH_APP,
      ok: result.ok,
      pid: result.pid,
      dispatched: result.dispatched,
      mode: result.mode,
      reason: result.reason ?? null,
      message: result.message,
      elapsed_ms: result.elapsedMs,
    },
  );
}

/**
 * 两阶段窗口恢复。
 *
 * `prepare` 只读；`restore` 需要 `allowWindowRestore` + `unrestricted` 预算
 * + 单次 `recovery_id`。恢复后旧 stateId/坐标上下文失效，调用方必须重新观察。
 */
export async function handleRestoreWindow(
  client: CuaHelperClient,
  params: Record<string, unknown>,
  policy: DispatchPolicy,
): Promise<CallToolResult> {
  const phase = params.phase === "restore" ? "restore" : "prepare";
  const stateId =
    typeof params.state_id === "string"
      ? params.state_id
      : typeof params.stateId === "string"
        ? params.stateId
        : undefined;
  const windowId =
    typeof params.window_id === "string"
      ? params.window_id
      : typeof params.windowId === "string"
        ? params.windowId
        : undefined;
  const pid = typeof params.pid === "number" ? params.pid : undefined;
  const hwnd =
    typeof params.hwnd === "string" || typeof params.hwnd === "number"
      ? params.hwnd
      : undefined;

  if (phase === "prepare") {
    const result = await client.restoreWindow({ phase, stateId, windowId, pid, hwnd });
    return buildTextResult(
      result.ok
        ? `prepared recovery_id=${result.recovery_id}`
        : `prepare failed: ${result.message}`,
      {
        method: SDK_METHODS.RESTORE_WINDOW,
        phase,
        ...result,
      },
    );
  }

  if (!policy.allowWindowRestore) {
    return buildErrorResult(
      DISPATCH_ERROR_CODES.AUTHORIZATION_REQUIRED,
      "窗口恢复需要用户在设置中显式授权（allowWindowRestore）。不要重试，如实告知用户。",
      { tool: SDK_METHODS.RESTORE_WINDOW, actionSent: false },
    );
  }
  if (policy.budget !== "unrestricted") {
    return buildErrorResult(
      DISPATCH_ERROR_CODES.FOREGROUND_REQUIRED,
      `窗口恢复会激活窗口，需要预算 unrestricted，当前为 ${policy.budget}。这是用户的设定，不能由调用方修改。`,
      { tool: SDK_METHODS.RESTORE_WINDOW, actionSent: false },
    );
  }

  const recoveryId =
    typeof params.recovery_id === "string"
      ? params.recovery_id
      : typeof params.recoveryId === "string"
        ? params.recoveryId
        : undefined;
  if (!recoveryId) {
    return buildErrorResult(
      DISPATCH_ERROR_CODES.BAD_REQUEST,
      "restore 阶段需要 recovery_id（来自 prepare）。",
      { tool: SDK_METHODS.RESTORE_WINDOW, actionSent: false },
    );
  }

  const result = await client.restoreWindow({
    phase,
    stateId,
    windowId,
    pid,
    hwnd,
    recovery_id: recoveryId,
    foreground: params.foreground === true,
  });
  return buildTextResult(
    result.ok
      ? `restored${result.foreground ? " and activated" : ""}`
      : `restore failed: ${result.message}`,
    {
      method: SDK_METHODS.RESTORE_WINDOW,
      phase,
      ...result,
      next_step: result.ok ? "observe" : "reobserve",
    },
  );
}
