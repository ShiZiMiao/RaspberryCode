/**
 * Windows 会话拓扑探测。
 *
 * 背景（spec §1.3 / §1.4）：UIA 与窗口枚举都**只看得到自己所在的会话**。
 * 同一进程在 Session 1 枚举，Session 2（RDP 子会话）的 54 个进程可见窗口数为 0。
 * 因此「操作另一个会话里的应用」不可能靠远程观察实现，必须在该会话内运行助手。
 *
 * 本模块负责把「能不能做、为什么不能」讲清楚，而不是含糊地失败。
 * 关键设计：**不做越会话提权**。改令牌的会话 ID 需要 `SeTcbPrivilege`，
 * 那是只有 SYSTEM 才有的特权。实测本机 `SetTokenInformation(TokenSessionId)`
 * 返回 1314（缺特权），所以这里只做探测与如实报告，不尝试绕过——
 * 绕过意味着要求用户把整个应用提权到 SYSTEM，代价远大于收益。
 */

import koffi from "koffi";

/** WTS 连接的会话信息。 */
export interface SessionInfo {
  sessionId: number;
  /** 会话状态的数字码（WTS_CONNECTSTATE_CLASS）。 */
  stateCode: number;
  /** 会话状态的可读名。 */
  state: string;
  /** 窗口站名。服务会话是 "Services"，交互会话通常是 "Console"。 */
  stationName: string;
  /** 是否是当前进程所在的会话。 */
  isCurrent: boolean;
  /**
   * 该会话是否可能有可用桌面。
   *
   * 只有 `Active` 才算。`Listen`（监听器，RDP 未连接时存在）、
   * `Disconnected`、`Idle` 都没有可交互的桌面。
   */
  hasInteractiveDesktop: boolean;
}

/** 会话能力全景。 */
export interface SessionTopology {
  /** 当前进程所在会话 ID。 */
  currentSessionId: number;
  /** 全部会话。 */
  sessions: SessionInfo[];
  /** 系统是否启用了子会话（`WTSIsChildSessionsEnabled`）。 */
  childSessionsEnabled: boolean;
  /**
   * 子会话 ID（`WTSGetChildSessionId`）。
   *
   * - `undefined`：调用失败或系统不支持
   * - `-1` 或 `0xFFFFFFFF`：已启用但当前没有子会话存在
   */
  childSessionId: number | undefined;
  /**
   * 本进程能否把令牌切到别的会话。
   *
   * 恒为 false 除非以 SYSTEM 运行——改 `TokenSessionId` 需要 `SeTcbPrivilege`。
   * 探测方式是真的试一次 `SetTokenInformation` 并读错误码，
   * 不是靠「猜账户类型」。
   */
  canChangeSession: boolean;
  /** `canChangeSession` 为 false 时，失败的具体原因（含 Win32 错误码）。 */
  sessionChangeBlocker: string | undefined;
  /** 整体结论：能否在本进程内操作非当前会话的应用。 */
  crossSessionAvailable: boolean;
  /** 结论对应的可操作建议，给人和模型看。 */
  guidance: string;
}

const WTS_CONNECT_STATE: Readonly<Record<number, string>> = {
  0: "Active",
  1: "Connected",
  2: "ConnectQuery",
  3: "Shadow",
  4: "Disconnected",
  5: "Idle",
  6: "Listen",
  7: "Reset",
  8: "Down",
  9: "Init",
};

/** TokenSessionId 信息类。 */
const TOKEN_SESSION_ID_CLASS = 12;

/** 需要的令牌访问权：查询 + 复制 + 分配主令牌。 */
const TOKEN_ACCESS = 0x0002 | 0x0008 | 0x0001;

let kernel32: koffi.IKoffiLib | undefined;
let wtsapi: koffi.IKoffiLib | undefined;
let advapi: koffi.IKoffiLib | undefined;

function k32() {
  kernel32 ??= koffi.load("kernel32.dll");
  return kernel32;
}
function wts() {
  wtsapi ??= koffi.load("wtsapi32.dll");
  return wtsapi;
}
function adv() {
  advapi ??= koffi.load("advapi32.dll");
  return advapi;
}

