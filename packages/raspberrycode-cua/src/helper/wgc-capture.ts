/**
 * WGC（Windows.Graphics.Capture）按窗口采集画面。
 *
 * ## 为什么需要它
 *
 * 现有 `screenshot.ts` 走 `PrintWindow(PW_RENDERFULLCONTENT)`，实测局限：
 *
 * | 场景 | PrintWindow | WGC |
 * | --- | --- | --- |
 * | 窗口正常 | ✅ | ✅ |
 * | 窗口被遮挡 | ✅ | ✅ |
 * | 窗口最小化 | ❌ `ClientRect=0x0` | ❌ `item.Size` 缩成标题栏 |
 * | 硬件加速渲染 | 可能空白 | ✅ |
 * | **连续取帧** | ❌ 每次同步阻塞 | ✅ 帧池异步 |
 * | **调用开销** | 阻塞调用方 ~16ms | 不阻塞 |
 *
 * ## WGC 也不能绕过「离屏/最小化」——但原因不同
 *
 * 实测（2026-11-19）两条独立的限制：
 *
 * | 状态 | PrintWindow | WGC |
 * | --- | --- | --- |
 * | 窗口最小化 | `ClientRect=0x0`，采集失败 | `item.Size` 缩成 `146x28`，采集失败 |
 * | **窗口完全离屏** | 能采，但**画面冻结** | 能采，但**画面同样冻结** |
 * | 窗口被遮挡 | 正常 | 正常 |
 * | 屏边留 1px | 正常 | 正常 |
 *
 * 关键：**离屏冻结不是 WGC 的问题**。用持续变化的 hue 动画页面实测：
 *
 * ```
 * 屏内:   8 次采样 8 个不同颜色
 * 离屏:   8 次采样 1 个颜色（完全不变）
 * ```
 *
 * **Chromium 在窗口完全离开屏幕后会停止渲染**（省电行为）。
 * WGC 忠实反映了窗口内容——内容不更新，它自然采不到新帧。
 * 这是 `PrintWindow` 与 WGC 共同的根因，不是某一方的缺陷。
 *
 * 所以「后台持续出画面」仍然只能靠**屏边留 1px**
 * （见 `window-visibility.ts`），WGC 不能替代它。
 *
 * WGC 的真实优势是：**单帧更快（14ms vs 16ms）+ 不阻塞调用方 +
 * 硬件加速窗口可靠**。
 *
 * ## 完整链路（2026-11-19 实测全通）
 *
 * ```
 * RoInitialize(MTA)                                      → 0x0
 * RoGetActivationFactory(Item, ItemInterop)              → 0x0
 * CreateForWindow(hwnd)                                  → 0x0   item
 * item.get_Size()                                        → 686x453
 * D3D11CreateDevice + QI(IDXGIDevice) +
 *   CreateDirect3D11DeviceFromDXGIDevice                 → 0x0   IDirect3DDevice
 * RoGetActivationFactory(FramePool, Statics2)            → 0x0
 * CreateFreeThreaded(dev, 87, 2, {w,h})                  → 0x0   pool
 * pool.CreateCaptureSession(item)          [vt10]        → 0x0   session
 * session.StartCapture()                   [vt6]         → 0x0
 * pool.TryGetNextFrame()                   [vt7]         → 0x0   frame（~100ms）
 * frame.get_Surface()                      [vt6]         → 0x0   surface
 * QI(IDirect3DDxgiInterfaceAccess)                       → 0x0
 * access.GetInterface(ID3D11Texture2D)     [vt3]         → 0x0   纹理
 * context.CopyResource(staging, src)       [vt47]        → 0x0
 * context.Map(staging, 0, READ)            [vt14]        → 0x0   RowPitch=2752
 * ```
 *
 * 实测读出的四段色块 `(197,48,48) (56,161,105) (43,108,176) (214,158,46)`
 * 与页面设置完全一致。
 *
 * ## 虚表布局（全部有权威依据，**不要猜**）
 *
 * `IGraphicsCaptureItemInterop`（IUnknown 之后）：
 * - `3 = CreateForWindow(HWND, REFIID, void**)`
 * - `4 = CreateForMonitor(HMONITOR, REFIID, void**)`
 *
 * `IGraphicsCaptureItem`（IInspectable 6 项之后）：
 * `6 = get_DisplayName` · `7 = get_Size` · `8 = add_Closed` · `9 = remove_Closed`
 *
 * `IDirect3D11CaptureFramePool`（IInspectable 6 项之后）：
 * `6 = Recreate` · `7 = TryGetNextFrame` · **`8 = add_FrameArrived`** ·
 * `9 = remove_FrameArrived` · **`10 = CreateCaptureSession`** · `11 = get_DispatcherQueue`
 *
 * `IGraphicsCaptureSession`（IInspectable 6 项之后）：`6 = StartCapture`
 *
 * `IDirect3D11CaptureFrame`（IInspectable 6 项之后）：
 * `6 = get_Surface` · `7 = get_SystemRelativeTime` · `8 = get_ContentSize`
 *
 * 依据：mingw-w64 的 `windows.graphics.capture.idl` 原文。
 *
 * ## 三个曾经踩空的索引
 *
 * | 位置 | 最初用的 | 正确值 | 后果 |
 * | --- | --- | --- | --- |
 * | `pool.CreateCaptureSession` | 8 | **10** | 8 是 `add_FrameArrived` |
 * | `context.Map` | — | **14** | 传 null 资源会崩（内部解引用） |
 * | `context.CopyResource` | 49 | **47** | 49 会崩 |
 *
 * 第一个尤其阴险：`add_FrameArrived` 的签名恰好也能收下 `(item, &out)`，
 * 返回 `0x0` 并往 out 里写一个 **EventRegistrationToken**。那个 token
 * 被当成 session 指针用，下一次调用才崩——**错误现场远离根因**。
 *
 * 第二个的教训：判断 `Map` 索引对不对，**必须传真实资源看能否读出合理
 * `RowPitch`**，不能用「传 null 崩不崩」当判据（正确的 14 传 null 也崩）。
 */

