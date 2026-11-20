/**
 * 消息投递派发（一级路径）。
 *
 * 这是唯一实测确认「真实生效 + 零干扰」的路径（spec §1.12）：
 * 在 Chromium 宿主上对复选框发 WM_LBUTTONDOWN/UP，ToggleState 稳定交替，
 * 光标与前台窗口完全未变。
 *
 * 与 UIA 的关键差异（spec §2）：
 * UIA 的 InvokePattern 会把目标窗口激活到前台（实测四个 pattern 全部如此），
 * 而 PostMessage 只是把消息放进目标窗口的消息队列，是否处理由应用自己决定。
 * 代价是覆盖面依赖宿主的消息处理实现。
 *
 * HWND 类型约定：本模块内部一律用 bigint 表示句柄。UIA 的 NativeWindowHandle
 * 属性是 VT_I4（有符号 32 位），读出负数说明高位被截断，需要按无符号还原。
 */

import koffi from "koffi";

/** Windows 消息常量。只列出本模块用到的。 */
export const WM = Object.freeze({
  MOUSEMOVE: 0x0200,
  LBUTTONDOWN: 0x0201,
  LBUTTONUP: 0x0202,
  RBUTTONDOWN: 0x0204,
  RBUTTONUP: 0x0205,
  MBUTTONDOWN: 0x0207,
  MBUTTONUP: 0x0208,
  MOUSEWHEEL: 0x020a,
  KEYDOWN: 0x0100,
  KEYUP: 0x0101,
  CHAR: 0x0102,
});

export type MouseButton = "left" | "right" | "middle";

const BUTTON_MESSAGES: Readonly<
  Record<MouseButton, { down: number; up: number; flag: number }>
> = {
  left: { down: WM.LBUTTONDOWN, up: WM.LBUTTONUP, flag: 0x0001 },
  right: { down: WM.RBUTTONDOWN, up: WM.RBUTTONUP, flag: 0x0002 },
  middle: { down: WM.MBUTTONDOWN, up: WM.MBUTTONUP, flag: 0x0010 },
};

/** CWP_SKIPINVISIBLE | CWP_SKIPDISABLED | CWP_SKIPTRANSPARENT */
const CWP_SKIP_ALL = 0x1 | 0x2 | 0x4;

// ---------------------------------------------------------------------------
// win32 绑定
// ---------------------------------------------------------------------------

let user32: koffi.IKoffiLib | undefined;

function user(): koffi.IKoffiLib {
  if (!user32) user32 = koffi.load("user32.dll");
  return user32;
}

/**
 * 导出函数在模块加载时绑定一次。
 *
 * 不用集中式 `koffi.proto`：proto 是给「函数指针」用的（COM 虚表），
 * 导出函数要用 `lib.func`。每次调用都 `lib.func(...)` 会重复建绑定，
 * 在连点循环里会累积开销，所以在模块级缓存。
 */
let fnPostMessage: ((...args: unknown[]) => number) | undefined;
let fnScreenToClient: ((...args: unknown[]) => number) | undefined;
let fnChildWindowFromPointEx: ((...args: unknown[]) => unknown) | undefined;

function postMessageFn() {
  if (!fnPostMessage) {
    fnPostMessage = user().func(
      "int __stdcall PostMessageW(void *hwnd, uint32 msg, uintptr wParam, intptr lParam)",
    ) as unknown as (...args: unknown[]) => number;
  }
  return fnPostMessage;
}

function screenToClientFn() {
  if (!fnScreenToClient) {
    fnScreenToClient = user().func(
      "int __stdcall ScreenToClient(void *hwnd, _Inout_ void *point)",
    ) as unknown as (...args: unknown[]) => number;
  }
  return fnScreenToClient;
}

function childWindowFromPointExFn() {
  if (!fnChildWindowFromPointEx) {
    fnChildWindowFromPointEx = user().func(
      "void *__stdcall ChildWindowFromPointEx(void *parent, void *point, uint32 flags)",
    ) as unknown as (...args: unknown[]) => unknown;
  }
  return fnChildWindowFromPointEx;
}

