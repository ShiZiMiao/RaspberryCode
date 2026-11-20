/**
 * 窗口画面回传（截图）。
 *
 * 用途：无障碍树拿不到内容的场景——Qt 系应用整棵树只有 1 个节点（spec §1.7），
 * 只能靠像素判断界面状态。
 *
 * 路线选择：`PrintWindow(PW_RENDERFULLCONTENT)` 而不是 `BitBlt`。
 *
 * - `BitBlt` 只能复制**屏幕上可见**的部分，被遮挡或最小化时拿到的是别人的内容
 * - `PrintWindow` 让窗口自己往内存 DC 里绘制，不要求窗口可见、不要求在前台
 *
 * 这是唯一能保持「不抢焦点」的截图方式。代价是部分应用（尤其硬件加速渲染的）
 * 会返回空白图，因此 `screenshot_blank` 必须作为一等状态报告，
 * 而不是把空白图当成有效结果交上去。
 *
 * spec §1.5 已验证 `PrintWindow(PW_RENDERFULLCONTENT)` 在纯 Node 下可用
 * （1309×1001 真实像素）。
 */

import koffi from "koffi";
import { crc32, deflateSync } from "node:zlib";
import { isWindowOffscreen } from "./window-visibility.ts";

/** 截图结果。 */
export interface WindowCapture {
  ok: boolean;
  /** PNG 编码后的字节。失败时为空。 */
  png?: Buffer;
  width: number;
  height: number;
  /**
   * 图像是否全为同一颜色（通常意味着窗口没有真正绘制）。
   *
   * 这是个**必须回报的事实**：硬件加速的窗口（Chromium / WPF 部分模式）
   * 经常给出纯黑图，如果当成有效截图交给模型，它会基于空白图做出错误判断。
   */
  blank: boolean;
  /**
   * 画面可能已冻结（内容不再更新）。
   *
   * 判定依据：窗口完全在屏幕外。实测（2026-11-19）此时 PrintWindow
   * 仍能返回**完整且结构正确**的画面，但内容是**冻在最后一帧**的：
   * 40 次连续采集只有 1 个唯一帧；agent 改值后截图字节与改前完全一致。
   *
   * 这是个必须回报的事实——否则调用方会把过期画面当成当前状态。
   * 与 `blank` 的区别：`blank` 是「一片纯色，没有信息」，
   * `mayBeFrozen` 是「有信息，但可能不是此刻的信息」。
   * 后者更难被发现，所以更要说清楚。
   */
  mayBeFrozen: boolean;
  /** 失败原因或关于结果可靠性的说明。 */
  reason?: string;
}

let user32: koffi.IKoffiLib | undefined;
let gdi32: koffi.IKoffiLib | undefined;

function u32() {
  user32 ??= koffi.load("user32.dll");
  return user32;
}
function g32() {
  gdi32 ??= koffi.load("gdi32.dll");
  return gdi32;
}

/** PW_RENDERFULLCONTENT —— 让窗口连同其子内容（含 DWM 合成结果）一起绘制。 */
const PW_RENDERFULLCONTENT = 0x00000002;

/** BITMAPINFOHEADER 后接调色板/掩码；32bpp 时结构总长 40 + 0。 */
const BITMAPINFOHEADER = koffi.struct("SH_BIH", {
  biSize: "uint32",
  biWidth: "int32",
  biHeight: "int32",
  biPlanes: "uint16",
  biBitCount: "uint16",
  biCompression: "uint32",
  biSizeImage: "uint32",
  biXPelsPerMeter: "int32",
  biYPelsPerMeter: "int32",
  biClrUsed: "uint32",
  biClrImportant: "uint32",
});

const BI_RGB = 0;
const DIB_RGB_COLORS = 0;
const SRCCOPY = 0x00cc0020;

interface CaptureApi {
  capture: (hwnd: bigint) => {
    ok: boolean;
    width: number;
    height: number;
    /** BGRA 像素，自下而上（DIB 默认方向）。 */
    pixels?: Buffer;
    reason?: string;
  };
}

let capi: CaptureApi | undefined;

