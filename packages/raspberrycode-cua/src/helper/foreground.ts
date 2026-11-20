/**
 * 物理注入派发（三级路径）。
 *
 * 这是**唯一会真正抢占用户鼠标与键盘**的路径，spec §3.1 定为「需授权」。
 *
 * 为什么需要它：一级（消息投递）依赖宿主处理消息，二级（UIA pattern）依赖元素暴露
 * pattern。无树应用（Qt 系，spec §5.2.1）两者都不可用，只剩物理注入。
 *
 * 三条不可违反的安全边界：
 *
 * 1. **必须能完整还原用户状态**。光标位置、前台窗口在动作结束后都要回去，
 *    否则用户会发现「鼠标自己跳到别处」「焦点被抢走」，这比功能失败更让人不安。
 * 2. **必须显式授权**。本模块不做任何授权判断——判断在上层（runtime），
 *    由会话状态决定。模块本身只负责「执行」和「还原」。
 * 3. **失败也要还原**。任何一步抛错，already-done 的部分必须回滚，
 *    不能留下「光标停在目标位置」这种中间态。
 *
 * 结构体尺寸（x64）：
 *   MOUSEINPUT = dx(4) dy(4) mouseData(4) dwFlags(4) time(4) pad(4) dwExtraInfo(8) = 32
 *   INPUT      = type(4) pad(4) MOUSEINPUT(32) = 40
 * 手写 buffer 而不用 koffi.struct：SendInput 的 cbSize 必须与真实的 sizeof(INPUT)
 * 严格一致，任何对齐误差都会被系统判为参数错误（返回 0 且 GetLastError=87）。
 */

import koffi from "koffi";

/** INPUT 结构体在 x64 上的字节数。SendInput 的 cbSize 参数必须是这个值。 */
export const INPUT_STRUCT_SIZE = 40;

/** INPUT.type */
const INPUT_MOUSE = 0;

/** MOUSEEVENTF_* */
const MOUSEEVENTF = Object.freeze({
  MOVE: 0x0001,
  LEFTDOWN: 0x0002,
  LEFTUP: 0x0004,
  RIGHTDOWN: 0x0008,
  RIGHTUP: 0x0010,
  MIDDLEDOWN: 0x0020,
  MIDDLEUP: 0x0040,
  ABSOLUTE: 0x8000,
  VIRTUALDESK: 0x4000,
});

// ---------------------------------------------------------------------------
// win32 绑定
// ---------------------------------------------------------------------------

let user32: koffi.IKoffiLib | undefined;

function user(): koffi.IKoffiLib {
  if (!user32) user32 = koffi.load("user32.dll");
  return user32;
}

type RawFn = (...args: unknown[]) => number;

let fnSendInput: RawFn | undefined;
let fnGetCursorPos: RawFn | undefined;
let fnSetCursorPos: RawFn | undefined;
let fnGetForegroundWindow: RawFn | undefined;
let fnSetForegroundWindow: RawFn | undefined;

function sendInputFn(): RawFn {
  if (!fnSendInput) {
    fnSendInput = user().func(
      "uint32 __stdcall SendInput(uint32 cInputs, void *pInputs, int cbSize)",
    ) as unknown as RawFn;
  }
  return fnSendInput;
}

function getCursorPosFn(): RawFn {
  if (!fnGetCursorPos) {
    fnGetCursorPos = user().func(
      "int __stdcall GetCursorPos(_Out_ void *point)",
    ) as unknown as RawFn;
  }
  return fnGetCursorPos;
}

function setCursorPosFn(): RawFn {
  if (!fnSetCursorPos) {
    fnSetCursorPos = user().func(
      "int __stdcall SetCursorPos(int x, int y)",
    ) as unknown as RawFn;
  }
  return fnSetCursorPos;
}

function getForegroundWindowFn(): (...args: unknown[]) => unknown {
  if (!fnGetForegroundWindow) {
    fnGetForegroundWindow = user().func(
      "void *__stdcall GetForegroundWindow()",
    ) as unknown as RawFn;
  }
  return fnGetForegroundWindow as unknown as (...args: unknown[]) => unknown;
}