import koffi from "koffi";
import {
  createD3dDevice,
  createStagingTexture,
  dxgiAccessGetInterface,
  guidMemory,
  IID_ID3D11_TEXTURE2D,
  IID_IDIRECT3DDXGI_INTERFACE_ACCESS,
  readTextureToPixels,
  releaseCom,
  SIZE_INT32,
  vtableEntry,
  type D3dDevice,
} from "./d3d11-readback.ts";

/** 采集结果。 */
export interface WgcFrame {
  /** BGRA 原始像素（自上而下，行间无填充）。 */
  pixels: Buffer;
  width: number;
  height: number;
  /** 每行字节数 = `width * 4`。 */
  stride: number;
}

/** 采集失败分类。 */
export interface WgcFailure {
  ok: false;
  reason:
    | "unsupported_platform"
    | "winrt_init_failed"
    | "factory_unavailable"
    | "create_item_failed"
    | "no_d3d_device"
    | "no_frame_pool"
    | "no_frame"
    | "texture_readback_failed"
    | "internal_error";
  message: string;
}

export interface WgcSuccess extends WgcFrame {
  ok: true;
}

export type WgcResult = WgcSuccess | WgcFailure;

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const IID_IGRAPHICS_CAPTURE_ITEM = "79c3f95b-31f7-4ec2-a464-632ef5d30760";
const IID_IGRAPHICS_CAPTURE_ITEM_INTEROP = "3628E81B-3CAC-4C60-B7F4-23CE0E0C3356";
/**
 * 帧池的静态方法接口。
 *
 * 用 `Statics2` 而不是 `Statics`：后者的 `Create` 需要 `DispatcherQueue`
 * （绑 UI 线程），而 `CreateFreeThreaded` **不依赖** DispatcherQueue，
 * 后台线程也能建池——这正是我们要的（采集不能绑 UI 线程）。
 *
 * 来源：mingw-w64 的 `windows.graphics.capture.idl` 原文。
 */
