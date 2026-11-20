/**
 * 用 RDP ActiveX 控件建立子会话。
 *
 * ## 为什么用系统自带的 `MsRdpClient`
 *
 * 建立子会话需要在命名管道上跑完整 RDP 协议（X.224 协商、MCS 通道加入、
 * 安全交换、能力协商）。那是数万行代码。`MsRdpClient` 是系统自带的完整实现，
 * 且**原生支持子会话**（`IMsRdpExtendedSettings.ConnectToChildSession`）。
 *
 * ## 宿主方式：ATL，不是自己写 OLE 容器
 *
 * `MsRdpClient` 是 OLE 控件。只 `CoCreateInstance` 拿到的对象只完成 COM 层
 * 实例化：设 `DesktopWidth` 会返回 `E_UNEXPECTED`，`Connect` 也不会真正推进。
 *
 * 正确做法是让 **ATL 的 `AtlAxWin` 宿主窗口**替我们完成 OLE 初始化：
 *
 * ```
 * OleInitialize
 *   → atl.dll + AtlAxWinInit()          注册 "AtlAxWin" 窗口类
 *   → CreateWindowExW(0, "AtlAxWin", "<CLSID>", ...)
 *         窗口名传 CLSID，ATL 内部完成 CoCreateInstance + 建站点 + DoVerb
 *   → AtlAxGetControl(hwnd, &pUnk)      取回「已初始化」的控件
 * ```
 *
 * 这样不需要写 `IOleClientSite`/`IOleInPlaceSite`/`IStorage`，
 * 也不需要 C++ 或 GUI 框架——ATL 把整套 OLE 宿主封装成一个窗口类。
 * 这是 WorkBuddy 的做法（其二进制导入 `atl.dll` 与 `AtlAxWinInit`）。
 *
 * ## 实测验证的完整调用序列（2026-11-19，Windows 11 家庭版）
 *
 * | 步骤 | 结果 |
 * | --- | --- |
 * | `OleInitialize` | `0x0` |
 * | `atl.dll` + `AtlAxWinInit` | 成功 |
 * | `CreateWindowExW("AtlAxWin", CLSID_MsRdpClient9)` | hwnd 有效 |
 * | `AtlAxGetControl` | `0x0`，拿到控件 |
 * | `IMsTscAx.put_Server("localhost")`（vtable[7]） | `0x0` |
 * | `IMsTscAx.put_Domain("")`（vtable[9]） | `0x0` |
 * | `IMsTscAx.put_UserName(name)`（vtable[11]） | `0x0` |
 * | `put_Property("ConnectToChildSession", TRUE)` | `0x0` |
 * | `IMsTscNonScriptable.put_ClearTextPassword(pwd)`（vtable[3]） | `0x0` |
 * | `IDispatch::Invoke(Connect, DISPATCH_METHOD)` | **`0x0`** |
 * | 之后 `Connected` | **2（connecting）** |
 * | `ExtendedDisconnectReason` | `0（无错误）` |
 *
 * **`Server` 是 Connect 前必须设置的唯一属性**（MSDN 明确说明）。
 * 漏设它时 `Connect()` 返回 `DISP_E_EXCEPTION` + `scode=0x80070057`（E_INVALIDARG）——
 * 那个错误信息完全不提「缺 Server」，是本模块最耗时的一个坑。
 *
 * ## vtable 索引全部有文档依据
 *
 * `IMsTscAx` 是双接口，vtable 布局为
 * `0-2 IUnknown` + `3-6 IDispatch` + `7起 IMsTscAx 方法`。
 * 方法顺序取 MSDN 的 `IMsTscAx` 页（明确列出 vtable 顺序）：
 * `7=put_Server, 8=get_Server, 9=put_Domain, 10=get_Domain, 11=put_UserName`。
 *
 * **不是猜的**。本规格在猜索引上栽过多次（`0xC0000005` 崩进程，连错误码都没有），
 * 因此每个索引都必须有依据。
 *
 * ## 消息泵是必需的（实测确认）
 *
 * RDP 控件是异步的，靠向宿主窗口投递消息推进状态机。**不抽消息时
 * `Connected` 永远停在 2（connecting）**，即使等 60 秒也不变。
 * 抽消息后才会在约 17 秒走到终态。
 *
 * 这不是「等久一点就行」，是事件循环问题：消息不处理就不会有新消息产生。
 *
 * ## 关键认知：子会话由计划任务创建，不由本模块创建
 *
 * 实测确认（2026-11-19，观察 WorkBuddy 运行后的系统状态）：
 *
 * - 计划任务 `wincua-child-host-autorun`，主体 `lecoo`、`LogonType=Interactive`、
 *   `RunLevel=Limited`（**不是 SYSTEM**）
 * - 动作：`conhost.exe --headless <workbuddy-cu.exe> --child-host-launcher`
 * - 触发器：**登录时** + `MSFT_TaskSessionStateChangeTrigger`（`StateChange=3`）
 * - 运行后子会话 #6 出现，`workbuddy-cu-child-host` 进程跑在 `SessionId=6`
 * - **3389 始终未监听**，会话的 `ClientProtocolType=0`（非 RDP 协议）
 *
 * 也就是说：**子会话是靠「在会话里跑起一个进程」创建的，不是靠 RDP 登录。**
 * 计划任务的 SessionStateChange 触发器会在会话状态变化时把 host 拉进去，
 * 会话因此存在。
 *
 * 本模块的 `ConnectToChildSession` 只是「连到一个已存在的子会话」，
 * 它**不负责创建**。会话不存在时它连不上（实测 17 秒超时后 `Connected=0`，
 * `ExtendedDisconnectReason=0` 无错误）。
 *
 * 因此本模块的定位是：**会话已存在时，提供一个可用的 RDP 控件连接**。
 * 创建会话的工作属于计划任务那一层（见 `child-session-task.ts`）。
 *
 * ## 复用已有会话时必须区分归属
 *
 * 若调用前会话已存在，本模块返回 `reason: "session_preexisting"` 而
 * 不是 `ok: true`——那个会话是别人建的，清理时不该当作本实现的产物注销。
 */

