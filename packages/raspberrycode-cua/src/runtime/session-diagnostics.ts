/**
 * 会话诊断与截图相关的结果构造。
 *
 * 从 `handlers.ts` 抽出：那个文件已经管 12 个 SDK 方法的参数翻译，
 * 再放会话诊断会超出可读范围。
 *
 * 这个模块的共同点是「解释性输出」——它不执行动作，只把系统的
 * 真实状态翻译成人和模型都能据以决策的文本。
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CuaHelperClient } from "./helper-client.ts";
import { buildTextResult } from "./receipts.ts";

/**
 * 会话拓扑诊断。
 *
 * 返回完整的会话列表与「为什么不能跨会话」的具体原因。
 *
 * 为什么要把原因写这么细：用户问「能不能操作另一个桌面的应用」时，
 * 「不行」这个答案没有价值，「不行，因为系统没启用子会话 / 因为缺 SYSTEM 特权」
 * 才能让人知道下一步该做什么。同理，模型看到具体原因就不会反复重试。
 */
export async function handleSessions(client: CuaHelperClient): Promise<CallToolResult> {
  // Helper 自己的会话号是判定「它能看到什么」的前提。
  //
  // UIA 与窗口枚举都只看得到 Helper 所在的那个会话（spec §1.3）。
  // 因此「主进程在 Session 1、Helper 也在 Session 1」才意味着
  // 观察到的窗口列表就是用户眼前的那些。两者不一致时，
  // 所有观察结果都属于另一个桌面，必须明确告知——
  // 否则用户会以为模型在看自己的屏幕。
  const [topology, helperInfo] = await Promise.all([
    client.sessions(),
    client.ping().catch(() => undefined),
  ]);

  const helperSession = helperInfo?.sessionId;
  const sessionMismatch =
    helperSession !== undefined && helperSession !== topology.current_session_id;

  const lines = [
    `当前会话: ${topology.current_session_id}`,
    helperSession !== undefined
      ? `Helper 会话: ${helperSession}${sessionMismatch ? " (与主进程不同！)" : " (与主进程一致)"}`
      : "Helper 会话: 未知（探活失败）",
    `会话列表 (${topology.sessions.length}):`,
    ...topology.sessions.map(
      (s) =>
        `  #${s.session_id} ${s.state}${s.is_current ? " (当前)" : ""}` +
        ` station=${s.station}${s.has_interactive_desktop ? "" : " [无交互桌面]"}`,
    ),
    `子会话: ${topology.child_sessions_enabled ? "已启用" : "未启用"}` +
      (topology.child_session_id !== null ? ` (id=${topology.child_session_id})` : " (无活动会话)"),
    `可切会话: ${topology.can_change_session ? "是" : "否"}` +
      (topology.session_change_blocker ? ` — ${topology.session_change_blocker}` : ""),
    `跨会话可用: ${topology.cross_session_available ? "是" : "否"}`,
    "",
    topology.guidance,
  ];

  if (sessionMismatch) {
    // 这条不是诊断细节，是必须让用户知道的错位：
    // 他以为自己看到的是主桌面，实际模型在操作另一个桌面。
    lines.push(
      "",
      `⚠ Helper 运行在会话 ${helperSession}，而主进程在会话 ${topology.current_session_id}。` +
        "观察与动作都只作用于 Helper 所在的会话，用户查看自己的桌面时不会看到这些操作。",
    );
  }

  return buildTextResult(lines.join("\n"), {
    current_session_id: topology.current_session_id,
    helper_session_id: helperSession ?? null,
    session_mismatch: sessionMismatch,
    sessions: topology.sessions.map((s) => ({
      session_id: s.session_id,
      state: s.state,
      station: s.station,
      is_current: s.is_current,
      has_interactive_desktop: s.has_interactive_desktop,
    })),
    child_sessions_enabled: topology.child_sessions_enabled,
    child_session_id: topology.child_session_id,
    can_change_session: topology.can_change_session,
    session_change_blocker: topology.session_change_blocker,
    cross_session_available: topology.cross_session_available,
    guidance: topology.guidance,
  });
}

/** 在结果后追加一段说明文本，保持 structuredContent 不变。 */
export function appendText(result: CallToolResult, note: string): CallToolResult {
  return {
    content: [...result.content, { type: "text", text: note }],
    structuredContent: result.structuredContent,
  };
}

/**
 * 权限申请（SDK 的 `request_access`）。
 *
 * 本地实现没有「按应用逐个授权」的概念——授权是全局的（预算 + 物理注入开关）。
 * 因此这里如实汇报当前授权状态，而不是假装走了一遍审批流程。
 */
