/**
 * D3D11 设备与纹理回读。
 *
 * 从 `wgc-capture.ts` 拆出来，因为它是一块独立的知识：把 GPU 上的画面
 * 拉回 CPU 内存。WGC 只是它的一个调用者，将来别的采集路径（DXGI Desktop
 * Duplication）也能复用。
 *
 * ## 全部虚表索引都有权威依据，不要猜
 *
 * `ID3D11DeviceContext` 的布局依据 `d3d11.h` 的声明顺序：
 * ```
 * 0-2  IUnknown
 * 3-6  ID3D11DeviceChild (GetDevice / GetPrivateData / SetPrivateData / SetPrivateDataInterface)
 * 7 起 ID3D11DeviceContext 自身方法，索引 = 自身序号 + 6
 *   14 = Map          （自身第 8 个）
 *   15 = Unmap        （自身第 9 个）
 *   47 = CopyResource （自身第 41 个）
 * ```
 *
 * `ID3D11Device`：
 * ```
 * 3 = CreateBuffer
 * 4 = CreateTexture1D
 * 5 = CreateTexture2D
 * 6 = CreateTexture3D
 * ```
 *
 * ## 两个实测踩到的坑
 *
 * ### ① `D3D11CreateDevice` 的参数顺序
 *
 * 真实签名（`d3d11.h`）：
 * ```
 * HRESULT D3D11CreateDevice(IDXGIAdapter*, D3D_DRIVER_TYPE, HMODULE, UINT Flags,
 *   const D3D_FEATURE_LEVEL*, UINT FeatureLevels, UINT SDKVersion,
 *   ID3D11Device**, D3D_FEATURE_LEVEL*, ID3D11DeviceContext**)
 * ```
 * `pFeatureLevel` 在 `ppDevice` **之后、`ppImmediateContext` 之前**。
 * 写成 `(device, context, featureLevel)` 会让 context 拿到 featureLevel
 * 的输出槽——那是个枚举值，当指针用立刻崩。
 *
 * ### ② 判断 `Map` 索引对不对，不能用「传 null 崩不崩」
 *
 * `Map(staging, 0, READ, 0, &mapped)` 传 `null` 资源会 ACCESS_VIOLATION
 * （内部解引用资源指针）。我一度据此把正确的 14 判成错的，转去扫出 29
 * ——那其实是别的恰好也返回 `E_INVALIDARG` 的方法。
 *
 * **正确判据：传真实资源，看能否读出合理的 `RowPitch`**
 * （实测 686 宽 → 2752 = 686×4 对齐到 16 的倍数）。
 */

import koffi from "koffi";

/** `DXGI_FORMAT_B8G8R8A8_UNORM`——WGC 与 BGRA 纹理都要求这个格式。 */
export const DXGI_FORMAT_B8G8R8A8_UNORM = 87;
/** `D3D11_USAGE_STAGING`：CPU 可读，GPU 不可渲染。 */
export const D3D11_USAGE_STAGING = 3;
/** `D3D11_CPU_ACCESS_READ`。 */
export const D3D11_CPU_ACCESS_READ = 0x20000;
/** `D3D11_MAP_READ`。 */
export const D3D11_MAP_READ = 1;

/** `IDXGIDevice`。 */
export const IID_IDXGI_DEVICE = "54ec77fa-1377-44e6-8c32-88fd5f44c84c";
/** `ID3D11Texture2D`。 */
export const IID_ID3D11_TEXTURE2D = "6f15aaf2-d208-4e89-9ab4-489535d34f9c";
/** `IDirect3DDxgiInterfaceAccess`——WinRT surface 与原生 D3D 纹理之间的桥。 */
export const IID_IDIRECT3DDXGI_INTERFACE_ACCESS = "a9b3d012-3df2-4ee3-b8d1-8695f457d3c1";

/** `ID3D11Device::CreateTexture2D` 虚表位置。 */
const DEVICE_VT_CREATE_TEXTURE_2D = 5;
/** `ID3D11DeviceContext::Map` 虚表位置。 */
const CONTEXT_VT_MAP = 14;
/** `ID3D11DeviceContext::Unmap` 虚表位置。 */
const CONTEXT_VT_UNMAP = 15;
/** `ID3D11DeviceContext::CopyResource` 虚表位置。 */
const CONTEXT_VT_COPY_RESOURCE = 47;
/** `IDirect3DDxgiInterfaceAccess::GetInterface` 虚表位置。 */
const DXGI_ACCESS_VT_GET_INTERFACE = 3;

