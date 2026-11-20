/**
 * 通过 koffi 直调 Windows 系统 API 的底层封装。
 *
 * 设计取舍（spec §1.5 / §1.6 实测依据）：
 * 不编译 C++ addon，而是用 koffi 的 FFI 直接调 ole32/wtsapi32/user32 等。
 * 已在 `electron.exe + ELECTRON_RUN_AS_NODE=1` 下验证与纯 Node 行为一致，
 * 因此不需要为每个 Electron ABI 重编原生模块。
 *
 * 本文件只做「调用原语」，不含任何业务语义。
 */

import koffi from "koffi";
import { P_QUERY_INTERFACE, P_RELEASE } from "./protos.ts";

/** COM 初始化模式：单线程公寓。UIA 要求调用线程与创建线程一致。 */
const COINIT_APARTMENTTHREADED = 0x2;

/** CLSID_CUIAutomation = {FF48DBA4-60EF-4201-AA87-54103EEF594E} */
const CLSID_CUIAUTOMATION = Buffer.from([
  0xa4, 0xdb, 0x48, 0xff, 0xef, 0x60, 0x01, 0x42, 0xaa, 0x87, 0x54, 0x10, 0x3e, 0xef, 0x59, 0x4e,
]);

/** IID_IUIAutomation = {30CBE57D-D9D0-452A-AB13-7AC5AC4825EE} */
const IID_IUI_AUTOMATION = Buffer.from([
  0x7d, 0xe5, 0xcb, 0x30, 0xd0, 0xd9, 0x2a, 0x45, 0xab, 0x13, 0x7a, 0xc5, 0xac, 0x48, 0x25, 0xee,
]);

const CLSCTX_INPROC_SERVER = 0x1;


/** HRESULT 成功判定：非负即成功（S_OK=0，S_FALSE=1 也算成功）。 */
export function isHresultOk(hr: number): boolean {
  return hr >= 0;
}