function setForegroundWindowFn(): RawFn {
  if (!fnSetForegroundWindow) {
    fnSetForegroundWindow = user().func(
      "int __stdcall SetForegroundWindow(void *hwnd)",
    ) as unknown as RawFn;
  }
  return fnSetForegroundWindow;
}

// ---------------------------------------------------------------------------
// 指针 ↔ 句柄
// ---------------------------------------------------------------------------

/** 句柄 bigint → koffi 指针。 */
function hwndToPointer(hwnd: bigint): unknown {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(hwnd);
  return koffi.decode(buffer, "void *");
}

/** koffi 指针 → 句柄 bigint。 */
function pointerToHwnd(pointer: unknown): bigint {
  if (!pointer) return 0n;
  const buffer = Buffer.alloc(8);
  koffi.encode(buffer, "void *", pointer);
  return buffer.readBigUInt64LE(0);
}

// ---------------------------------------------------------------------------
// 状态读取与还原
// ---------------------------------------------------------------------------

export interface DesktopState {
  cursorX: number;
  cursorY: number;
  foregroundHwnd: bigint;
}

/** 记录当前光标位置与前台窗口。动作前必须调用，作为还原依据。 */
export function captureDesktopState(): DesktopState {
  const point = Buffer.alloc(8);
  const ok = getCursorPosFn()(point) !== 0;
  return {
    cursorX: ok ? point.readInt32LE(0) : 0,
    cursorY: ok ? point.readInt32LE(4) : 0,
    foregroundHwnd: pointerToHwnd(getForegroundWindowFn()()),
  };
}

/** 光标是否在当前记录位置。用于验证零干扰是否真的成立。 */
export function isCursorAt(state: DesktopState): boolean {
  const point = Buffer.alloc(8);
  if (getCursorPosFn()(point) === 0) return false;
  return point.readInt32LE(0) === state.cursorX && point.readInt32LE(4) === state.cursorY;
}

// ---------------------------------------------------------------------------
// 注入
// ---------------------------------------------------------------------------

function buildMouseInput(flags: number, dx = 0, dy = 0): Buffer {
  const buffer = Buffer.alloc(INPUT_STRUCT_SIZE);
  buffer.writeUInt32LE(INPUT_MOUSE, 0);
  // union 从 offset 8 开始
  buffer.writeInt32LE(dx, 8);
  buffer.writeInt32LE(dy, 12);
  buffer.writeUInt32LE(0, 16); // mouseData
  buffer.writeUInt32LE(flags, 20);
  buffer.writeUInt32LE(0, 24); // time，0 表示由系统填写
  // dwExtraInfo（offset 32）保持 0
  return buffer;
}

/**
 * 一次 SendInput 调用发送多个事件。
 *
 * 为什么要合并成一次：分成多次调用会在中间被系统插入其他输入事件
 * （用户真的在动鼠标时），导致 DOWN/UP 之间出现意外状态。
 */
function sendInputs(inputs: Buffer[]): number {
  if (inputs.length === 0) return 0;
  const total = Buffer.concat(inputs);
  return sendInputFn()(inputs.length, total, INPUT_STRUCT_SIZE) as number;
}

export interface PhysicalClickOutcome {
  ok: boolean;
  /** 已注入的事件数。>0 意味着可能已产生副作用。 */
  injected: number;
  /** 是否成功把目标窗口激活到前台（三级必然的干扰）。 */
  targetActivated: boolean;
  /** 失败原因。ok 为 true 时为 undefined。 */
  reason?: string;
  /** 光标是否已回到动作前的位置——这是实测值，不是假设。 */
  cursorRestored: boolean;
  /** 前台窗口是否已回到动作前的窗口。 */
  foregroundRestored: boolean;
}

export interface PhysicalClickOptions {
  /** 目标窗口句柄。会尝试置于前台——这是三级必然的干扰。 */
  hwnd: bigint;
  screenX: number;
  screenY: number;
  button?: "left" | "right" | "middle";
  clickCount?: number;
  /**
   * 动作后停留时间。太短应用来不及处理（尤其 Electron / WPF），
   * 太长则用户被占用更久。60ms 是实测能稳定生效的最小值。
   */
  settleMs?: number;
  /** 是否恢复原前台窗口。默认 true。 */
  restoreForeground?: boolean;
  /** 是否恢复原光标位置。默认 true。 */
  restoreCursor?: boolean;
}