interface SessionApi {
  enumerate: () => { sessionId: number; stateCode: number; stationName: string }[];
  childSessionsEnabled: () => boolean;
  childSessionId: () => number | undefined;
  canChangeSession: () => { ok: boolean; error: number };
}

let api: SessionApi | undefined;

function sessionApi(): SessionApi {
  if (api) return api;

  const WTSEnumerateSessionsW = wts().func(
    "int __stdcall WTSEnumerateSessionsW(void *h, uint32 reserved, uint32 version, _Out_ void **info, _Out_ uint32 *count)",
  );
  const WTSFreeMemory = wts().func("void __stdcall WTSFreeMemory(void *p)");
  // 这两个函数在部分 Windows 版本上不存在（需要 RDS 角色），
  // 因此按「可能失败」处理，不假设一定可用。
  // **签名必须带 out 参数。**
  //
  // 官方定义是 `BOOL WTSIsChildSessionsEnabled(PBOOL pbEnabled)`，
  // 不是无参函数。曾经漏了参数，koffi 的调用仍然「成功」返回 0，
  // 于是 `!== 0` 恒为 false —— 整个功能被误判成「系统未启用子会话」，
  // 而实际本机 enabled=1。这类 bug 的隐蔽之处在于它不报错，
  // 只是安静地给出错误结论。
  const WTSIsChildSessionsEnabled = wts().func(
    "int __stdcall WTSIsChildSessionsEnabled(_Out_ int *pbEnabled)",
  );
  const WTSGetChildSessionId = wts().func(
    "int __stdcall WTSGetChildSessionId(_Out_ uint32 *sid)",
  );
  const WideCharToMultiByte = k32().func(
    "int __stdcall WideCharToMultiByte(uint32 cp, uint32 flags, const void *ws, int wl, void *s, int sl, const void *dflt, void *used)",
  );

  const SESSION_INFO = koffi.struct("RC_SessionInfoW", {
    SessionId: "uint32",
    pWinStationName: "void *",
    State: "int",
  });

  const readWide = (ptr: unknown): string => {
    if (!ptr) return "";
    const buf = Buffer.alloc(512);
    const n = WideCharToMultiByte(65001, 0, ptr, -1, buf, buf.length, null, null) as number;
    if (n <= 0) return "";
    return buf.subarray(0, Math.max(0, n - 1)).toString("utf8");
  };

  const OpenProcessToken = adv().func(
    "int __stdcall OpenProcessToken(void *proc, uint32 access, _Out_ void **token)",
  );
  const DuplicateTokenEx = adv().func(
    "int __stdcall DuplicateTokenEx(void *token, uint32 access, void *attrs, int impLevel, int tokenType, _Out_ void **newToken)",
  );
  const SetTokenInformation = adv().func(
    "int __stdcall SetTokenInformation(void *token, int infoClass, const void *info, uint32 len)",
  );
  const GetCurrentProcess = k32().func("void *__stdcall GetCurrentProcess()");
  const GetLastError = k32().func("uint32 __stdcall GetLastError()");

  api = {
    enumerate: () => {
      const info: unknown[] = [null];
      const count: number[] = [0];
      if (!WTSEnumerateSessionsW(null, 0, 1, info, count)) return [];
      const result: { sessionId: number; stateCode: number; stationName: string }[] = [];
      try {
        const list = koffi.decode(
          info[0],
          koffi.array(SESSION_INFO, count[0]),
        ) as { SessionId: number; pWinStationName: unknown; State: number }[];
        for (const item of list) {
          result.push({
            sessionId: item.SessionId,
            stateCode: item.State,
            stationName: readWide(item.pWinStationName),
          });
        }
      } finally {
        WTSFreeMemory(info[0]);
      }
      return result;
    },

    childSessionsEnabled: () => {
      try {
        const enabled = [0];
        // 返回值表示「调用是否成功」，enabled[0] 才是开关状态。
        // 两者必须分开看：失败时 enabled 保持 0，会被误读成「未启用」。
        if (!WTSIsChildSessionsEnabled(enabled)) return false;
        return enabled[0] !== 0;
      } catch {
        // 旧系统（Windows 8 之前）没有这个导出：视为不支持，而不是抛错
        return false;
      }
    },

    childSessionId: () => {
      try {
        const sid = [0];
        if (!WTSGetChildSessionId(sid)) return undefined;
        return sid[0] >>> 0;
      } catch {
        return undefined;
      }
    },

    /**
     * 真试一次改会话 ID。
     *
     * 为什么用「真的调用」而不是「查令牌特权」：
     * 特权存在不等于调用会成功（可能还缺别的条件，比如目标会话不存在时
     * 行为也不确定）。试一次拿到确定的错误码，比推断更可靠，且不影响状态——
     * 我们复制的是当前进程令牌的副本，改它不影响本进程。
     */
    canChangeSession: () => {
      const token: unknown[] = [null];
      if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ACCESS, token)) {
        return { ok: false, error: GetLastError() };
      }
      const dup: unknown[] = [null];
      if (!DuplicateTokenEx(token[0], 0xf01ff, null, 1, 1, dup)) {
        return { ok: false, error: GetLastError() };
      }
      // 改成「当前会话」——这是最小侵入的探测：目标值合法，
      // 权限足够时就会成功，不够时拿到确定的错误码。
      const current: number[] = [0];
      const ProcessIdToSessionId = k32().func(
        "int __stdcall ProcessIdToSessionId(uint32 pid, _Out_ uint32 *sid)",
      );
      const GetCurrentProcessId = k32().func("uint32 __stdcall GetCurrentProcessId()");
      ProcessIdToSessionId(GetCurrentProcessId(), current);

      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(current[0], 0);
      const ok = SetTokenInformation(dup[0], TOKEN_SESSION_ID_CLASS, buf, 4) !== 0;
      if (ok) return { ok: true, error: 0 };

      // 失败时区分两种成因，否则「为什么不行」会被含糊成一句「权限不足」：
      // - 1300：令牌里根本没这条特权（管理员也不会自动拥有 SeTcbPrivilege，
      //   而且无法用 AdjustTokenPrivileges 加上——那是「启用已持有的特权」，
      //   不是「获取新特权」）
      // - 1314：声称有特权但实际不生效（组策略禁用等）
      return { ok: false, error: GetLastError() };
    },
  };

  return api;
}