let fnIsIconic: ((...args: unknown[]) => number) | undefined;

function isIconicFn() {
  if (!fnIsIconic) {
    fnIsIconic = user().func("int __stdcall IsIconic(void *hwnd)") as unknown as (
      ...args: unknown[]
    ) => number;
  }
  return fnIsIconic;
}

/**
 * 窗口是否已最小化。
 *
 * 最小化时客户区被销毁（实测 `ClientRect=0x0`），窗口不再有绘图表面。
 * 此时消息投递会「成功入队但无人处理」，因此必须在派发前拦下。
 */
function isWindowMinimized(hwnd: bigint): boolean {
  return isIconicFn()(hwndToPointer(hwnd)) !== 0;
}

/** 句柄 bigint → koffi 指针。 */
function hwndToPointer(hwnd: bigint): unknown {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(hwnd);
  return koffi.decode(buffer, "void *");
}

/** koffi 指针 → 句柄 bigint。 */
function pointerToHwnd(pointer: unknown): bigint {
  if (!pointer) return 0n;
  // koffi 不提供「指针 → 整数」的直接转换；用一个临时 buffer 承载指针值再读出。
  // encode 把指针写入目标 buffer（按 void * 的宽度），这是唯一可靠的往返方式。
  const buffer = Buffer.alloc(8);
  koffi.encode(buffer, "void *", pointer);
  return buffer.readBigUInt64LE(0);
}

function postMessage(hwnd: bigint, msg: number, wParam: number, lParam: number): boolean {
  return postMessageFn()(hwndToPointer(hwnd), msg, wParam, lParam) !== 0;
}

function screenToClient(hwnd: bigint, pointBuffer: Buffer): void {
  screenToClientFn()(hwndToPointer(hwnd), pointBuffer);
}

function childWindowFromPointEx(parent: bigint, pointBuffer: Buffer): bigint {
  const child = childWindowFromPointExFn()(hwndToPointer(parent), pointBuffer, CWP_SKIP_ALL);
  return pointerToHwnd(child);
}

// ---------------------------------------------------------------------------
// 坐标与句柄解析
// ---------------------------------------------------------------------------

/** 坐标打包成 lParam。低 16 位 x，高 16 位 y，各自按有符号 16 位截断。 */
export function packPoint(x: number, y: number): number {
  return ((y & 0xffff) << 16) | (x & 0xffff);
}

export interface ResolvedTarget {
  hwnd: bigint;
  clientX: number;
  clientY: number;
  /** 从顶层窗口下钻的层数。0 表示目标就是顶层窗口本身。 */
  depth: number;
}

/**
 * 从屏幕坐标解析最深的目标 HWND。
 *
 * 为什么必须下钻：PostMessage 投给顶层窗口时，很多框架不会把消息转发给
 * 实际的子控件，表现为「消息入队成功但动作不生效」。逐层 ChildWindowFromPointEx
 * 才能找到真正消费鼠标消息的那个子窗口。
 */
export function resolveTargetHwnd(
  rootHwnd: bigint,
  screenX: number,
  screenY: number,
): ResolvedTarget {
  const pointBuffer = Buffer.alloc(8);
  pointBuffer.writeInt32LE(screenX, 0);
  pointBuffer.writeInt32LE(screenY, 4);

  // 转成相对顶层窗口的客户区坐标——后续所有消息都用这个坐标系
  screenToClient(rootHwnd, pointBuffer);
  const clientX = pointBuffer.readInt32LE(0);
  const clientY = pointBuffer.readInt32LE(4);

  let current = rootHwnd;
  let depth = 0;
  for (let index = 0; index < 8; index += 1) {
    const child = childWindowFromPointEx(current, pointBuffer);
    if (child === 0n || child === current) break;
    current = child;
    depth += 1;
  }

  return { hwnd: current, clientX, clientY, depth };
}

/**
 * 把 UIA 读出的 NativeWindowHandle 规范化为 bigint。
 *
 * VT_I4 是有符号的：句柄高位为 1 时读出负数。按无符号还原才得到真实句柄。
 */