/**
 * `D3D11_TEXTURE2D_DESC`（x64 = 44 字节）。
 *
 * `SampleCount`/`SampleQuality` 是内嵌的 `DXGI_SAMPLE_DESC`，这里展开成
 * 两个 `uint32` 而不是嵌套结构体——嵌套会让 koffi 的 `sizeof` 变成 48
 * （多出对齐填充），desc 就错了，`CreateTexture2D` 会返回 `E_INVALIDARG`。
 */
const TEXTURE2D_DESC = koffi.struct("WgcTexture2dDesc", {
  Width: "uint32",
  Height: "uint32",
  MipLevels: "uint32",
  ArraySize: "uint32",
  Format: "uint32",
  SampleCount: "uint32",
  SampleQuality: "uint32",
  Usage: "uint32",
  BindFlags: "uint32",
  CPUAccessFlags: "uint32",
  MiscFlags: "uint32",
});
// 这个变量只是为了让 koffi 注册类型名 `WgcTexture2dDesc`
// （proto 的签名里要引用它）。运行时通过对象字面量传值，
// 所以变量本身不被读取——`void` 是为了让 lint 知道这是有意为之。
void TEXTURE2D_DESC;

/** `D3D11_MAPPED_SUBRESOURCE`（x64 = 16 字节）。 */
export const MAPPED_SUBRESOURCE = koffi.struct("WgcMappedSubresource", {
  pData: "void *",
  RowPitch: "uint32",
  DepthPitch: "uint32",
});

/** `SizeInt32`——WGC 各处都用它表达尺寸。 */
export const SIZE_INT32 = koffi.struct("WgcSizeInt32", {
  width: "int32",
  height: "int32",
});

// `koffi.proto` 按名字全局注册，函数内重复定义会抛 `Duplicate type name`，
// 所以全部集中在这里声明一次。
const P_CREATE_TEXTURE_2D = koffi.proto(
  "long __stdcall WgcCreateTexture2D(void *s, const WgcTexture2dDesc *desc, " +
    "const void *initialData, _Out_ void **texture)",
);
const P_COPY_RESOURCE = koffi.proto(
  "long __stdcall WgcCopyResource(void *s, void *dst, void *src)",
);
const P_MAP = koffi.proto(
  "long __stdcall WgcMap(void *s, void *resource, uint32 subresource, int mapType, " +
    "uint32 flags, _Out_ void *mapped)",
);
const P_UNMAP = koffi.proto(
  "long __stdcall WgcUnmap(void *s, void *resource, uint32 subresource)",
);
const P_RELEASE = koffi.proto("long __stdcall WgcD3dRelease(void *s)");
const P_GET_INTERFACE = koffi.proto(
  "long __stdcall WgcGetInterface(void *s, const void *iid, _Out_ void **out)",
);