const BUTTON_FLAGS: Readonly<
  Record<"left" | "right" | "middle", { down: number; up: number }>
> = {
  left: { down: MOUSEEVENTF.LEFTDOWN, up: MOUSEEVENTF.LEFTUP },
  right: { down: MOUSEEVENTF.RIGHTDOWN, up: MOUSEEVENTF.RIGHTUP },
  middle: { down: MOUSEEVENTF.MIDDLEDOWN, up: MOUSEEVENTF.MIDDLEUP },
};

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  // 本函数在 Helper 的请求处理里同步执行，用 Atomics.wait 做精确定时，
  // 比 busy-loop 省 CPU，也不依赖 setTimeout 的事件循环。
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

/**
 * 物理注入点击。
 *
 * 执行顺序：
 *   记录状态 → 前台化目标窗口 → 移动光标 → DOWN/UP → 停留 → 还原 → 复查
 *
 * 还原放在 `finally` 里，且**返回值在还原之后才组装**。
 * 这样收据里的「光标已还原」是实测结果，而不是乐观假设。
 */
export function physicalClick(options: PhysicalClickOptions): PhysicalClickOutcome {
  const button = options.button ?? "left";
  const flags = BUTTON_FLAGS[button];
  const clickCount = Math.max(1, Math.min(options.clickCount ?? 1, 3));
  const settleMs = options.settleMs ?? 60;
  const restoreCursor = options.restoreCursor !== false;
  const restoreForeground = options.restoreForeground !== false;

  const before = captureDesktopState();
  const outcome = {
    ok: false,
    injected: 0,
    targetActivated: false,
    reason: undefined as string | undefined,
    cursorRestored: false,
    foregroundRestored: false,
  };

  try {
    // 三级的前提是目标窗口在前台——这正是它必然造成干扰的原因。
    // SetForegroundWindow 有时会被系统拒绝（前台锁定），此时不视为失败：
    // 注入本身仍可能生效，只是键盘事件会打到别处。鼠标事件按绝对坐标，不受影响。
    if (before.foregroundHwnd !== options.hwnd) {
      outcome.targetActivated = setForegroundWindowFn()(hwndToPointer(options.hwnd)) !== 0;
      sleepSync(30);
    } else {
      outcome.targetActivated = true;
    }

    if (setCursorPosFn()(options.screenX, options.screenY) === 0) {
      outcome.reason = `SetCursorPos 失败（${options.screenX},${options.screenY}）`;
      return outcome;
    }

    const events: Buffer[] = [];
    for (let round = 0; round < clickCount; round += 1) {
      events.push(buildMouseInput(flags.down));
      events.push(buildMouseInput(flags.up));
    }

    outcome.injected = sendInputs(events);
    if (outcome.injected !== events.length) {
      outcome.reason = `SendInput 只注入了 ${outcome.injected}/${events.length} 个事件`;
      return outcome;
    }

    sleepSync(settleMs);
    outcome.ok = true;
    return outcome;
  } catch (error) {
    outcome.reason = error instanceof Error ? error.message : String(error);
    return outcome;
  } finally {
    // 还原顺序不能反：先恢复前台窗口，系统会把光标挪进新窗口，
    // 之后再设光标位置才准确。
    if (restoreForeground && before.foregroundHwnd !== 0n && before.foregroundHwnd !== options.hwnd) {
      setForegroundWindowFn()(hwndToPointer(before.foregroundHwnd));
      sleepSync(20);
    }
    if (restoreCursor) {
      setCursorPosFn()(before.cursorX, before.cursorY);
    }
    // 复查（实测，不是假设）
    const restored = verifyRestoration(before);
    outcome.cursorRestored = restoreCursor ? restored.cursorRestored : true;
    outcome.foregroundRestored = restoreForeground ? restored.foregroundRestored : true;
  }
}

/**
 * 物理注入拖拽。
 *
 * 拖拽与点击的本质差异：**中间必须经过真实的鼠标移动**。
 * 应用不是靠 DOWN/UP 判定拖拽，而是靠按下去之后收到的 WM_MOUSEMOVE 序列——
 * 一步跳到终点会被当成「点击」而不是拖拽。所以轨迹必须插值成多步。
 *
 * 步数取 8：少于 5 步时部分应用（尤其 Chromium 的拖放）识别不到拖拽；
 * 多于 15 步收益递减，只是拖长占用时间。
 */