function captureApi(): CaptureApi {
  if (capi) return capi;

  const GetWindowDC = u32().func("void *__stdcall GetWindowDC(void *hwnd)");
  const ReleaseDC = u32().func("int __stdcall ReleaseDC(void *hwnd, void *dc)");
  const PrintWindow = u32().func("int __stdcall PrintWindow(void *hwnd, void *dc, uint32 flags)");
  const GetWindowRect = u32().func("int __stdcall GetWindowRect(void *hwnd, _Out_ void *rect)");
  const IsWindow = u32().func("int __stdcall IsWindow(void *hwnd)");
  const IsIconic = u32().func("int __stdcall IsIconic(void *hwnd)");

  const CreateCompatibleDC = g32().func("void *__stdcall CreateCompatibleDC(void *dc)");
  const CreateCompatibleBitmap = g32().func(
    "void *__stdcall CreateCompatibleBitmap(void *dc, int w, int h)",
  );
  const SelectObject = g32().func("void *__stdcall SelectObject(void *dc, void *obj)");
  const DeleteObject = g32().func("int __stdcall DeleteObject(void *obj)");
  const DeleteDC = g32().func("int __stdcall DeleteDC(void *dc)");
  const GetDIBits = g32().func(
    "int __stdcall GetDIBits(void *dc, void *bmp, uint32 start, uint32 lines, void *bits, void *bmi, uint32 usage)",
  );
  const BitBlt = g32().func(
    "int __stdcall BitBlt(void *dst, int x, int y, int w, int h, void *src, int sx, int sy, uint32 rop)",
  );

  capi = {
    capture: (hwnd) => {
      const hwndPtr = bigintToPointer(hwnd);
      if (!IsWindow(hwndPtr)) return { ok: false, width: 0, height: 0, reason: "窗口句柄无效" };

      const rect = Buffer.alloc(16);
      if (!GetWindowRect(hwndPtr, rect)) {
        return { ok: false, width: 0, height: 0, reason: "读取窗口尺寸失败" };
      }
      const width = rect.readInt32LE(8) - rect.readInt32LE(0);
      const height = rect.readInt32LE(12) - rect.readInt32LE(4);
      if (width <= 0 || height <= 0) {
        return { ok: false, width: 0, height: 0, reason: `窗口尺寸无效（${width}x${height}）` };
      }

      const windowDc = GetWindowDC(hwndPtr);
      if (!windowDc) return { ok: false, width, height, reason: "GetWindowDC 失败" };

      const memDc = CreateCompatibleDC(windowDc);
      if (!memDc) {
        ReleaseDC(hwndPtr, windowDc);
        return { ok: false, width, height, reason: "CreateCompatibleDC 失败" };
      }

      const bitmap = CreateCompatibleBitmap(windowDc, width, height);
      if (!bitmap) {
        DeleteDC(memDc);
        ReleaseDC(hwndPtr, windowDc);
        return { ok: false, width, height, reason: "CreateCompatibleBitmap 失败" };
      }

      const old = SelectObject(memDc, bitmap);
      try {
        // **最小化时客户区会被销毁，PrintWindow 拿不到内容。**
        //
        // 实测（2026-11-19，Electron/Chromium）：
        //   正常：  WindowRect=620x440  ClientRect=604x401  → 采样 100% 非黑
        //   最小化：WindowRect=160x28   **ClientRect=0x0**  → 采样 1.4% 非黑（只有标题栏）
        //
        // 关键证据是 `ClientRect` 变成 0x0：那个窗口的客户区在最小化时
        // 不再有绘图表面。PrintWindow 虽然仍返回成功，
        // 但画出来的是标题栏那一小块，不是应用内容。
        //
        // 为什么不能用「采样非黑比例」判断：在最小化时按原尺寸采样，
        // 采到的区域已经被桌面上**别的窗口**填充，比例反而很高（假阳性）。
        // 判据必须是「客户区尺寸」，不是像素颜色。
        if (IsIconic(hwndPtr) || width <= 0 || height <= 0) {
          return {
            ok: false,
            width,
            height,
            reason:
              "窗口已最小化：客户区被销毁（ClientRect=0x0），无法采集画面。" +
              "元素级操作（读树、set_value、Toggle）不受影响，仍可继续；" +
              "只有需要画面的场景才需要还原窗口。",
          };
        }

        const printed = PrintWindow(hwndPtr, memDc, PW_RENDERFULLCONTENT) !== 0;

        // PrintWindow 返回 0 时尝试 BitBlt 兜底：部分老应用不支持 PrintWindow，
        // 但只要窗口在屏幕上可见，BitBlt 能拿到真实像素。
        if (!printed) {
          BitBlt(memDc, 0, 0, width, height, windowDc, 0, 0, SRCCOPY);
        }

        const header = Buffer.alloc(koffi.sizeof(BITMAPINFOHEADER));
        koffi.encode(header, BITMAPINFOHEADER, {
          biSize: koffi.sizeof(BITMAPINFOHEADER),
          biWidth: width,
          // 负数表示自上而下，正好对上 PNG 的行序，省一次翻转
          biHeight: -height,
          biPlanes: 1,
          biBitCount: 32,
          biCompression: BI_RGB,
          biSizeImage: 0,
          biXPelsPerMeter: 0,
          biYPelsPerMeter: 0,
          biClrUsed: 0,
          biClrImportant: 0,
        });

        const pixels = Buffer.alloc(width * height * 4);
        const lines = GetDIBits(memDc, bitmap, 0, height, pixels, header, DIB_RGB_COLORS) as number;
        if (lines === 0) {
          return { ok: false, width, height, reason: "GetDIBits 失败" };
        }

        return { ok: true, width, height, pixels };
      } finally {
        SelectObject(memDc, old);
        DeleteObject(bitmap);
        DeleteDC(memDc);
        ReleaseDC(hwndPtr, windowDc);
      }
    },
  };

  return capi;
}