/** GUID 字符串 → COM 字节序（前三字段 little-endian，后两字段原序）。 */
export function guidBytes(text: string): Buffer {
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

/**
 * GUID 转成 koffi 管理的外部内存。
 *
 * `REFIID` 参数要的是指针，而 `koffi.address` 不接受 Node Buffer。
 * 必须用 `koffi.alloc` 分配、`koffi.encode` 写入。
 */
export function guidMemory(text: string): unknown {
  const g = guidBytes(text);
  const mem = koffi.alloc("uint8", 16);
  koffi.encode(mem, koffi.array("uint8", 16), Array.from(g));
  return mem;
}

/**
 * 取 COM 对象虚表第 index 项。
 *
 * **只解到 index+1 项**：整表解码会越界读未映射页 → 破坏堆 → 下次分配即崩。
 * 这是本项目反复踩到的坑。
 */
export function vtableEntry(comObject: unknown, index: number): unknown {
  const vtable = koffi.decode(comObject as never, "void *");
  const table = koffi.decode(vtable as never, koffi.array("void *", index + 1));
  return table[index];
}

/** 释放 COM 对象（虚表第 2 项 = Release）。 */
export function releaseCom(comObject: unknown): void {
  try {
    koffi.call(vtableEntry(comObject, 2) as never, P_RELEASE, comObject);
  } catch {
    // 已释放或无效：忽略
  }
}

// ---------------------------------------------------------------------------
// 设备
// ---------------------------------------------------------------------------

/** D3D11 设备句柄，含 WinRT 包装。 */
export interface D3dDevice {
  /** 原生 `ID3D11Device`。 */
  device: unknown;
  /** 原生 `ID3D11DeviceContext`（immediate）。 */
  context: unknown;
  /** WinRT `IDirect3DDevice`——WGC 要的是这个。 */
  graphicsDevice: unknown;
  close: () => void;
}

/**
 * 建 D3D11 设备并转成 WinRT 的 `IDirect3DDevice`。
 *
 * 参数顺序见文件头注释——那是崩溃过的坑。
 */
export function createD3dDevice(
  d3d11: koffi.IKoffiLib,
  queryInterface: (obj: unknown, iid: string, out: unknown[]) => number,
): D3dDevice | undefined {
  const levels = Buffer.alloc(4);
  levels.writeUInt32LE(0xb000, 0); // D3D_FEATURE_LEVEL_11_0

  const createDevice = d3d11.func(
    "long __stdcall D3D11CreateDevice(void *adapter, int driverType, void *software, " +
      "uint32 flags, const void *levels, uint32 levelCount, uint32 sdkVersion, " +
      "_Out_ void **device, _Out_ void **featureLevel, _Out_ void **context)",
  ) as unknown as (
    adapter: unknown,
    driverType: number,
    software: unknown,
    flags: number,
    levels: unknown,
    levelCount: number,
    sdkVersion: number,
    device: unknown[],
    featureLevel: unknown[],
    context: unknown[],
  ) => number;

  const device: unknown[] = [null];
  const featureOut: unknown[] = [null];
  const context: unknown[] = [null];
  const hr = createDevice(
    null,
    1, // D3D_DRIVER_TYPE_HARDWARE
    null,
    0x20, // D3D11_CREATE_DEVICE_BGRA_SUPPORT——WGC 必须 BGRA
    levels,
    1,
    7, // D3D11_SDK_VERSION
    device,
    featureOut,
    context,
  );
  if ((hr >>> 0) !== 0 || !device[0] || !context[0]) return undefined;

  const dxgi: unknown[] = [null];
  const hrDxgi = queryInterface(device[0], IID_IDXGI_DEVICE, dxgi);
  if ((hrDxgi >>> 0) !== 0 || !dxgi[0]) {
    releaseCom(device[0]);
    return undefined;
  }

  const graphics: unknown[] = [null];
  const hrGfx = d3d11.func(
    "long __stdcall CreateDirect3D11DeviceFromDXGIDevice(void *dxgi, _Out_ void **graphics)",
  )(dxgi[0], graphics) as number;
  releaseCom(dxgi[0]);
  if ((hrGfx >>> 0) !== 0 || !graphics[0]) {
    releaseCom(device[0]);
    releaseCom(context[0]);
    return undefined;
  }

  return {
    device: device[0],
    context: context[0],
    graphicsDevice: graphics[0],
    close: () => {
      releaseCom(graphics[0]);
      releaseCom(context[0]);
      releaseCom(device[0]);
    },
  };
}

// ---------------------------------------------------------------------------
// 纹理回读
// ---------------------------------------------------------------------------

/**
 * 建一张 staging texture（`D3D11_USAGE_STAGING` + `CPU_ACCESS_READ`）。
 *
 * 格式必须与源纹理一致，否则 `CopyResource` 返回 `E_INVALIDARG`。
 */
export function createStagingTexture(
  deviceHandle: unknown,
  size: { width: number; height: number },
): { ok: true; texture: unknown } | { ok: false; message: string } {
  const desc = {
    Width: size.width,
    Height: size.height,
    MipLevels: 1,
    ArraySize: 1,
    Format: DXGI_FORMAT_B8G8R8A8_UNORM,
    SampleCount: 1,
    SampleQuality: 0,
    Usage: D3D11_USAGE_STAGING,
    BindFlags: 0,
    CPUAccessFlags: D3D11_CPU_ACCESS_READ,
    MiscFlags: 0,
  };

  const texture: unknown[] = [null];
  const hr = koffi.call(
    vtableEntry(deviceHandle, DEVICE_VT_CREATE_TEXTURE_2D) as never,
    P_CREATE_TEXTURE_2D,
    deviceHandle,
    desc,
    null,
    texture,
  ) as number;
  if ((hr >>> 0) !== 0 || !texture[0]) {
    return {
      ok: false,
      message: `CreateTexture2D(staging) 失败（0x${(hr >>> 0).toString(16)}）。`,
    };
  }
  return { ok: true, texture: texture[0] };
}

/**
 * 把源纹理拷进 staging 并读成 BGRA 字节。
 *
 * `width`/`height` 用帧的 `ContentSize` 而不是池创建时的尺寸：
 * 窗口调整后 `ContentSize` 会小于池尺寸，多出来的区域像素未定义。
 */
export function readTextureToPixels(options: {
  context: unknown;
  staging: unknown;
  sourceTexture: unknown;
  width: number;
  height: number;
}): { ok: true; pixels: Buffer; stride: number } | { ok: false; message: string } {
  const { context, staging, sourceTexture, width, height } = options;

  const hrCopy = koffi.call(
    vtableEntry(context, CONTEXT_VT_COPY_RESOURCE) as never,
    P_COPY_RESOURCE,
    context,
    staging,
    sourceTexture,
  ) as number;
  if ((hrCopy >>> 0) !== 0) {
    return { ok: false, message: `CopyResource 失败（0x${(hrCopy >>> 0).toString(16)}）。` };
  }

  const mappedBuf = Buffer.alloc(koffi.sizeof(MAPPED_SUBRESOURCE), 0);
  const hrMap = koffi.call(
    vtableEntry(context, CONTEXT_VT_MAP) as never,
    P_MAP,
    context,
    staging,
    0,
    D3D11_MAP_READ,
    0,
    mappedBuf,
  ) as number;
  if ((hrMap >>> 0) !== 0) {
    return { ok: false, message: `Map(staging) 失败（0x${(hrMap >>> 0).toString(16)}）。` };
  }

  try {
    const mapped = koffi.decode(mappedBuf, MAPPED_SUBRESOURCE) as {
      pData: unknown;
      RowPitch: number;
    };
    if (!mapped.pData || mapped.RowPitch <= 0) {
      return { ok: false, message: "Map 返回的 pData/RowPitch 无效。" };
    }

    // 按行拷贝：RowPitch 通常大于 width*4（对齐填充，实测 686 宽 → 2752）。
    // 整块拷会把填充字节当像素，图会歪斜。
    const rowBytes = width * 4;
    const pixels = Buffer.alloc(rowBytes * height);
    // 一次性解码整块，比逐行 decode 快一个数量级（逐行各解一次会重复走 koffi 边界）
    const total = mapped.RowPitch * height;
    const raw = Buffer.from(koffi.decode(mapped.pData, koffi.array("uint8", total)) as number[]);
    for (let y = 0; y < height; y += 1) {
      raw.copy(pixels, y * rowBytes, y * mapped.RowPitch, y * mapped.RowPitch + rowBytes);
    }

    return { ok: true, pixels, stride: rowBytes };
  } finally {
    koffi.call(
      vtableEntry(context, CONTEXT_VT_UNMAP) as never,
      P_UNMAP,
      context,
      staging,
      0,
    );
  }
}

/** `IDirect3DDxgiInterfaceAccess::GetInterface` 取出底层 D3D 对象。 */
export function dxgiAccessGetInterface(access: unknown, iid: string): unknown {
  const out: unknown[] = [null];
  const hr = koffi.call(
    vtableEntry(access, DXGI_ACCESS_VT_GET_INTERFACE) as never,
    P_GET_INTERFACE,
    access,
    guidMemory(iid),
    out,
  ) as number;
  return (hr >>> 0) === 0 ? out[0] : undefined;
}
