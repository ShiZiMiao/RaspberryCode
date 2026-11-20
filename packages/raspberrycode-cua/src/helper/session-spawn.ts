/**
 * 在指定会话内启动助手进程。
 *
 * 这是「RDP 备选方案」的执行层。关键取舍写在前面：
 *
 * **只做当前会话内的启动，不做越会话启动。**
 *
 * 越会话需要把令牌的 `TokenSessionId` 改成目标会话，那一步要求
 * `SeTcbPrivilege`（仅 SYSTEM 具备）。实测本机返回 1314（缺特权）。
 * 想做到就得把整个应用提到 SYSTEM —— 那意味着助手进程能对系统做任何事，
 * 为一个「操作另一个桌面」的需求付出这个代价不合理。
 *
 * 因此本模块的实际价值是：
 * 1. 复用当前用户的交互式令牌启动助手，避免令牌降权问题
 *    （子进程继承的是完整交互令牌，而不是受限的过滤令牌）
 * 2. 明确区分「会话不存在」「会话无桌面」「无权限进入」三种失败
 * 3. 为将来的 SYSTEM 路径留出清晰的接入点（`canChangeSession` 为 true 时走越会话分支）
 *
 * 实现细节：`CreateProcessAsUserW` 用带环境块的调用必须同时传
 * `CREATE_UNICODE_ENVIRONMENT`(0x400)，否则返回 87（参数错误）。
 * 这个坑实测踩过：env 非空但缺标志位 → 87；补上标志位 → 成功。
 */

import koffi from "koffi";
import { currentSession, probeSessionTopology } from "./session.ts";

/** 启动助手的结果。 */
export interface SpawnInSessionResult {
  ok: boolean;
  /** 成功时的进程 ID。 */
  processId?: number;
  /** 实际落入的会话 ID。 */
  sessionId?: number;
  /** 失败原因码。 */
  reason?:
    | "session_not_found"
    | "session_no_desktop"
    | "session_change_denied"
    | "token_unavailable"
    | "spawn_failed";
  /** 给人看的说明（含 Win32 错误码）。 */
  message: string;
}

let kernel32: koffi.IKoffiLib | undefined;
let advapi: koffi.IKoffiLib | undefined;
let userenv: koffi.IKoffiLib | undefined;

function k32() {
  kernel32 ??= koffi.load("kernel32.dll");
  return kernel32;
}
function adv() {
  advapi ??= koffi.load("advapi32.dll");
  return advapi;
}
function uenv() {
  userenv ??= koffi.load("userenv.dll");
  return userenv;
}

/** STARTUPINFOW，x64 上 104 字节。 */
const STARTUPINFO = koffi.struct("RD_SI", {
  cb: "uint32",
  lpReserved: "void*",
  lpDesktop: "char16_t*",
  lpTitle: "void*",
  dwX: "uint32",
  dwY: "uint32",
  dwXSize: "uint32",
  dwYSize: "uint32",
  dwXCountChars: "uint32",
  dwYCountChars: "uint32",
  dwFillAttribute: "uint32",
  dwFlags: "uint32",
  wShowWindow: "uint16",
  cbReserved2: "uint16",
  lpReserved2: "void*",
  hStdInput: "void*",
  hStdOutput: "void*",
  hStdError: "void*",
});

/** PROCESS_INFORMATION。 */
const PROCESS_INFO = koffi.struct("RD_PI", {
  hProcess: "void*",
  hThread: "void*",
  dwProcessId: "uint32",
  dwThreadId: "uint32",
});

const CREATE_UNICODE_ENVIRONMENT = 0x00000400;
const CREATE_NO_WINDOW = 0x08000000;
const STARTF_USESHOWWINDOW = 0x00000001;

interface SpawnApi {
  spawn: (input: {
    exePath: string;
    args: string[];
    sessionId: number | undefined;
  }) => { ok: boolean; error?: number; processId?: number };
}

let spawnApi: SpawnApi | undefined;