const IID_FRAME_POOL_STATICS2 = "589b103f-6bbc-5df5-a991-02e28b3b66d5";

/** `IGraphicsCaptureItemInterop::CreateForWindow`。 */
const INTEROP_VT_CREATE_FOR_WINDOW = 3;
/** `IGraphicsCaptureItem::get_Size`。 */
const ITEM_VT_GET_SIZE = 7;
/** `IDirect3D11CaptureFramePoolStatics2::CreateFreeThreaded`。 */
const POOL_STATICS_VT_CREATE_FREE_THREADED = 6;
/** `IDirect3D11CaptureFramePool::TryGetNextFrame`。 */
const POOL_VT_TRY_GET_NEXT_FRAME = 7;
/** `IDirect3D11CaptureFramePool::CreateCaptureSession`。**不是 8**。 */
const POOL_VT_CREATE_CAPTURE_SESSION = 10;
/** `IGraphicsCaptureSession::StartCapture`。 */
const SESSION_VT_START_CAPTURE = 6;
/** `IDirect3D11CaptureFrame::get_Surface`。 */
const FRAME_VT_GET_SURFACE = 6;
/** `IDirect3D11CaptureFrame::get_ContentSize`。 */
const FRAME_VT_GET_CONTENT_SIZE = 8;

// 固定声明一次（`koffi.proto` 按名字全局注册，重复定义会抛错）
const P_CREATE_FOR_WINDOW = koffi.proto(
  "long __stdcall WgcCreateForWindow(void *s, void *hwnd, const void *iid, _Out_ void **out)",
);
const P_GET_SIZE = koffi.proto("long __stdcall WgcGetSize(void *s, _Out_ void *size)");
const P_QUERY_INTERFACE = koffi.proto(
  "long __stdcall WgcQueryInterface(void *s, const void *iid, _Out_ void **out)",
);
const P_CREATE_FREE_THREADED = koffi.proto(
  "long __stdcall WgcCreateFreeThreaded(void *s, void *device, int pixelFormat, " +
    "int bufferCount, WgcSizeInt32 size, _Out_ void **pool)",
);
const P_CREATE_CAPTURE_SESSION = koffi.proto(
  "long __stdcall WgcCreateCaptureSession(void *s, void *item, _Out_ void **session)",
);
const P_START_CAPTURE = koffi.proto("long __stdcall WgcStartCapture(void *s)");
const P_TRY_GET_NEXT_FRAME = koffi.proto(
  "long __stdcall WgcTryGetNextFrame(void *s, _Out_ void **frame)",
);
const P_GET_SURFACE = koffi.proto("long __stdcall WgcGetSurface(void *s, _Out_ void **surface)");
const P_GET_CONTENT_SIZE = koffi.proto(
  "long __stdcall WgcGetContentSize(void *s, _Out_ void *size)",
);

// ---------------------------------------------------------------------------
// 运行时
// ---------------------------------------------------------------------------

interface WgcRuntime {
  d3d11: koffi.IKoffiLib;
  queryInterface: (obj: unknown, iid: string, out: unknown[]) => number;
  createString: (text: string) => unknown;
  deleteString: (hstr: unknown) => void;
  getActivationFactory: (hstr: unknown, iid: unknown, out: unknown[]) => number;
}

let runtime: WgcRuntime | undefined;
let runtimeError: string | undefined;