import koffi from "koffi";

/** 建立子会话所需的一切。 */
export interface ChildSessionRequest {
  /** 账户名。 */
  username: string;
  /**
   * 明文密码。允许空串（仅当 `LimitBlankPasswordUse = 0` 时可能成功）。
   *
   * 空串不代表「跳过认证」——RDP 握手仍要走完，只是密码字段为空。
   */
  password: string;
  /** 域名。本地账户传空串或省略。 */
  domain?: string;
  /** 桌面宽度。 */
  width: number;
  /** 桌面高度。 */
  height: number;
}

/** 建立结果。 */
export interface ChildSessionResult {
  ok: boolean;
  /** 子会话号（仅在确认真实建立时给出）。 */
  sessionId?: number;
  /** 控件连接状态（0=断开 1=已连 2=连接中）。 */
  connectionState?: number;
  reason?:
    | "unsupported_platform"
    | "atl_unavailable"
    | "ax_unavailable"
    | "property_failed"
    | "connect_rejected"
    /** Connect 已发出，但连接未在超时内完成。 */
    | "connect_pending"
    /**
     * 调用前已存在子会话，本次未新建。
     *
     * 与「成功」的区别：会话可用，但不是本次创建的。
     * 上层若把它当成自己的产物，清理时会误删别人的会话。
     */
    | "session_preexisting";
  /** 给人看的说明，必须能指出停在哪一步。 */
  message: string;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/**
 * `CLSID_MsRdpClient9`。
 *
 * 选 9 而不是 10：WorkBuddy 用的就是 9（二进制里读到的 CLSID），
 * 且 9 已足够支持 `IMsRdpExtendedSettings`。与验证过的一致更稳。
 */
const CLSID_MS_RDP_CLIENT = "{8B918B82-7985-4C24-89DF-C33AD2BBFBCD}";

const IID_IDISPATCH = "00020400-0000-0000-C000-000000000046";
const IID_IMsTscAx = "8C11EFAE-92C3-11D1-BC1E-00C04FA31489";
const IID_IMsTscNonScriptable = "c1e6743a-41c1-4a74-832a-0dd06c1c7a0e";
const IID_IMsRdpExtendedSettings = "302D8188-0052-4807-806A-362B628F9AC5";

/** `IMsTscAx` 的 vtable 位置（基址 7 = IUnknown 3 + IDispatch 4）。 */
const AX_VT_PUT_SERVER = 7;
const AX_VT_PUT_DOMAIN = 9;
const AX_VT_PUT_USERNAME = 11;

/** `IMsTscNonScriptable::put_ClearTextPassword` 的 vtable 位置。 */
const NS_VT_PUT_CLEARTEXT_PASSWORD = 3;

/** `IMsRdpExtendedSettings`：get_Property 在 3、put_Property 在 4。 */
const EXT_VT_PUT_PROPERTY = 4;

/** IDispatch 虚表位置。 */
const DISPATCH_VT_GET_IDS_OF_NAMES = 5;
const DISPATCH_VT_INVOKE = 6;

const DISPATCH_METHOD = 0x0001;
const DISPATCH_PROPERTYGET = 0x0002;

const VT_BOOL = 11;
const LCID_EN_US = 0x0409;

const CONNECT_STATE_DISCONNECTED = 0;
const CONNECT_STATE_CONNECTED = 1;

/**
 * 等连接完成的时长。
 *
 * 30 秒：RDP 握手通常数秒内完成，超过这个量级说明认证卡住了。
 * 更长等待对用户没帮助——不如早点说清「连接没完成」。
 */
const CONNECT_TIMEOUT_MS = 30_000;

/** 轮询间隔。用同步等待保持本函数的同步语义。 */
const POLL_INTERVAL_MS = 250;

// ---------------------------------------------------------------------------
// GUID 与结构
// ---------------------------------------------------------------------------

/**
 * GUID 字符串 → COM 字节序。
 *
 * 前三个字段 little-endian，后两个原序。直接 `Buffer.from(hex)` 会得到
 * 「看起来对但 QI 永远 E_NOINTERFACE」的地址，而错误码不指向根因。
 */
function guid(text: string): Buffer {
  const hex = text.replace(/-/g, "");
  if (hex.length !== 32) throw new Error(`GUID 长度不对: ${text}`);
  const b = Buffer.from(hex, "hex");
  return Buffer.concat([
    Buffer.from([b[3], b[2], b[1], b[0]]),
    Buffer.from([b[5], b[4]]),
    Buffer.from([b[7], b[6]]),
    b.subarray(8),
  ]);
}

/** VARIANT（x64 = 24 字节）。 */
const VARIANT = koffi.struct("Rdp3Variant", {
  vt: "uint16",
  reserved1: "uint16",
  reserved2: "uint32",
  value: "uint64",
});

/**
 * `MSG`（x64 = 48 字节）。
 *
 * 用于从线程消息队列取消息。RDP 控件是异步的：它靠向宿主窗口投递
 * 消息来推进连接，不处理消息就永远停在「连接中」。
 */
const MSG = koffi.struct("Rdp3Msg", {
  hwnd: "void *",
  message: "uint32",
  pad0: "uint32",
  wParam: "uint64",
  lParam: "uint64",
  time: "uint32",
  ptX: "int32",
  ptY: "int32",
  lPrivate: "uint32",
});

/** DISPPARAMS。 */
const DISPPARAMS = koffi.struct("Rdp3DispParams", {
  rgvarg: "void *",
  rgdispidNamedArgs: "void *",
  cArgs: "uint32",
  cNamedArgs: "uint32",
});

/**
 * 固定声明一次。
 *
 * `koffi.struct` / `koffi.proto` 按名字全局注册，在函数里重复定义会抛
 * `Duplicate type name`。全部提到模块级。
 */
const P_QUERY_INTERFACE = koffi.proto("long __stdcall Rdp3Qi(void *s, const void *iid, _Out_ void **out)");
const P_GET_IDS_OF_NAMES = koffi.proto(
  "long __stdcall Rdp3GetIds(void *s, const void *riid, void *names, uint32 count, uint32 lcid, void *ids)",
);
const P_INVOKE = koffi.proto(
  "long __stdcall Rdp3Invoke(void *s, int32 id, const void *riid, uint32 lcid, uint16 flags, const void *params, void *result, void *exceptInfo, void *argErr)",
);
const P_PUT_BSTR = koffi.proto("long __stdcall Rdp3PutBstr(void *s, void *value)");
const P_PUT_PROPERTY = koffi.proto("long __stdcall Rdp3PutProp(void *s, void *name, const void *value)");

/** 取 COM 对象虚表第 index 项。 */
function vtableEntry(comObject: unknown, index: number): unknown {
  const vtable = koffi.decode(comObject as never, "void *");
  const table = koffi.decode(vtable as never, koffi.array("void *", index + 1));
  return table[index];
}

// ---------------------------------------------------------------------------
// 运行时
// ---------------------------------------------------------------------------

interface RdpRuntime {
  user32: koffi.IKoffiLib;
  atl: koffi.IKoffiLib;
  wtsapi: koffi.IKoffiLib;
  /** user32 的消息泵函数。RDP 控件依赖它们推进状态机。 */
  user32PeekMessage: (msg: unknown, hwnd: unknown, min: number, max: number, remove: number) => number;
  user32TranslateMessage: (msg: unknown) => number;
  user32DispatchMessage: (msg: unknown) => unknown;
  allocBstr: (text: string) => unknown;
  freeBstr: (bstr: unknown) => void;
}

let runtime: RdpRuntime | undefined;
let runtimeError: string | undefined;

function getRuntime(): RdpRuntime | undefined {
  if (runtime) return runtime;
  if (runtimeError) return undefined;

  try {
    const ole32 = koffi.load("ole32.dll");
    const atl = koffi.load("atl.dll");
    const oleaut32 = koffi.load("oleaut32.dll");
    const user32 = koffi.load("user32.dll");
    const wtsapi = koffi.load("wtsapi32.dll");

    // OleInitialize 返回 0x80010106 表示该线程已初始化过——那不是失败。
    const hrOle = ole32.func("long __stdcall OleInitialize(void *p)")(null) as number;
    if ((hrOle >>> 0) !== 0 && (hrOle >>> 0) !== 0x80010106) {
      runtimeError = `OleInitialize 失败（0x${(hrOle >>> 0).toString(16)}）`;
      return undefined;
    }

    // AtlAxWinInit 注册 "AtlAxWin" 窗口类；重复调用安全。
    const atlInit = atl.func("int __stdcall AtlAxWinInit()") as () => number;
    if (atlInit() === 0) {
      runtimeError = "AtlAxWinInit 失败（atl.dll 可能版本过旧）";
      return undefined;
    }

    const SysAllocString = oleaut32.func("void *__stdcall SysAllocString(const char16_t *s)");
    const SysFreeString = oleaut32.func("void __stdcall SysFreeString(void *b)");

    runtime = {
      user32,
      atl,
      wtsapi,
      user32PeekMessage: user32.func(
        "int __stdcall PeekMessageW(void *msg, void *hwnd, uint32 min, uint32 max, uint32 remove)",
      ) as never,
      user32TranslateMessage: user32.func(
        "int __stdcall TranslateMessage(const void *msg)",
      ) as never,
      user32DispatchMessage: user32.func(
        "void *__stdcall DispatchMessageW(const void *msg)",
      ) as never,
      allocBstr: (text) => SysAllocString(text),
      freeBstr: (bstr) => SysFreeString(bstr as never),
    };
    return runtime;
  } catch (error) {
    runtimeError = `加载 ATL/OLE 运行时失败：${error instanceof Error ? error.message : String(error)}`;
    return undefined;
  }
}

/** 创建一个承载控件的 ATL 宿主窗口。 */
function createHostWindow(rt: RdpRuntime, width: number, height: number): unknown | undefined {
  const CreateWindowExW = rt.user32.func(
    "void *__stdcall CreateWindowExW(uint32 exStyle, const char16_t *cls, const char16_t *name, uint32 style, int x, int y, int w, int h, void *parent, void *menu, void *inst, void *param)",
  );
  // WS_POPUP：不显示在任务栏，也不抢焦点。
  // 控件在隐藏/不可见窗口里同样能工作，不需要真的显示出来。
  const hwnd = CreateWindowExW(
    0,
    "AtlAxWin",
    CLSID_MS_RDP_CLIENT,
    0x80000000,
    0,
    0,
    width,
    height,
    null,
    null,
    null,
    null,
  );
  return hwnd ?? undefined;
}

/** 从宿主窗口取回已初始化的控件。 */
function getControlFromHost(rt: RdpRuntime, hwnd: unknown): unknown | undefined {
  const AtlAxGetControl = rt.atl.func(
    "long __stdcall AtlAxGetControl(void *hwnd, _Out_ void **ppUnk)",
  );
  const out: unknown[] = [null];
  const hr = AtlAxGetControl(hwnd, out) as number;
  return (hr >>> 0) === 0 && out[0] ? out[0] : undefined;
}

/** QI 到指定接口。 */
function queryInterface(obj: unknown, iid: string): unknown | undefined {
  const out: unknown[] = [null];
  const hr = koffi.call(
    vtableEntry(obj, 0) as never,
    P_QUERY_INTERFACE,
    obj,
    guid(iid),
    out,
  ) as number;
  return (hr >>> 0) === 0 && out[0] ? out[0] : undefined;
}

/** 通过 `IDispatch` 解析 DISPID。名字写错只返回 undefined，不会崩。 */
function dispatchId(rt: RdpRuntime, dispatch: unknown, name: string): number | undefined {
  const str = rt.allocBstr(name);
  const holder = koffi.alloc("void *", 1);
  koffi.encode(holder, "void *", str);
  const ids = koffi.alloc("int32", 1);
  try {
    const hr = koffi.call(
      vtableEntry(dispatch, DISPATCH_VT_GET_IDS_OF_NAMES) as never,
      P_GET_IDS_OF_NAMES,
      dispatch,
      null,
      holder,
      1,
      LCID_EN_US,
      ids,
    ) as number;
    if ((hr >>> 0) !== 0) return undefined;
    return koffi.decode(ids, "int32") as number;
  } finally {
    rt.freeBstr(str);
    koffi.free(holder);
    koffi.free(ids);
  }
}

/** 通过 `IDispatch` 调用无参方法或读无参属性。 */
function invokeNoArgs(dispatch: unknown, dispId: number, flags: number): number {
  const params = koffi.alloc("uint8", koffi.sizeof(DISPPARAMS));
  koffi.encode(params, DISPPARAMS, {
    rgvarg: null,
    rgdispidNamedArgs: null,
    cArgs: 0,
    cNamedArgs: 0,
  });
  const argErr = koffi.alloc("uint32", 1);
  const result = koffi.alloc("uint8", koffi.sizeof(VARIANT));
  try {
    return koffi.call(
      vtableEntry(dispatch, DISPATCH_VT_INVOKE) as never,
      P_INVOKE,
      dispatch,
      dispId,
      null,
      LCID_EN_US,
      flags,
      params,
      result,
      null,
      argErr,
    ) as number;
  } finally {
    koffi.free(params);
    koffi.free(argErr);
    koffi.free(result);
  }
}

/** 读一个整数型属性（如 `Connected`）。失败返回 -1。 */
function readIntProperty(rt: RdpRuntime, dispatch: unknown, name: string): number {
  const id = dispatchId(rt, dispatch, name);
  if (id === undefined) return -1;

  const params = koffi.alloc("uint8", koffi.sizeof(DISPPARAMS));
  koffi.encode(params, DISPPARAMS, {
    rgvarg: null,
    rgdispidNamedArgs: null,
    cArgs: 0,
    cNamedArgs: 0,
  });
  const argErr = koffi.alloc("uint32", 1);
  const result = koffi.alloc("uint8", koffi.sizeof(VARIANT));
  try {
    const hr = koffi.call(
      vtableEntry(dispatch, DISPATCH_VT_INVOKE) as never,
      P_INVOKE,
      dispatch,
      id,
      null,
      LCID_EN_US,
      DISPATCH_PROPERTYGET,
      params,
      result,
      null,
      argErr,
    ) as number;
    if ((hr >>> 0) !== 0) return -1;
    const decoded = koffi.decode(result, VARIANT) as { value: bigint };
    return Number(decoded.value);
  } finally {
    koffi.free(params);
    koffi.free(argErr);
    koffi.free(result);
  }
}

/** 通过 `IMsTscAx` 虚表设置 BSTR 属性。 */
function putAxString(rt: RdpRuntime, ax: unknown, vtableIndex: number, value: string): number {
  const bstr = rt.allocBstr(value);
  try {
    return koffi.call(
      vtableEntry(ax, vtableIndex) as never,
      P_PUT_BSTR,
      ax,
      bstr,
    ) as number;
  } finally {
    rt.freeBstr(bstr);
  }
}

/** 通过 `IMsTscNonScriptable` 的虚表注入明文密码。 */
function putClearTextPassword(rt: RdpRuntime, nonScriptable: unknown, password: string): number {
  const bstr = rt.allocBstr(password);
  try {
    return koffi.call(
      vtableEntry(nonScriptable, NS_VT_PUT_CLEARTEXT_PASSWORD) as never,
      P_PUT_BSTR,
      nonScriptable,
      bstr,
    ) as number;
  } finally {
    rt.freeBstr(bstr);
  }
}

/** 设置 `IMsRdpExtendedSettings` 的布尔具名属性。 */
function putExtendedBool(rt: RdpRuntime, extended: unknown, name: string, value: boolean): number {
  const nameBstr = rt.allocBstr(name);
  const variant = Buffer.alloc(koffi.sizeof(VARIANT), 0);
  koffi.encode(variant, VARIANT, {
    vt: VT_BOOL,
    reserved1: 0,
    reserved2: 0,
    value: value ? 0xffffffffffffffffn : 0n,
  });
  try {
    return koffi.call(
      vtableEntry(extended, EXT_VT_PUT_PROPERTY) as never,
      P_PUT_PROPERTY,
      extended,
      nameBstr,
      variant,
    ) as number;
  } finally {
    rt.freeBstr(nameBstr);
  }
}

/** 查子会话号。`0xFFFFFFFF` 表示已启用但无会话。 */
function probeChildSessionId(rt: RdpRuntime): number | undefined {
  const WTSGetChildSessionId = rt.wtsapi.func(
    "int __stdcall WTSGetChildSessionId(_Out_ uint32 *sid)",
  );
  const sid = [0];
  if (!WTSGetChildSessionId(sid)) return undefined;
  return sid[0] === 0xffffffff ? undefined : sid[0];
}

/**
 * 抽干线程消息队列。
 *
 * **这一步不能省。** RDP 控件是异步的，靠向宿主窗口投递消息推进状态机。
 * 实测：不抽消息时 `Connected` 永远停在 2（connecting），
 * 抽消息后才会在约 17 秒走到终态（0 或 1）。
 *
 * 为什么不是「等一会儿再查」就行：消息不处理就不会有新的消息产生，
 * 状态机停在原地。这不是时间问题，是事件循环问题。
 */
function pumpMessages(rt: RdpRuntime): number {
  const msgBuffer = koffi.alloc("uint8", koffi.sizeof(MSG));
  try {
    let count = 0;
    // PM_REMOVE = 1
    while (rt.user32PeekMessage(msgBuffer, null, 0, 0, 1) !== 0) {
      rt.user32TranslateMessage(msgBuffer);
      rt.user32DispatchMessage(msgBuffer);
      count += 1;
      // 上限防止某个窗口持续灌消息时卡死在这里
      if (count > 1000) break;
    }
    return count;
  } finally {
    koffi.free(msgBuffer);
  }
}

/**
 * 同步等待。
 *
 * 用 `Atomics.wait` 而不是忙等：后者会占满一个 CPU 核。
 * 只在消息泵抽干后短暂停一下，让 native 侧有机会投递新消息。
 */
function sleepSync(ms: number): void {
  const shared = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(shared), 0, 0, ms);
}