function bigintToPointer(hwnd: bigint): unknown {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(hwnd);
  return koffi.decode(buf, "void *");
}

/**
 * 判断像素是否全同色。
 *
 * 采样而不是全扫：全扫 1920×1080 要读 800 万像素，只为判断「是不是一片黑」不值得。
 * 均匀取 512 个点足够识别纯色情况——真有一小块内容差异时，
 * 那种截图本身也不具备判读价值。
 */
function isBlankPixels(pixels: Buffer): boolean {
  if (pixels.length < 4) return true;
  const total = Math.floor(pixels.length / 4);
  const step = Math.max(1, Math.floor(total / 512));
  const first = pixels.readUInt32LE(0);
  for (let i = step; i < total; i += step) {
    if (pixels.readUInt32LE(i * 4) !== first) return false;
  }
  return true;
}

/**
 * 抓取窗口画面，返回 PNG。
 *
 * PNG 编码交给 Node 的 zlib 手写（见 `encodePng`）而不是引第三方库：
 * 这边只需要「BGRA → PNG」这一条路径，引一个图像库会带来原生依赖，
 * 而本包的定位是尽量少依赖（koffi 之外不加东西）。
 */
export function captureWindow(hwnd: bigint): WindowCapture {
  const raw = captureApi().capture(hwnd);
  if (!raw.ok || !raw.pixels) {
    return {
      ok: false,
      width: raw.width,
      height: raw.height,
      blank: false,
      mayBeFrozen: false,
      reason: raw.reason ?? "截图失败",
    };
  }

  const blank = isBlankPixels(raw.pixels);
  // 窗口完全在屏幕外时，DWM 不再重新合成它，画面会冻在最后一帧。
  // 仍然截得到图（结构完整），但内容不可信——必须标出来。
  const frozen = isWindowOffscreen(hwnd);
  return {
    ok: true,
    png: encodePng(raw.pixels, raw.width, raw.height),
    width: raw.width,
    height: raw.height,
    blank,
    mayBeFrozen: frozen,
    reason: blank
      ? "截图成功但内容为纯色（窗口可能用硬件加速渲染，未真正绘制）"
      : frozen
        ? "截图成功，但窗口完全在屏幕外，画面可能已冻结（不再随内容更新）。" +
          "请把窗口移到屏幕边缘留 1~2px 可见，或还原窗口后再截图。"
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// PNG 编码
// ---------------------------------------------------------------------------

/**
 * 把 BGRA 像素编码为 PNG。
 *
 * 只实现必要子集：8 位 RGBA、无隔行、单一 IDAT。PNG 规范里这些足够表达截图。
 * 用 zlib 的同步 deflate，避免引入异步流——截图调用点都是同步语义。
 */
export function encodePng(bgra: Buffer, width: number, height: number): Buffer {
  // 每行前加一个 filter 字节（0 = None）。不用其他 filter 是因为
  // 截图内容差异大，filter 预测收益不稳定，而 None 的编码/解码都最快。
  const stride = width * 4;
  const rawLength = (stride + 1) * height;
  const raw = Buffer.alloc(rawLength);
  for (let y = 0; y < height; y += 1) {
    const src = y * stride;
    const dst = y * (stride + 1);
    raw[dst] = 0;
    // BGRA → RGBA
    for (let x = 0; x < width; x += 1) {
      const s = src + x * 4;
      const d = dst + 1 + x * 4;
      raw[d] = bgra[s + 2];
      raw[d + 1] = bgra[s + 1];
      raw[d + 2] = bgra[s];
      // alpha 恒为 255：窗口截图没有透明语义，
      // DIB 的 alpha 通道经常是 0，直接用会让整张图变全透明。
      raw[d + 3] = 255;
    }
  }

  const idat = deflateSync(raw, { level: 6 });

  const chunks: Buffer[] = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  chunks.push(pngChunk("IHDR", ihdr));
  chunks.push(pngChunk("IDAT", idat));
  chunks.push(pngChunk("IEND", Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])) >>> 0, 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}