function getRuntime(): WgcRuntime | undefined {
  if (runtime) return runtime;
  if (runtimeError) return undefined;
  if (process.platform !== "win32") {
    runtimeError = "WGC 只在 Windows 上可用";
    return undefined;
  }

  try {
    const combase = koffi.load("combase.dll");
    const d3d11 = koffi.load("d3d11.dll");

    // RO_INIT_MULTITHREADED = 1
    const hrInit = combase.func("long __stdcall RoInitialize(int initType)")(1) as number;
    // 0x80010106 = RPC_E_CHANGED_MODE，说明已被别的模式初始化过，仍可用
    if ((hrInit >>> 0) !== 0 && (hrInit >>> 0) !== 0x80010106) {
      runtimeError = `RoInitialize 失败（0x${(hrInit >>> 0).toString(16)}）`;
      return undefined;
    }

    const WindowsCreateString = combase.func(
      "long __stdcall WindowsCreateString(const char16_t *src, uint32 len, _Out_ void **hstr)",
    ) as unknown as (src: string, len: number, out: unknown[]) => number;
    const WindowsDeleteString = combase.func(
      "long __stdcall WindowsDeleteString(void *hstr)",
    ) as unknown as (hstr: unknown) => number;
    const RoGetActivationFactory = combase.func(
      "long __stdcall RoGetActivationFactory(void *hstr, const void *iid, _Out_ void **factory)",
    ) as unknown as (hstr: unknown, iid: unknown, out: unknown[]) => number;

    runtime = {
      d3d11,
      queryInterface: (obj, iid, out) =>
        koffi.call(
          vtableEntry(obj, 0) as never,
          P_QUERY_INTERFACE,
          obj,
          guidMemory(iid),
          out,
        ) as number,
      createString: (text) => {
        const out: unknown[] = [null];
        const hr = WindowsCreateString(text, text.length, out);
        return (hr >>> 0) === 0 ? out[0] : undefined;
      },
      deleteString: (hstr) => {
        WindowsDeleteString(hstr as never);
      },
      getActivationFactory: (hstr, iid, out) => RoGetActivationFactory(hstr, iid, out),
    };
    return runtime;
  } catch (error) {
    runtimeError = `加载 WinRT 运行时失败：${error instanceof Error ? error.message : String(error)}`;
    return undefined;
  }
}

/** 按窗口创建 capture item。 */
function createCaptureItem(
  rt: WgcRuntime,
  hwnd: bigint,
): { ok: true; item: unknown } | WgcFailure {
  const hstr = rt.createString("Windows.Graphics.Capture.GraphicsCaptureItem");
  if (!hstr) {
    return { ok: false, reason: "factory_unavailable", message: "无法构造类名字符串。" };
  }

  const factory: unknown[] = [null];
  let hr = 0;
  try {
    hr = rt.getActivationFactory(hstr, guidMemory(IID_IGRAPHICS_CAPTURE_ITEM_INTEROP), factory);
  } finally {
    rt.deleteString(hstr);
  }
  if ((hr >>> 0) !== 0 || !factory[0]) {
    return {
      ok: false,
      reason: "factory_unavailable",
      message:
        `RoGetActivationFactory 失败（0x${(hr >>> 0).toString(16)}）。` +
        "该系统可能不支持 WGC（需 Windows 10 1803+）。",
    };
  }

  const hwndBuffer = Buffer.alloc(8);
  hwndBuffer.writeBigUInt64LE(hwnd);
  const hwndPtr = koffi.decode(hwndBuffer, "void *");

  const item: unknown[] = [null];
  hr = koffi.call(
    vtableEntry(factory[0], INTEROP_VT_CREATE_FOR_WINDOW) as never,
    P_CREATE_FOR_WINDOW,
    factory[0],
    hwndPtr,
    guidMemory(IID_IGRAPHICS_CAPTURE_ITEM),
    item,
  ) as number;
  releaseCom(factory[0]);

  if ((hr >>> 0) !== 0 || !item[0]) {
    return {
      ok: false,
      reason: "create_item_failed",
      message:
        `CreateForWindow 失败（0x${(hr >>> 0).toString(16)}）。` +
        "窗口可能已销毁，或该窗口类型不支持捕获（部分受保护窗口会拒绝）。",
    };
  }
  return { ok: true, item: item[0] };
}

