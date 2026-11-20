/**
 * 独立桌面（子会话）的能力判定。
 *
 * 参照 WorkBuddy 的六态模型（`unsupported` / `supported` /
 * `enabled_pending_reboot` / `transport_broken` / `enabled` / `session_ready`），
 * 以及它的 `actionable` 字段——明确告诉调用方「这条路还有没有戏」。
 *
 * 为什么不用「可用/不可用」二元判断：这两种答案对下一步毫无指导。
 * 「已启用但没有会话」和「已启用且有会话」是两种完全不同的状态，
 * 前者需要创建、后者可以直接用；而「差一个重启」与「缺特权」
 * 是「等一等就好」和「永远不行」的区别。混在一起说，
 * 用户会反复尝试一条注定失败的路。
 *
 * **本模块只做判定，不做创建。** 创建子会话需要 SYSTEM 权限
 * （改令牌会话 ID 需要 `SeTcbPrivilege`），本实现不做那一步。
 */

import { probeSessionTopology, type SessionTopology } from "./session.ts";

/**
 * 能力状态。
 *
 * 与 WorkBuddy 的命名对齐，便于对照排查；但它没有 `transport_broken`
 * ——那条与终端服务的传输管道探测依赖它自己的驱动组件，本实现无法复用。
 */
export type IsolatedDesktopCapability =
  /** 平台不支持（非 Windows）。 */
  | "unsupported"
  /** 系统支持但开关未开（需 `WTSEnableChildSessions(TRUE)`，要管理员）。 */
  | "supported"
  /** 开关已开、但没有任何子会话存在，需要创建。 */
  | "enabled"
  /** 子会话已存在且可交互，可以直接用。 */
  | "session_ready";

/** 完整判定结果。 */
export interface IsolatedDesktopState {
  capability: IsolatedDesktopCapability;
  /**
   * 这条路还有没有戏。
   *
   * false = 不要重试、不要再引导用户。这是给模型看的硬信号：
   * 它在 `false` 时继续尝试只是浪费预算。
   */
  actionable: boolean;
  /** 当前会话号（主进程所在）。 */
  currentSessionId: number;
  /** 子会话号（存在时）。 */
  childSessionId: number | undefined;
  /** 能否把助手进程放进子会话。 */
  canSpawnIntoChild: boolean;
  /** 逐项前置条件的实测结果，排查用。 */
  gates: IsolatedDesktopGate[];
  /** 一句话结论。 */
  summary: string;
  /** 下一步该做什么（或为什么没有下一步）。 */
  nextStep: string;
}

/** 一道前置门。 */
export interface IsolatedDesktopGate {
  /** 门的标识。 */
  id: "platform" | "switch" | "session" | "privilege";
  label: string;
  passed: boolean;
  /** 实测到的细节。 */
  detail: string;
  /**
   * 这道门能否由用户/管理员解决。
   *
   * false 表示在当前实现范围内无解——不是「暂时不行」，
   * 而是「本实现不做」。区分这两者很重要：前者值得等待，后者只会浪费尝试。
   */
  resolvable: boolean;
}

/**
 * 判定独立桌面能力。
 *
 * 不抛错：任何探测失败都变成某个 gate 的 `passed: false` 加具体原因。
 */
export function probeIsolatedDesktop(): IsolatedDesktopState {
  const topology: SessionTopology = probeSessionTopology();

  const gates: IsolatedDesktopGate[] = [
    {
      id: "platform",
      label: "平台为 Windows",
      passed: process.platform === "win32",
      detail: `platform=${process.platform}`,
      resolvable: false,
    },
    {
      id: "switch",
      label: "系统已启用子会话开关",
      passed: topology.childSessionsEnabled,
      detail: topology.childSessionsEnabled
        ? "WTSIsChildSessionsEnabled = 1"
        : "WTSIsChildSessionsEnabled = 0（需 WTSEnableChildSessions(TRUE)，要求管理员）",
      resolvable: true,
    },
    {
      id: "session",
      label: "已存在可交互的子会话",
      passed: topology.childSessionId !== undefined,
      detail:
        topology.childSessionId !== undefined
          ? `子会话 #${topology.childSessionId}`
          : "无活动子会话（WTSGetChildSessionId = 0xFFFFFFFF）",
      // 创建子会话需要 SYSTEM 权限，本实现不做 → 对本实现而言不可解析
      resolvable: false,
    },
    {
      id: "privilege",
      label: "可把助手放进该会话",
      passed: topology.canChangeSession,
      detail: topology.canChangeSession
        ? "SetTokenInformation(TokenSessionId) 可用"
        : (topology.sessionChangeBlocker ?? "无法改令牌会话 ID"),
      // 需要 SeTcbPrivilege，本实现不做提权
      resolvable: false,
    },
  ];

  const platform = gates[0].passed;
  const switchOn = gates[1].passed;
  const hasSession = gates[2].passed;
  const canSpawn = gates[3].passed;

  let capability: IsolatedDesktopCapability;
  if (!platform) capability = "unsupported";
  else if (!switchOn) capability = "supported";
  else if (!hasSession) capability = "enabled";
  else capability = "session_ready";

  // actionable 的口径：**在当前实现范围内**还有没有下一步。
  // 不是「理论上能不能」——理论上一切皆可实现，但那对调用方没用。
  const actionable = platform && switchOn && hasSession && canSpawn;

  return {
    capability,
    actionable,
    currentSessionId: topology.currentSessionId,
    childSessionId: topology.childSessionId,
    canSpawnIntoChild: canSpawn,
    gates,
    summary: summarize(capability, gates),
    nextStep: nextStepFor(capability, gates, actionable),
  };
}

function summarize(
  capability: IsolatedDesktopCapability,
  gates: IsolatedDesktopGate[],
): string {
  const failed = gates.filter((g) => !g.passed);
  switch (capability) {
    case "unsupported":
      return "本机平台不是 Windows，独立桌面不可用。";
    case "supported":
      return "系统支持独立桌面但开关未开，需管理员调用 WTSEnableChildSessions(TRUE)。";
    case "enabled":
      return "独立桌面已启用，但当前没有活动会话。";
    case "session_ready":
      return failed.length === 0
        ? "独立桌面已就绪，可直接在其中操作。"
        : `独立桌面已就绪，但仍有 ${failed.length} 项条件不满足：${failed
            .map((g) => g.label)
            .join("、")}。`;
  }
}

function nextStepFor(
  capability: IsolatedDesktopCapability,
  gates: IsolatedDesktopGate[],
  actionable: boolean,
): string {
  if (actionable) {
    return `可直接在子会话 #${gates.find((g) => g.id === "session")?.detail ?? "?"} 内操作。`;
  }
  switch (capability) {
    case "unsupported":
      return "无解，不要重试。";
    case "supported":
      return "如需开启，需以管理员身份运行一次 WTSEnableChildSessions(TRUE)，之后重启生效。";
    case "enabled":
      return (
        "开关已开但没有会话。创建会话需要 SYSTEM 权限（schtasks 以 SYSTEM 运行 + " +
        "借 winlogon 令牌 + SetTokenInformation），本实现不做这一步——" +
        "那等于要求用户授权整机最高权限。若确实需要，请在目标会话内直接运行本应用。"
      );
    case "session_ready": {
      const blocked = gates.filter((g) => !g.passed);
      return (
        "会话存在但无法把助手放进去：" +
        blocked.map((g) => `${g.label}（${g.detail}）`).join("；") +
        "。需要 SeTcbPrivilege，本实现不做提权。"
      );
    }
  }
}