/** Win32 会话相关错误码 → 人话。 */
const SESSION_ERRORS: Readonly<Record<number, string>> = {
  5: "拒绝访问（权限不足）",
  87: "参数错误",
  1300: "令牌未持有 SeTcbPrivilege（管理员身份也不自动具备，且无法用 AdjustTokenPrivileges 添加）",
  1314: "缺少所需特权（SeTcbPrivilege，仅 SYSTEM 账户具备）",
};

/**
 * 探测当前会话拓扑与跨会话能力。
 *
 * 这个函数不抛错：探测失败本身就是要报告的信息。
 * 调用方拿到的 `guidance` 可以直接给人和模型看。
 */
export function probeSessionTopology(): SessionTopology {
  const sessions = sessionApi().enumerate();
  const currentSessionId = currentSession();
  const enriched: SessionInfo[] = sessions.map((s) => ({
    sessionId: s.sessionId,
    stateCode: s.stateCode,
    state: WTS_CONNECT_STATE[s.stateCode] ?? `code=${s.stateCode}`,
    stationName: s.stationName,
    isCurrent: s.sessionId === currentSessionId,
    hasInteractiveDesktop: s.stateCode === 0,
  }));

  const childSessionsEnabled = sessionApi().childSessionsEnabled();
  const childRaw = sessionApi().childSessionId();
  // 0xFFFFFFFF 是「已启用但没有子会话」的哨兵值
  const childSessionId =
    childRaw === undefined || childRaw === 0xffffffff ? undefined : childRaw;

  const change = sessionApi().canChangeSession();
  const canChangeSession = change.ok;
  const sessionChangeBlocker = change.ok
    ? undefined
    : `SetTokenInformation(TokenSessionId) 失败，错误码 ${change.error}（${
        SESSION_ERRORS[change.error] ?? "未知"
      }）`;

  // 能操作别的会话的唯一合法途径：能在该会话内启动助手进程。
  // 判定条件 = 该会话存在且是 Active + 本进程能改会话 ID。
  const otherInteractive = enriched.filter(
    (s) => !s.isCurrent && s.hasInteractiveDesktop,
  );
  const crossSessionAvailable = canChangeSession && otherInteractive.length > 0;

  return {
    currentSessionId,
    sessions: enriched,
    childSessionsEnabled,
    childSessionId,
    canChangeSession,
    sessionChangeBlocker,
    crossSessionAvailable,
    guidance: buildGuidance({
      currentSessionId,
      sessions: enriched,
      childSessionsEnabled,
      childSessionId,
      canChangeSession,
      sessionChangeBlocker,
      crossSessionAvailable,
    }),
  };
}