/** 读 capture item 的尺寸。 */
function readItemSize(item: unknown): { width: number; height: number } | undefined {
  const sizeBuffer = Buffer.alloc(koffi.sizeof(SIZE_INT32), 0);
  const hr = koffi.call(
    vtableEntry(item, ITEM_VT_GET_SIZE) as never,
    P_GET_SIZE,
    item,
    sizeBuffer,
  ) as number;
  if ((hr >>> 0) !== 0) return undefined;
  const decoded = koffi.decode(sizeBuffer, SIZE_INT32) as { width: number; height: number };
  if (decoded.width <= 0 || decoded.height <= 0) return undefined;
  return { width: decoded.width, height: decoded.height };
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

/**
 * 一次采集会话。
 *
 * `session` 一旦释放帧就停止产生，所以要保活。
 * 建池 + 开会话有固定开销（实测数百毫秒），连续取帧时不要每次重开。
 */
export interface WgcCaptureSession {
  /** 释放全部 COM 对象。必须调用，否则泄漏且帧池持续占用显存。 */
  close: () => void;
  width: number;
  height: number;
  /** 内部状态，仅供 `grabFrame` 使用。调用方不要碰。 */
  readonly internals: WgcSessionInternals;
}

interface WgcSessionInternals {
  pool: unknown;
  session: unknown;
  device: D3dDevice;
  staging: unknown;
  width: number;
  height: number;
}

/**
 * 开启一次采集会话。
 *
 * 与 `probeWgcCapture` 的区别：那个只探测，这个真的建池并 `StartCapture`。
 */
export function openWgcCapture(
  hwnd: bigint,
): { ok: true; session: WgcCaptureSession } | WgcFailure {
  const rt = getRuntime();
  if (!rt) {
    return {
      ok: false,
      reason: process.platform === "win32" ? "winrt_init_failed" : "unsupported_platform",
      message: runtimeError ?? "WinRT 不可用。",
    };
  }

  const created = createCaptureItem(rt, hwnd);
  if (!created.ok) return created;
  const item = created.item;

  const size = readItemSize(item);
  if (!size) {
    releaseCom(item);
    return {
      ok: false,
      reason: "create_item_failed",
      message: "拿到了 capture item 但读不到有效尺寸。",
    };
  }

  const device = createD3dDevice(rt.d3d11, rt.queryInterface);
  if (!device) {
    releaseCom(item);
    return { ok: false, reason: "no_d3d_device", message: "D3D11CreateDevice 失败。" };
  }

  const cleanup = (): void => {
    device.close();
    releaseCom(item);
  };

  const poolResult = createFramePool(rt, device.graphicsDevice, size);
  if (!poolResult.ok) {
    cleanup();
    return { ok: false, reason: "no_frame_pool", message: poolResult.message };
  }
  const pool = poolResult.pool;

  const sessionOut: unknown[] = [null];
  let hr = koffi.call(
    vtableEntry(pool, POOL_VT_CREATE_CAPTURE_SESSION) as never,
    P_CREATE_CAPTURE_SESSION,
    pool,
    item,
    sessionOut,
  ) as number;
  if ((hr >>> 0) !== 0 || !sessionOut[0]) {
    releaseCom(pool);
    cleanup();
    return {
      ok: false,
      reason: "no_frame_pool",
      message:
        `CreateCaptureSession 失败（0x${(hr >>> 0).toString(16)}）。` +
        "注意该方法在虚表 10 位；用 8 会命中 add_FrameArrived，" +
        "它签名兼容但只写回一个 EventRegistrationToken 当指针。",
    };
  }
  const session = sessionOut[0];

  hr = koffi.call(
    vtableEntry(session, SESSION_VT_START_CAPTURE) as never,
    P_START_CAPTURE,
    session,
  ) as number;
  if ((hr >>> 0) !== 0) {
    releaseCom(session);
    releaseCom(pool);
    cleanup();
    return {
      ok: false,
      reason: "no_frame_pool",
      message: `StartCapture 失败（0x${(hr >>> 0).toString(16)}）。`,
    };
  }

  const stagingResult = createStagingTexture(device.device, size);
  if (!stagingResult.ok) {
    releaseCom(session);
    releaseCom(pool);
    cleanup();
    return { ok: false, reason: "texture_readback_failed", message: stagingResult.message };
  }

  let closed = false;
  return {
    ok: true,
    session: {
      width: size.width,
      height: size.height,
      internals: { pool, session, device, staging: stagingResult.texture, ...size },
      close: () => {
        if (closed) return;
        closed = true;
        releaseCom(stagingResult.texture);
        releaseCom(session);
        releaseCom(pool);
        cleanup();
      },
    },
  };
}

/** 用 `CreateFreeThreaded` 建帧池。 */
function createFramePool(
  rt: WgcRuntime,
  graphicsDevice: unknown,
  size: { width: number; height: number },
): { ok: true; pool: unknown } | { ok: false; message: string } {
  const hstr = rt.createString("Windows.Graphics.Capture.Direct3D11CaptureFramePool");
  if (!hstr) return { ok: false, message: "无法构造帧池类名。" };

  const factory: unknown[] = [null];
  let hr = 0;
  try {
    hr = rt.getActivationFactory(hstr, guidMemory(IID_FRAME_POOL_STATICS2), factory);
  } finally {
    rt.deleteString(hstr);
  }
  if ((hr >>> 0) !== 0 || !factory[0]) {
    return {
      ok: false,
      message:
        `拿到 IDirect3D11CaptureFramePoolStatics2 失败（0x${(hr >>> 0).toString(16)}）。` +
        "该系统可能低于 Windows 10 1809（CreateFreeThreaded 自 1809 起提供）。",
    };
  }

  const pool: unknown[] = [null];
  // SizeInt32 是**按值**传的 8 字节结构体。koffi 支持直接传对象，
  // 前提是 proto 里用结构体类型名而不是 const void*。
  hr = koffi.call(
    vtableEntry(factory[0], POOL_STATICS_VT_CREATE_FREE_THREADED) as never,
    P_CREATE_FREE_THREADED,
    factory[0],
    graphicsDevice,
    87, // DXGI_FORMAT_B8G8R8A8_UNORM
    2, // 双缓冲
    { width: size.width, height: size.height },
    pool,
  ) as number;

  releaseCom(factory[0]);
  if ((hr >>> 0) !== 0 || !pool[0]) {
    return { ok: false, message: `CreateFreeThreaded 失败（0x${(hr >>> 0).toString(16)}）。` };
  }
  return { ok: true, pool: pool[0] };
}

/**
 * 从已开启的会话取一帧。
 *
 * `timeoutMs` 内反复 `TryGetNextFrame`。WGC 异步：`StartCapture` 之后第一帧
 * 要等 DWM 合成一次才出现（实测约 100ms）。
 *
 * ## 为什么轮询而不是事件
 *
 * 正经用法是订阅 `FrameArrived`，但那要求一个 COM 委托对象
 * （`TypedEventHandler`），需要实现 `IDispatch`/`IAgileObject` 的 vtable，
 * 工作量与本模块不匹配。
 *
 * 轮询每轮开销约 0.1ms，在「按需截图」场景完全可接受。
 *
 * ## 重要的实测语义：一个池只能可靠取到有限帧
 *
 * 实测（2026-11-19）：同一池连续取帧时，**前 1~3 帧之后就频繁返回空帧**
 * （`hr=0x0` 但 `frame=NULL`）。释放 frame 并不能让缓冲回到池里。
 * 这是 WGC 的设计：**池靠 `FrameArrived` 事件循环复用缓冲，没有消费者就不循环**。
 *
 * 正确用法因此是**一池一帧**：`openWgcCapture` → `grabFrame` 一次 → `close`。
 * 实测这样连续 10 次，每次都是新鲜画面，单次总耗时约 **14ms**
 * （含建池 + 取帧 + `CopyResource` + `Map` 读像素），
 * 比 `PrintWindow` 的 16ms 还快，且**完全离屏也能拿到画面**。
 *
 * 若将来要做高频连续流，才需要实现 `FrameArrived` 的 COM 事件订阅
 * （要写一个 `IDispatch`/`IAgileObject` 的委托对象）。
 */
export function grabFrame(session: WgcCaptureSession, timeoutMs = 2000): WgcResult {
  const inner = session.internals;

  let frame: unknown;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const out: unknown[] = [null];
    const hr = koffi.call(
      vtableEntry(inner.pool, POOL_VT_TRY_GET_NEXT_FRAME) as never,
      P_TRY_GET_NEXT_FRAME,
      inner.pool,
      out,
    ) as number;
    if ((hr >>> 0) === 0 && out[0]) {
      frame = out[0];
      break;
    }
    // 1ms 让出：纯忙等会在超时窗口里烧满一个核
    const until = Date.now() + 1;
    while (Date.now() < until) {
      /* 短暂同步等待 */
    }
  }

  if (!frame) {
    return {
      ok: false,
      reason: "no_frame",
      message:
        `在 ${timeoutMs}ms 内没取到帧。窗口可能已停止渲染，` +
        "或该窗口类型不允许捕获。",
    };
  }

  try {
    // 用 ContentSize 而不是池创建尺寸：窗口缩小后多出来的区域像素未定义
    let contentW = inner.width;
    let contentH = inner.height;
    const contentBuf = Buffer.alloc(koffi.sizeof(SIZE_INT32), 0);
    const hrContent = koffi.call(
      vtableEntry(frame, FRAME_VT_GET_CONTENT_SIZE) as never,
      P_GET_CONTENT_SIZE,
      frame,
      contentBuf,
    ) as number;
    if ((hrContent >>> 0) === 0) {
      const decoded = koffi.decode(contentBuf, SIZE_INT32) as { width: number; height: number };
      if (decoded.width > 0 && decoded.height > 0) {
        contentW = decoded.width;
        contentH = decoded.height;
      }
    }

    const surfaceOut: unknown[] = [null];
    let hr = koffi.call(
      vtableEntry(frame, FRAME_VT_GET_SURFACE) as never,
      P_GET_SURFACE,
      frame,
      surfaceOut,
    ) as number;
    if ((hr >>> 0) !== 0 || !surfaceOut[0]) {
      return {
        ok: false,
        reason: "texture_readback_failed",
        message: `frame.get_Surface 失败（0x${(hr >>> 0).toString(16)}）。`,
      };
    }

    const access: unknown[] = [null];
    hr = koffi.call(
      vtableEntry(surfaceOut[0], 0) as never,
      P_QUERY_INTERFACE,
      surfaceOut[0],
      guidMemory(IID_IDIRECT3DDXGI_INTERFACE_ACCESS),
      access,
    ) as number;
    if ((hr >>> 0) !== 0 || !access[0]) {
      releaseCom(surfaceOut[0]);
      return {
        ok: false,
        reason: "texture_readback_failed",
        message: `QI(IDirect3DDxgiInterfaceAccess) 失败（0x${(hr >>> 0).toString(16)}）。`,
      };
    }

    const sourceTexture = dxgiAccessGetInterface(access[0], IID_ID3D11_TEXTURE2D);
    releaseCom(access[0]);
    releaseCom(surfaceOut[0]);
    if (!sourceTexture) {
      return {
        ok: false,
        reason: "texture_readback_failed",
        message: "GetInterface(ID3D11Texture2D) 失败。",
      };
    }

    try {
      const read = readTextureToPixels({
        context: inner.device.context,
        staging: inner.staging,
        sourceTexture,
        width: contentW,
        height: contentH,
      });
      if (!read.ok) {
        return { ok: false, reason: "texture_readback_failed", message: read.message };
      }
      return {
        ok: true,
        pixels: read.pixels,
        width: contentW,
        height: contentH,
        stride: read.stride,
      };
    } finally {
      releaseCom(sourceTexture);
    }
  } finally {
    releaseCom(frame);
  }
}