export function physicalDrag(options: {
  hwnd: bigint;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  button?: "left" | "right" | "middle";
  /** 轨迹插值步数。默认 8。 */
  steps?: number;
  restoreCursor?: boolean;
  restoreForeground?: boolean;
}): PhysicalClickOutcome {
  const button = options.button ?? "left";
  const flags = BUTTON_FLAGS[button];
  const steps = Math.max(5, Math.min(options.steps ?? 8, 20));
  const restoreCursor = options.restoreCursor !== false;
  const restoreForeground = options.restoreForeground !== false;

  const before = captureDesktopState();
  const outcome = {
    ok: false,
    injected: 0,
    targetActivated: false,
    reason: undefined as string | undefined,
    cursorRestored: false,
    foregroundRestored: false,
  };

  try {
    if (before.foregroundHwnd !== options.hwnd) {
      outcome.targetActivated = setForegroundWindowFn()(hwndToPointer(options.hwnd)) !== 0;
      sleepSync(30);
    } else {
      outcome.targetActivated = true;
    }

    if (setCursorPosFn()(options.fromX, options.fromY) === 0) {
      outcome.reason = `SetCursorPos 失败（起点 ${options.fromX},${options.fromY}）`;
      return outcome;
    }
    sleepSync(20);

    // 按下
    outcome.injected += sendInputs([buildMouseInput(flags.down)]);
    sleepSync(20);

    // 轨迹：每步移到插值位置。用 SetCursorPos + MOVE 事件两种方式配合——
    // 只 SetCursorPos 不产生 WM_MOUSEMOVE（系统只在物理移动时才发），
    // 所以必须显式注入 MOVE。这里用绝对坐标的 MOUSEEVENTF_MOVE。
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      const x = Math.round(options.fromX + (options.toX - options.fromX) * ratio);
      const y = Math.round(options.fromY + (options.toY - options.fromY) * ratio);
      setCursorPosFn()(x, y);
      // 相对移动 0,0 会让系统按当前位置补发一次 MOVE，从而产生 WM_MOUSEMOVE
      outcome.injected += sendInputs([buildMouseInput(MOUSEEVENTF.MOVE, 0, 0)]);
      sleepSync(12);
    }

    sleepSync(30);
    // 抬起
    outcome.injected += sendInputs([buildMouseInput(flags.up)]);
    sleepSync(40);

    outcome.ok = true;
    return outcome;
  } catch (error) {
    outcome.reason = error instanceof Error ? error.message : String(error);
    return outcome;
  } finally {
    if (
      restoreForeground &&
      before.foregroundHwnd !== 0n &&
      before.foregroundHwnd !== options.hwnd
    ) {
      setForegroundWindowFn()(hwndToPointer(before.foregroundHwnd));
      sleepSync(20);
    }
    if (restoreCursor) {
      setCursorPosFn()(before.cursorX, before.cursorY);
    }
    const restored = verifyRestoration(before);
    outcome.cursorRestored = restoreCursor ? restored.cursorRestored : true;
    outcome.foregroundRestored = restoreForeground ? restored.foregroundRestored : true;
  }
}

/**
 * 物理注入后的完整还原检查。
 *
 * 独立成函数的理由：收据里的「光标已还原」必须是**实测结果**而非乐观假设。
 * 调用方在 finally 里做完还原动作后，用它复查一次再填收据。
 */
export function verifyRestoration(before: DesktopState): {
  cursorRestored: boolean;
  foregroundRestored: boolean;
} {
  return {
    cursorRestored: isCursorAt(before),
    foregroundRestored: pointerToHwnd(getForegroundWindowFn()()) === before.foregroundHwnd,
  };
}

/**
 * 把光标移回指定位置。
 *
 * 供键盘/滚轮这类「顺手移动了光标」的操作使用——它们不像点击那样
 * 有完整的 physicalXxx 封装，需要自己管理还原。
 */
export function restoreCursorTo(state: DesktopState): boolean {
  return setCursorPosFn()(state.cursorX, state.cursorY) !== 0;
}