/**
 * 建立子会话。
 *
 * 流程严格按实测验证过的顺序：
 * 1. ATL 宿主窗口（完成 OLE 初始化）
 * 2. `Server` → `Domain` → `UserName`
 * 3. `ConnectToChildSession` = TRUE
 * 4. 注入密码
 * 5. `Connect()`
 * 6. 等 `Connected` 变 1，或子会话号出现
 *
 * `Server` 必须在 `Connect` 之前设置；密码必须在未连接状态设。
 */
export function createChildSession(request: ChildSessionRequest): ChildSessionResult {
  if (process.platform !== "win32") {
    return { ok: false, reason: "unsupported_platform", message: "子会话只在 Windows 上可用。" };
  }

  const rt = getRuntime();
  if (!rt) {
    return {
      ok: false,
      reason: "atl_unavailable",
      message: runtimeError ?? "无法初始化 ATL/OLE 运行时。",
    };
  }

  /**
   * 记录调用前的会话基线。
   *
   * 没有这个基线，「成功」可能是复用了别人已经建好的子会话——
   * 实测过：会话本来就存在时，本函数 0.3 秒就返回成功，
   * 而实际上一次连接都没建立。那种「成功」是有害的：
   * 上层会以为拿到的是自己创建的资源。
   */
  const baselineChildSessionId = probeChildSessionId(rt);

  // ---- 1. 宿主窗口 ----
  const hwnd = createHostWindow(rt, request.width, request.height);
  if (!hwnd) {
    return {
      ok: false,
      reason: "ax_unavailable",
      message:
        "创建 AtlAxWin 宿主窗口失败。可能 atl.dll 版本过旧（不支持 AtlAxWin 窗口类）。",
    };
  }

  const control = getControlFromHost(rt, hwnd);
  if (!control) {
    return {
      ok: false,
      reason: "ax_unavailable",
      message:
        `AtlAxGetControl 未能取回控件。${CLSID_MS_RDP_CLIENT} 可能未注册` +
        "（检查 mstscax.dll 是否完整）。",
    };
  }

  const dispatch = queryInterface(control, IID_IDISPATCH);
  const tscAx = queryInterface(control, IID_IMsTscAx);
  if (!dispatch || !tscAx) {
    return { ok: false, reason: "ax_unavailable", message: "控件不支持 IDispatch / IMsTscAx。" };
  }

  // ---- 2. Server / Domain / UserName ----
  //
  // `Server` 是 Connect 前必须设置的唯一属性（MSDN 明确说明）。
  // 漏设它时 Connect 返回 E_INVALIDARG，而错误信息不提缺哪个属性——
  // 这是本模块最耗时的一个坑。
  const hrServer = putAxString(rt, tscAx, AX_VT_PUT_SERVER, "localhost");
  if ((hrServer >>> 0) !== 0) {
    return {
      ok: false,
      reason: "property_failed",
      message: `设置 Server 失败（0x${(hrServer >>> 0).toString(16)}）。`,
    };
  }

  const hrDomain = putAxString(rt, tscAx, AX_VT_PUT_DOMAIN, request.domain ?? "");
  if ((hrDomain >>> 0) !== 0) {
    return {
      ok: false,
      reason: "property_failed",
      message: `设置 Domain 失败（0x${(hrDomain >>> 0).toString(16)}）。`,
    };
  }

  const hrUser = putAxString(rt, tscAx, AX_VT_PUT_USERNAME, request.username);
  if ((hrUser >>> 0) !== 0) {
    return {
      ok: false,
      reason: "property_failed",
      message: `设置 UserName 失败（0x${(hrUser >>> 0).toString(16)}）。`,
    };
  }

  // ---- 3. 子会话模式 ----
  const extended = queryInterface(control, IID_IMsRdpExtendedSettings);
  if (!extended) {
    return {
      ok: false,
      reason: "ax_unavailable",
      message: "控件不支持 IMsRdpExtendedSettings，无法开启子会话模式。",
    };
  }
  const hrMode = putExtendedBool(rt, extended, "ConnectToChildSession", true);
  if ((hrMode >>> 0) !== 0) {
    return {
      ok: false,
      reason: "property_failed",
      message:
        `设置 ConnectToChildSession 失败（0x${(hrMode >>> 0).toString(16)}）。` +
        "该属性要求 Windows 8+ 且控件版本足够新。",
    };
  }

  // ---- 4. 密码 ----
  const nonScriptable = queryInterface(control, IID_IMsTscNonScriptable);
  if (!nonScriptable) {
    return {
      ok: false,
      reason: "ax_unavailable",
      message: "控件不支持 IMsTscNonScriptable，无法注入密码。",
    };
  }
  const hrPassword = putClearTextPassword(rt, nonScriptable, request.password);
  if ((hrPassword >>> 0) !== 0) {
    return {
      ok: false,
      reason: "property_failed",
      message:
        `注入密码失败（0x${(hrPassword >>> 0).toString(16)}）。` +
        "该属性只能在未连接状态设置。",
    };
  }

  // ---- 5. 连接 ----
  const connectId = dispatchId(rt, dispatch, "Connect");
  if (connectId === undefined) {
    return { ok: false, reason: "ax_unavailable", message: "找不到 Connect 方法。" };
  }
  const hrConnect = invokeNoArgs(dispatch, connectId, DISPATCH_METHOD);
  if ((hrConnect >>> 0) !== 0) {
    return {
      ok: false,
      reason: "connect_rejected",
      message:
        `Connect() 被拒绝（0x${(hrConnect >>> 0).toString(16)}）。` +
        "若为 0x80020009 且内层 scode 为 0x80070057，通常是 Server 未设置。",
    };
  }

  // ---- 6. 等连接完成 ----
  //
  // Connect 返回成功只代表「请求已接受」。真正的建立要看
  // `Connected` 变成 1，或子会话号出现。两者都查：
  // 子会话号是外部可观测的事实，`Connected` 是控件内部状态。
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  let state = -1;
  let childSessionId: number | undefined;

  while (Date.now() < deadline) {
    const current = probeChildSessionId(rt);
    // 只接受「与基线不同」的会话号。
    // 基线已存在且没变化 → 那是别人的会话，不算本次成果。
    if (current !== undefined && current !== baselineChildSessionId) {
      childSessionId = current;
      break;
    }

    state = readIntProperty(rt, dispatch, "Connected");
    if (state === CONNECT_STATE_CONNECTED) break;
    if (state === CONNECT_STATE_DISCONNECTED) {
      return {
        ok: false,
        reason: "connect_rejected",
        connectionState: state,
        message:
          "连接被断开（Connected 回到 0）。常见原因：凭据错误、" +
          "空密码不被允许、或子会话未能建立。",
      };
    }
    // **先抽消息再等**：RDP 控件的状态机靠窗口消息推进，
    // 不抽消息它会永远停在 connecting（实测确认）。
    pumpMessages(rt);
    sleepSync(POLL_INTERVAL_MS);
  }

  if (childSessionId !== undefined) {
    return {
      ok: true,
      sessionId: childSessionId,
      connectionState: state,
      message: `子会话 ${childSessionId} 已建立（本次新建）。`,
    };
  }

  // 基线里已经有会话，而本次没有新建出别的 → 明确说清是复用。
  //
  // 这种情况不该报「成功」也不该报「失败」：会话确实存在、确实可用，
  // 但它是别人建的。上层需要知道这个区别，否则会把别人的资源
  // 当成自己的，在清理时误删。
  if (baselineChildSessionId !== undefined) {
    return {
      ok: false,
      reason: "session_preexisting",
      sessionId: baselineChildSessionId,
      connectionState: state,
      message:
        `调用前已存在子会话 ${baselineChildSessionId}，本次未新建会话。` +
        "该会话可直接使用（把 sessionId 传给后续操作即可），" +
        "但它不是本次创建的——清理时不要当作本实现的产物注销。" +
        (state === -1 ? "" : ` 控件连接状态=${state}。`),
    };
  }

  return {
    ok: false,
    reason: "connect_pending",
    connectionState: state,
    message:
      `Connect 已发出，控件处于连接中（Connected=${state}），` +
      `但 ${CONNECT_TIMEOUT_MS / 1000} 秒内未完成。` +
      (request.password.length === 0
        ? "当前用的是空密码——请确认该账户确实无密码，且 LimitBlankPasswordUse=0。"
        : "请检查账户名与密码。") +
      " 连接请求已发出，会话可能在稍后出现，可用 WTSGetChildSessionId 复查。",
  };
}