export function normalizeHwnd(raw: number | undefined): bigint | undefined {
  if (raw === undefined || raw === 0) return undefined;
  return BigInt(raw >>> 0);
}

// ---------------------------------------------------------------------------
// 派发
// ---------------------------------------------------------------------------

export interface DispatchMessageResult {
  name: string;
  ok: boolean;
}

export interface PostClickResult {
  /**
   * 是否所有消息都成功入队。
   *
   * 注意语义边界：入队成功 ≠ 应用处理了。要确认生效必须读回状态
   * （如 ToggleState），这属于调用方的责任。
   */
  dispatched: boolean;
  /**
   * 未派发时的原因。
   *
   * 存在的必要性：`PostMessage` 返回成功只代表消息进了队列，
   * 不代表被处理——这是该 API 的固有语义。当目标窗口最小化时，
   * 客户区被销毁（`ClientRect=0x0`），消息发出去无人处理，
   * 表现为「既没生效也没报错」。那种静默失败比明确拒绝糟糕得多。
   */
  reason?: "target_minimized" | "target_unavailable";
  targetDepth: number;
  clientX: number;
  clientY: number;
  messages: DispatchMessageResult[];
}

export interface PostClickOptions {
  rootHwnd: bigint;
  screenX: number;
  screenY: number;
  button?: MouseButton;
  clickCount?: number;
}

/**
 * 用消息投递执行点击。
 *
 * 消息序列贴近真实点击：先 MOUSEMOVE 定位，再 DOWN/UP。
 * 缺少 MOVE 时部分控件（尤其是依赖 hover 状态初始化的）会忽略后续点击。
 */
export function postClick(options: PostClickOptions): PostClickResult {
  // 最小化的窗口客户区已销毁（实测 ClientRect=0x0），
  // 消息投递到那里不会有人处理。必须在这里拒绝，
  // 否则调用方收到的 dispatched=true 是假的。
  if (isWindowMinimized(options.rootHwnd)) {
    return {
      dispatched: false,
      reason: "target_minimized",
      targetDepth: 0,
      clientX: 0,
      clientY: 0,
      messages: [],
    };
  }

  const button = options.button ?? "left";
  const messages = BUTTON_MESSAGES[button];
  const clickCount = Math.max(1, Math.min(options.clickCount ?? 1, 3));

  const target = resolveTargetHwnd(options.rootHwnd, options.screenX, options.screenY);
  const position = packPoint(target.clientX, target.clientY);
  const results: DispatchMessageResult[] = [];

  for (let round = 0; round < clickCount; round += 1) {
    results.push({
      name: "mousemove",
      ok: postMessage(target.hwnd, WM.MOUSEMOVE, 0, position),
    });
    results.push({
      name: "buttondown",
      ok: postMessage(target.hwnd, messages.down, messages.flag, position),
    });
    results.push({
      name: "buttonup",
      ok: postMessage(target.hwnd, messages.up, 0, position),
    });
  }

  return {
    dispatched: results.every((item) => item.ok),
    targetDepth: target.depth,
    clientX: target.clientX,
    clientY: target.clientY,
    messages: results,
  };
}

/**
 * 用消息投递执行悬停。
 *
 * 单独暴露的理由：悬停本身是合法操作（展开 hover 菜单、显示提示），
 * 同时它也是验证「消息是否被处理」最安全的探针——即使被处理也无副作用。
 */
export function postHover(options: {
  rootHwnd: bigint;
  screenX: number;
  screenY: number;
}): PostClickResult {
  const target = resolveTargetHwnd(options.rootHwnd, options.screenX, options.screenY);
  const ok = postMessage(target.hwnd, WM.MOUSEMOVE, 0, packPoint(target.clientX, target.clientY));
  return {
    dispatched: ok,
    targetDepth: target.depth,
    clientX: target.clientX,
    clientY: target.clientY,
    messages: [{ name: "mousemove", ok }],
  };
}