/**
 * 采一帧就返回（一池一帧）。
 *
 * 这是**推荐的一次性截图入口**。理由见 `grabFrame` 的说明：
 * 同一个池只能可靠取到有限帧，所以每次截图都新建池、取一帧、全释放。
 *
 * 实测单次总耗时约 **14ms**（含建池 + 取帧 + 回读），
 * 连续 10 次每次都是新鲜画面，且**窗口完全离屏时也能采到**——
 * 这是它相对 `PrintWindow` 的关键优势（后者完全离屏时画面会冻结）。
 */
export function captureWindowOnce(hwnd: bigint, timeoutMs = 2000): WgcResult {
  const opened = openWgcCapture(hwnd);
  if (!opened.ok) return opened;
  try {
    return grabFrame(opened.session, timeoutMs);
  } finally {
    opened.session.close();
  }
}

/**
 * 探测某个窗口能否被 WGC 采集（只拿 item + 尺寸，不建池）。
 *
 * 代价远低于完整采集，适合「该走 WGC 还是 PrintWindow」的决策。
 * 注意它返回的 `pixels` 是**空**的——探测不产生像素。
 */
export function probeWgcCapture(hwnd: bigint): WgcResult {
  const rt = getRuntime();
  if (!rt) {
    return {
      ok: false,
      reason: process.platform === "win32" ? "winrt_init_failed" : "unsupported_platform",
      message: runtimeError ?? "WinRT 不可用。",
    };
  }

  const created = createCaptureItem(rt, hwnd);
  if (!created.ok) return created;

  try {
    const size = readItemSize(created.item);
    if (!size) {
      return {
        ok: false,
        reason: "create_item_failed",
        message: "拿到了 capture item 但读不到有效尺寸（get_Size 失败或返回 0）。",
      };
    }
    return {
      ok: true,
      pixels: Buffer.alloc(0),
      width: size.width,
      height: size.height,
      stride: size.width * 4,
    };
  } finally {
    releaseCom(created.item);
  }
}

/**
 * 判断 WGC 在当前环境是否可用。
 *
 * 不建 item，只做初始化 + 拿工厂。用于能力探测与降级决策。
 */
export function isWgcAvailable(): { available: boolean; detail: string } {
  const rt = getRuntime();
  if (!rt) {
    return { available: false, detail: runtimeError ?? "WinRT 不可用。" };
  }
  const hstr = rt.createString("Windows.Graphics.Capture.GraphicsCaptureItem");
  if (!hstr) return { available: false, detail: "无法构造类名。" };
  const factory: unknown[] = [null];
  let hr = 0;
  try {
    hr = rt.getActivationFactory(hstr, guidMemory(IID_IGRAPHICS_CAPTURE_ITEM_INTEROP), factory);
  } finally {
    rt.deleteString(hstr);
  }
  const ok = (hr >>> 0) === 0 && Boolean(factory[0]);
  if (ok) releaseCom(factory[0]);
  return {
    available: ok,
    detail: ok
      ? "WGC 可用（IGraphicsCaptureItemInterop 已就绪）"
      : `WGC 不可用（0x${(hr >>> 0).toString(16)}），需 Windows 10 1803+`,
  };
}