function getSpawnApi(): SpawnApi {
  if (spawnApi) return spawnApi;

  const GetCurrentProcess = k32().func("void *__stdcall GetCurrentProcess()");
  const GetLastError = k32().func("uint32 __stdcall GetLastError()");
  const OpenProcessToken = adv().func(
    "int __stdcall OpenProcessToken(void *proc, uint32 access, _Out_ void **token)",
  );
  const DuplicateTokenEx = adv().func(
    "int __stdcall DuplicateTokenEx(void *token, uint32 access, void *attrs, int impLevel, int tokenType, _Out_ void **newToken)",
  );
  const SetTokenInformation = adv().func(
    "int __stdcall SetTokenInformation(void *token, int infoClass, const void *info, uint32 len)",
  );
  const CreateEnvironmentBlock = uenv().func(
    "int __stdcall CreateEnvironmentBlock(_Out_ void **env, void *token, int inherit)",
  );
  const CreateProcessAsUserW = adv().func(
    "int __stdcall CreateProcessAsUserW(void *token, void *app, void *cmd, void *pa, void *ta, int inherit, uint32 flags, void *env, void *dir, void *si, void *pi)",
  );

  spawnApi = {
    spawn: ({ exePath, args, sessionId }) => {
      const token: unknown[] = [null];
      if (!OpenProcessToken(GetCurrentProcess(), 0x0002 | 0x0008 | 0x0001, token)) {
        return { ok: false, error: GetLastError() };
      }
      const dup: unknown[] = [null];
      if (!DuplicateTokenEx(token[0], 0xf01ff, null, 1, 1, dup)) {
        return { ok: false, error: GetLastError() };
      }

      // 目标会话与当前不同才改令牌。相同则跳过——
      // 少一次特权依赖，也让「同会话启动」在非 SYSTEM 下依然可用。
      if (sessionId !== undefined && sessionId !== currentSession()) {
        const buf = Buffer.alloc(4);
        buf.writeUInt32LE(sessionId, 0);
        // TokenSessionId = 12
        if (!SetTokenInformation(dup[0], 12, buf, 4)) {
          return { ok: false, error: GetLastError() };
        }
      }

      const envBlock: unknown[] = [null];
      const hasEnv = CreateEnvironmentBlock(envBlock, dup[0], 0) !== 0;

      const si = Buffer.alloc(koffi.sizeof(STARTUPINFO));
      koffi.encode(si, STARTUPINFO, {
        cb: koffi.sizeof(STARTUPINFO),
        lpReserved: null,
        // 交互式桌面。不指定会落到当前进程的窗口站，
        // 在服务/别会话场景下常常是没有桌面的那个。
        lpDesktop: "winsta0\\default",
        lpTitle: null,
        dwX: 0,
        dwY: 0,
        dwXSize: 0,
        dwYSize: 0,
        dwXCountChars: 0,
        dwYCountChars: 0,
        dwFillAttribute: 0,
        dwFlags: STARTF_USESHOWWINDOW,
        wShowWindow: 1,
        cbReserved2: 0,
        lpReserved2: null,
        hStdInput: null,
        hStdOutput: null,
        hStdError: null,
      });

      const pi = Buffer.alloc(koffi.sizeof(PROCESS_INFO));
      const appBuf = Buffer.from(`${exePath}\0`, "utf16le");
      const cmdBuf = Buffer.from(
        `${quoteIfNeeded(exePath)} ${args.join(" ")}\0`,
        "utf16le",
      );

      // 带环境块时必须同时给 CREATE_UNICODE_ENVIRONMENT，
      // 否则参数组合非法 → 87。这个坑实测踩过。
      const flags = CREATE_NO_WINDOW | (hasEnv ? CREATE_UNICODE_ENVIRONMENT : 0);

      const ok = CreateProcessAsUserW(
        dup[0],
        appBuf,
        cmdBuf,
        null,
        null,
        0,
        flags,
        hasEnv ? envBlock[0] : null,
        null,
        si,
        pi,
      );
      if (!ok) return { ok: false, error: GetLastError() };

      const info = koffi.decode(pi, PROCESS_INFO) as {
        hProcess: unknown;
        dwProcessId: number;
      };
      return { ok: true, processId: info.dwProcessId };
    },
  };

  return spawnApi;
}

function quoteIfNeeded(path: string): string {
  return path.includes(" ") ? `"${path}"` : path;
}

/** Win32 错误码 → 可操作的说明。 */
function describeSpawnError(code: number): string {
  switch (code) {
    case 2:
      return "找不到可执行文件（错误码 2）";
    case 5:
      return "拒绝访问（错误码 5）：目标会话的窗口站不允许该令牌进入";
    case 87:
      return "参数错误（错误码 87）：通常发生在带环境块却缺少 CREATE_UNICODE_ENVIRONMENT 时";
    case 1314:
      return "缺少所需特权（错误码 1314，SeTcbPrivilege）：改令牌会话 ID 需要以 SYSTEM 运行";
    case 1930:
      return "安全策略阻止该会话内的进程启动（错误码 1930）";
    default:
      return `启动失败，错误码 ${code}`;
  }
}

/**
 * 在指定会话内启动助手进程。
 *
 * `sessionId` 省略时用当前会话。传别的会话会先改令牌再启动，
 * 而这一步在没有 SYSTEM 权限时必然失败——此时返回
 * `session_change_denied`，而不是一个含糊的「启动失败」。
 */
export function spawnHelperInSession(input: {
  exePath: string;
  args?: string[];
  sessionId?: number;
}): SpawnInSessionResult {
  const topology = probeSessionTopology();
  const targetSessionId = input.sessionId ?? topology.currentSessionId;

  // 目标会话必须存在。不在列表里说明号码错了，或者该会话已销毁。
  const target = topology.sessions.find((s) => s.sessionId === targetSessionId);
  if (!target) {
    return {
      ok: false,
      reason: "session_not_found",
      message:
        `会话 ${targetSessionId} 不存在。当前可见会话: ` +
        (topology.sessions.map((s) => `#${s.sessionId}(${s.state})`).join(", ") || "无"),
    };
  }

  if (!target.hasInteractiveDesktop && targetSessionId !== topology.currentSessionId) {
    return {
      ok: false,
      sessionId: targetSessionId,
      reason: "session_no_desktop",
      message:
        `会话 ${targetSessionId} 当前状态是 ${target.state}，没有可交互桌面。` +
        "只有 Active 状态的会话才能承载 UI 自动化；请先在该会话登录。",
    };
  }

  const attempt = getSpawnApi().spawn({
    exePath: input.exePath,
    args: input.args ?? [],
    sessionId: targetSessionId,
  });

  if (attempt.ok && attempt.processId !== undefined) {
    return {
      ok: true,
      processId: attempt.processId,
      sessionId: targetSessionId,
      message: `助手已在会话 ${targetSessionId} 内启动（pid=${attempt.processId}）`,
    };
  }

  const code = attempt.error ?? 0;
  // 1314 是「改会话 ID 被拒」，与「进程起不来」是两件事，
  // 分开报告才能让用户知道该做什么。
  const isSessionChange = code === 1314;
  return {
    ok: false,
    sessionId: targetSessionId,
    reason: isSessionChange ? "session_change_denied" : "spawn_failed",
    message:
      describeSpawnError(code) +
      (isSessionChange
        ? `。本实现不做 SYSTEM 提权，因此无法把助手放进会话 ${targetSessionId}。` +
          "请在目标会话内直接运行本应用。"
        : ""),
  };
}