export function formatHresult(hr: number): string {
  return `0x${(hr >>> 0).toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// 库加载：惰性单例。koffi.load 有成本且不该在模块顶层失败（测试环境可能无 DLL）。
// ---------------------------------------------------------------------------

interface NativeLibraries {
  ole32: koffi.IKoffiLib;
  oleaut32: koffi.IKoffiLib;
  kernel32: koffi.IKoffiLib;
}

let libraries: NativeLibraries | undefined;

function libs(): NativeLibraries {
  if (libraries) return libraries;
  libraries = {
    ole32: koffi.load("ole32.dll"),
    oleaut32: koffi.load("oleaut32.dll"),
    kernel32: koffi.load("kernel32.dll"),
  };
  return libraries;
}

// ---------------------------------------------------------------------------
// VARIANT / BSTR 编解码
//
// 注意（spec §1.12 实测踩坑）：
// - VARIANT 的 vt 在偏移 0，值联合体在偏移 8（x64 对齐）。
// - VT_BSTR 必须用 SysStringLen 取长度，再用 WideCharToMultiByte 转 UTF-8；
//   直接 koffi.decode(ptr, "str16") 在某些情况下会失败。
// - BSTR 必须 SysFreeString 释放，否则每读一个字符串属性漏一块内存。
// ---------------------------------------------------------------------------

const VT_BSTR = 8;
const VT_I4 = 3;
const VT_BOOL = 11;
const VT_ARRAY_R8 = 0x2005; // VT_ARRAY | VT_R8，用于 BoundingRectangle

export const VARIANT_SIZE = 24;

export interface VariantValue {
  /** VARIANT 的类型标记。 */
  vt: number;
  /** 已转换的值：字符串 / 数字 / 布尔 / 数字数组 / undefined。 */
  value: string | number | boolean | number[] | undefined;
}

/**
 * 解码 VARIANT 缓冲区。
 *
 * 只处理 UIA 属性读取会遇到的类型；其余返回 undefined 而非猜测，
 * 让调用方能区分「属性不存在」与「属性为空」。
 */
export function decodeVariant(buffer: Buffer): VariantValue {
  const vt = buffer.readUInt16LE(0);

  if (vt === VT_BSTR) {
    const ptr = buffer.readBigUInt64LE(8);
    if (ptr === 0n) return { vt, value: "" };
    const { value, release } = readBstr(ptr);
    release();
    return { vt, value };
  }

  if (vt === VT_I4) {
    return { vt, value: buffer.readInt32LE(8) };
  }

  if (vt === VT_BOOL) {
    // VARIANT_BOOL: -1 = true, 0 = false
    return { vt, value: buffer.readInt16LE(8) !== 0 };
  }

  if (vt === VT_ARRAY_R8) {
    const ptr = buffer.readBigUInt64LE(8);
    if (ptr === 0n) return { vt, value: undefined };
    const doubles = readSafeArrayDoubles(ptr);
    return { vt, value: doubles };
  }

  return { vt, value: undefined };
}

/**
 * 读取 BSTR 为 UTF-8 字符串，返回同时提供释放函数。
 *
 * BSTR 是长度前缀的 UTF-16LE：BSTR 指针之前 4 字节存字节长度。
 */
export function readBstr(ptr: bigint): { value: string; release: () => void } {
  const { oleaut32, kernel32 } = libs();
  const sysStringLen = oleaut32.func("uint32 __stdcall SysStringLen(void *b)");
  const sysFreeString = oleaut32.func("void __stdcall SysFreeString(void *b)");
  const wideCharToMultiByte = kernel32.func(
    "int __stdcall WideCharToMultiByte(uint32 cp, uint32 flags, const void *ws, int len, void *out, int outLen, const void *defChar, void *usedDefault)",
  );

  const pointer = pointerFromBigInt(ptr);
  const charCount = sysStringLen(pointer);
  const release = () => sysFreeString(pointer);

  if (charCount === 0) return { value: "", release };

  const out = Buffer.alloc(charCount * 4 + 4);
  // 65001 = CP_UTF8
  const written = wideCharToMultiByte(65001, 0, pointer, charCount, out, out.length, null, null);
  return { value: written > 0 ? out.subarray(0, written).toString("utf8") : "", release };
}

/**
 * 读取 SAFEARRAY(double, 4) —— UIA 的 BoundingRectangle。
 *
 * SAFEARRAY 的 rgsabound 是 `{ LONG cElements; LONG lLbound; }`，
 * **cElements 在偏移 24，lLbound 在偏移 28**。
 * 读反会得到恒定错误值（spec §1.11 实测踩坑）。
 */
export function readSafeArrayDoubles(safeArrayPtr: bigint, maxElements = 8): number[] {
  const header = Buffer.from(
    koffi.decode(pointerFromBigInt(safeArrayPtr), koffi.array("uint8", 32)),
  );
  const elementCount = header.readUInt32LE(24);
  const dataPtr = header.readBigUInt64LE(16);
  if (dataPtr === 0n || elementCount === 0) return [];
  const count = Math.min(elementCount, maxElements);
  return Array.from(
    koffi.decode(pointerFromBigInt(dataPtr), koffi.array("double", count)),
  );
}

/**
 * 把裸地址转成 koffi 可接受的外部指针。
 *
 * koffi 不接受 BigInt 直接做指针参数，必须经由一个 TypedArray 往返。
 */
export function pointerFromBigInt(address: bigint): unknown {
  const holder = Buffer.alloc(8);
  holder.writeBigUInt64LE(address);
  return koffi.decode(holder, "void *");
}

// ---------------------------------------------------------------------------
// COM 虚表调用
// ---------------------------------------------------------------------------

/**
 * 取 COM 对象虚表中第 index 项的函数指针。
 *
 * 虚表布局：对象首字段是 vtable 指针，vtable 是函数指针数组。
 * 所有 COM 接口前 3 项固定是 QueryInterface / AddRef / Release。
 *
 * **重要：只读需要的那一项，不要整表解码。**
 *
 * 曾经用 `koffi.decode(vtable, koffi.array("void *", 48))` 一次性读 48 项。
 * 对 IUIAutomationElement（40+ 方法）没问题，但对 pattern 接口
 * （IUIAutomationSelectionItemPattern 只有 8 项）会**越界读取到未映射内存**，
 * 下一次触碰该指针即 ACCESS_VIOLATION，进程无输出崩溃。
 *
 * 症状极具误导性：同一段代码单次调用成功、第二次崩溃，
 * 且崩溃点落在后续的无辜调用上（因为破坏的是堆）。
 */
export function vtableEntry(comObject: unknown, index: number): unknown {
  if (!comObject) {
    throw new Error("vtableEntry: COM 对象为空指针");
  }
  const vtable = koffi.decode(comObject as never, "void *");
  if (!vtable) {
    throw new Error("vtableEntry: vtable 为空指针");
  }
  // 按索引偏移读取单个指针，避免整表解码的越界风险
  const table = koffi.decode(vtable as never, koffi.array("void *", index + 1));
  return table[index];
}

/** 调用 COM 虚表中的一个方法。 */
export function callVtable(
  comObject: unknown,
  index: number,
  prototype: koffi.IKoffiCType,
  ...args: unknown[]
): number {
  const fn = vtableEntry(comObject, index);
  return koffi.call(fn as never, prototype, comObject, ...args) as number;
}

/** IID_IUnknown = {00000000-0000-0000-C000-000000000046} */
export const IID_IUNKNOWN = Buffer.from([
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46,
]);

/**
 * 对 COM 接口做一次 QueryInterface。
 *
 * **为什么每个动作前都要做这一步**：
 *
 * 实测（2026-11-19，`ELECTRON_RUN_AS_NODE` 环境下稳定复现）：
 * `IUIAutomationElement::GetCurrentPattern` 返回的 pattern 指针，
 * 直接调用其动作方法（Select / Invoke）会 **ACCESS_VIOLATION 崩溃**；
 * 但只要先对该指针调一次 `QueryInterface(IID_IUnknown)`，
 * 之后的动作调用就完全正常。
 *
 * 对照实验数据：
 * ```
 * 直接 Select            → 崩溃 0xC0000005
 * AddRef 后 Select       → 崩溃 0xC0000005
 * QueryInterface 后 Select → 成功 S_OK
 * ```
 *
 * 推测原因：`GetCurrentPattern` 的 out 参数在 koffi 侧被当作裸值处理，
 * 该接口指针的 COM 引用未被正确建立；QueryInterface 的调用让 COM 运行时
 * 完成了必要的内部登记。这只是推测，但**结论是确定且可复现的**。
 *
 * 因此本函数成为使用 pattern 的强制前置步骤——不是可选优化。
 * 忽略它会导致 Helper 进程无日志崩溃，排查成本极高。
 */
export function stabilizeComInterface(pointer: unknown): unknown {
  if (!pointer) return undefined;
  const out: unknown[] = [null];
  try {
    const hr = koffi.call(
      vtableEntry(pointer, 0) as never,
      P_QUERY_INTERFACE,
      pointer,
      IID_IUNKNOWN,
      out,
    ) as number;
    if (!isHresultOk(hr) || !out[0]) return undefined;
    // out[0] 是同一对象的新引用，用它更安全（引用计数已正确增加）
    return out[0];
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// COM 生命周期与 IUIAutomation 创建
// ---------------------------------------------------------------------------

export interface AutomationHandle {
  /** IUIAutomation 的 COM 指针。 */
  automation: unknown;
  /** 释放 COM 引用并 CoUninitialize。重复调用安全。 */
  dispose: () => void;
}

/**
 * 初始化 COM 并创建 IUIAutomation。
 *
 * 必须在同一线程调用全部 UIA 方法（STA 要求）。Node 是单线程事件循环，
 * 天然满足；但若将来引入 worker_threads，每个 worker 都要独立调用本函数。
 *
 * 失败返回带 HRESULT 的错误，不 catch 后静默降级——UIA 不可用意味着
 * 整个观察/动作能力不可用，必须让上层明确知道。
 */
export function createAutomation(): AutomationHandle {
  const { ole32 } = libs();

  const coInitializeEx = ole32.func(
    "long __stdcall CoInitializeEx(void *reserved, uint32 coInit)",
  );
  const coCreateInstance = ole32.func(
    "long __stdcall CoCreateInstance(const void *clsid, void *outer, uint32 ctx, const void *iid, _Out_ void **out)",
  );
  const coUninitialize = ole32.func("void __stdcall CoUninitialize()");

  const initHr = coInitializeEx(null, COINIT_APARTMENTTHREADED);
  // RPC_E_CHANGED_MODE(-2147417850)：该线程已用其他模式初始化过。
  // 这不是致命错误——UIA 在 MTA 下也能用，只是 STA 更稳。继续。
  const initFailed = !isHresultOk(initHr) && (initHr >>> 0) !== 0x80010106;
  if (initFailed) {
    throw new Error(`CoInitializeEx failed: ${formatHresult(initHr)}`);
  }

  const out: unknown[] = [null];
  const createHr = coCreateInstance(
    CLSID_CUIAUTOMATION,
    null,
    CLSCTX_INPROC_SERVER,
    IID_IUI_AUTOMATION,
    out,
  );
  if (!isHresultOk(createHr) || !out[0]) {
    coUninitialize();
    throw new Error(`CoCreateInstance(IUIAutomation) failed: ${formatHresult(createHr)}`);
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    // Release 是 IUnknown 第 3 项（索引 2）
    try {
      koffi.call(vtableEntry(out[0], 2) as never, P_RELEASE, out[0]);
    } catch {
      // Release 失败不应阻止 CoUninitialize；进程即将退出时尤其无所谓
    }
    coUninitialize();
  };

  return { automation: out[0], dispose };
}

// ---------------------------------------------------------------------------
// 进程/窗口工具
// ---------------------------------------------------------------------------

/** 取当前进程所在会话 ID，用于诊断「动作打到了错误的会话」。 */
export function currentSessionId(): number {
  const { kernel32 } = libs();
  const processIdToSessionId = kernel32.func(
    "int __stdcall ProcessIdToSessionId(uint32 pid, _Out_ uint32 *out)",
  );
  const out = [0];
  processIdToSessionId(process.pid, out);
  return out[0];
}