function buildGuidance(input: {
  currentSessionId: number;
  sessions: SessionInfo[];
  childSessionsEnabled: boolean;
  childSessionId: number | undefined;
  canChangeSession: boolean;
  sessionChangeBlocker: string | undefined;
  crossSessionAvailable: boolean;
}): string {
  if (input.crossSessionAvailable) {
    const targets = input.sessions.filter(
      (s) => !s.isCurrent && s.hasInteractiveDesktop,
    );
    return (
      `可以操作其它会话。可用的交互会话: ${targets
        .map((s) => `#${s.sessionId}(${s.stationName})`)
        .join(", ")}。` + "助手会在目标会话内启动，需要该会话已登录。"
    );
  }

  const reasons: string[] = [];
  if (!input.canChangeSession) {
    reasons.push(input.sessionChangeBlocker ?? "无法把令牌切到目标会话");
  }
  const others = input.sessions.filter((s) => !s.isCurrent);
  if (others.length === 0) {
    reasons.push("系统里没有其它会话");
  } else {
    const interactive = others.filter((s) => s.hasInteractiveDesktop);
    if (interactive.length === 0) {
      reasons.push(
        `其它会话都没有可交互桌面（${others
          .map((s) => `#${s.sessionId} ${s.state}`)
          .join(", ")}）`,
      );
    }
  }

  // 子会话启用但尚未创建时，这不是「不可用」而是「还没建」。
  // 分开说，否则用户会以为这条路彻底堵死。
  const childHint = input.childSessionsEnabled
    ? input.childSessionId === undefined
      ? "系统已启用子会话但当前没有活动会话（可创建，但创建后仍需 SYSTEM 权限才能把助手放进去）"
      : `已存在子会话 #${input.childSessionId}`
    : "系统未启用子会话（需 WTSEnableChildSessions(TRUE)，该调用要求管理员）";
  reasons.push(childHint);

  return (
    "只能操作当前会话（Session " +
    input.currentSessionId +
    "）。原因: " +
    reasons.join("；") +
    "。把助手放进别的会话需要改令牌的会话 ID（SetTokenInformation(TokenSessionId)），" +
    "而这一步要求 SeTcbPrivilege —— 该特权只有 SYSTEM 账户持有，" +
    "即便管理员身份也无法通过 AdjustTokenPrivileges 获得（实测返回 1300）。" +
    "获取它的唯一现实途径是以 SYSTEM 运行一个外部进程并借用其令牌，" +
    "本实现不做这一步：那等于要求用户授权整机最高权限，" +
    "代价远大于「操作另一个桌面」的收益。如需操作其它会话的应用，" +
    "请在目标会话内直接运行本应用。"
  );
}

/**
 * 当前进程所在会话 ID。
 *
 * 优先用 kernel32 的 `ProcessIdToSessionId`；失败时回退到环境变量，
 * 最后兜底为 1。不抛错——这个值只用于展示与比较。
 */
export function currentSession(): number {
  try {
    const ProcessIdToSessionId = k32().func(
      "int __stdcall ProcessIdToSessionId(uint32 pid, _Out_ uint32 *sid)",
    );
    const GetCurrentProcessId = k32().func("uint32 __stdcall GetCurrentProcessId()");
    const sid = [0];
    if (ProcessIdToSessionId(GetCurrentProcessId(), sid)) return sid[0];
  } catch {
    // 落到下面的回退
  }
  const fromEnv = Number.parseInt(process.env.SESSIONNAME === "Console" ? "1" : "", 10);
  return Number.isInteger(fromEnv) ? fromEnv : 0;
}