export async function handleRequestAccess(
  _client: CuaHelperClient,
  _params: Record<string, unknown>,
): Promise<CallToolResult> {
  return buildTextResult(
    "Computer Use access is granted for this session. " +
      "Interference budget and physical-injection authorization come from the user's settings, not per-app approval.",
    {
      granted: true,
      mode: "session",
      capabilities: [
        "list_windows",
        "get_app_state",
        "left_click",
        "set_value",
        "scroll",
        "type",
        "key",
        "paste",
        "perform_action",
      ],
    },
  );
}

/** 停止控制（SDK 的 `stop_computer_control`）。本地实现无持续性会话，记录即可。 */
export async function handleStopComputerControl(): Promise<CallToolResult> {
  return buildTextResult("Computer control stopped.", { stopped: true });
}

/**
 * 独立桌面（子会话）能力判定。
 *
 * 输出刻意做成「逐道门 + 是否有戏」的形状，而不是一个布尔值：
 * 用户问「能不能用独立桌面」时，「不能」没有价值，
 * 「差一道管理员开关」和「需要 SYSTEM 权限，本实现不做」才是能据以行动的信息。
 *
 * `actionable` 是给模型的硬信号——false 时继续尝试只是浪费预算。
 */
export async function handleIsolatedDesktop(
  client: CuaHelperClient,
): Promise<CallToolResult> {
  const state = await client.isolatedDesktop();

  const lines = [
    `独立桌面能力: ${state.capability}`,
    `是否有戏: ${state.actionable ? "是" : "否（不要重试）"}`,
    `当前会话: ${state.current_session_id}` +
      (state.child_session_id !== null ? ` / 子会话: ${state.child_session_id}` : " / 无子会话"),
    "",
    "前置条件:",
    ...state.gates.map(
      (g) =>
        `  ${g.passed ? "✓" : "✗"} ${g.label}: ${g.detail}` +
        (g.passed || g.resolvable ? "" : " [本实现不做]"),
    ),
    "",
    state.summary,
    "",
    state.next_step,
  ];

  return buildTextResult(lines.join("\n"), state);
}

/**
 * 窗口移出屏幕 / 移回。
 *
 * 用途：让窗口「用户看不见但客户区仍在」。
 *
 * 为什么需要它而不是最小化：实测窗口最小化会销毁客户区
 * （`ClientRect=0x0`），PrintWindow 与 WGC 都拿不到画面。
 * 移出屏幕只是改变位置，客户区完好——采集与元素操作都不受影响。
 *
 * 这不是「操作界面」的动作，而是「改变窗口可见性」的控制手段，
 * 因此不放进模型面（模型不该自己决定把用户的窗口移走）。
 * 由上层在需要后台持续采集时调用。
 */
export async function handleWindowOffscreen(
  client: CuaHelperClient,
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const rawAction = params.action;
  const action = rawAction === "restore" ? "restore" : "hide";

  const rawHwnd = params.hwnd ?? params.window_handle ?? params.app_ref;
  const hwnd =
    typeof rawHwnd === "number"
      ? rawHwnd
      : typeof rawHwnd === "string"
        ? Number.parseInt(rawHwnd, rawHwnd.startsWith("0x") ? 16 : 10)
        : Number.NaN;

  if (!Number.isFinite(hwnd) || hwnd === 0) {
    return buildTextResult(
      "缺少或无效的 hwnd 参数。请传窗口句柄（数字或 0x 前缀字符串）。",
      { ok: false, reason: "invalid_window" },
    );
  }

  const x = typeof params.x === "number" ? params.x : undefined;
  const y = typeof params.y === "number" ? params.y : undefined;

  const result = await client.windowOffscreen({
    action,
    hwnd,
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
  });

  if (!result.ok) {
    return buildTextResult(result.message, {
      ok: false,
      reason: result.reason ?? "unknown",
    });
  }

  const lines =
    action === "hide"
      ? [
          `窗口已推到屏幕边缘，屏内保留 ${result.visibleWidth ?? 2}px。`,
          `  原位置: (${result.previousRect?.x}, ${result.previousRect?.y})`,
          `  新位置: (${result.targetPosition?.x}, ${result.targetPosition?.y})`,
          "",
          "客户区完好，截图是完整画面且内容持续更新。",
          "屏幕上会留下一条极窄的可见边——这是让画面保持更新的代价：",
          "完全移出屏幕会让画面冻结（截图停在最后一帧，操作后也不更新）。",
          "要恢复请用 action=restore 并传入原位置坐标。",
        ]
      : ["窗口已移回原位。"];

  return buildTextResult(lines.join("\n"), {
    ok: true,
    action,
    ...(result.mode ? { mode: result.mode } : {}),
    ...(result.visibleWidth !== undefined ? { visible_width: result.visibleWidth } : {}),
    ...(result.previousRect ? { previous_rect: result.previousRect } : {}),
    ...(result.targetPosition ? { target_position: result.targetPosition } : {}),
  });
}
