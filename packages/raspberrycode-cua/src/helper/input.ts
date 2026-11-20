/**
 * 键盘与滚动输入。
 *
 * 与 `foreground.ts` 的分工：
 * - 本模块只管「怎么把输入发出去」，不判断预算与授权
 * - 授权与预算判断在 `windows-helper.ts` 的 act 里，本模块被调用时已确认过
 *
 * 两条路径的取舍：
 * - **消息投递**（`WM_KEYDOWN`/`WM_MOUSEWHEEL`）：零干扰，但键盘消息对多数现代框架
 *   无效——Chromium 完全忽略投递给它的 `WM_KEYDOWN`（它只认真实的输入队列）。
 * - **物理注入**（`SendInput`）：必生效，但抢键鼠。
 *
 * 因此键盘默认走物理注入，滚动优先尝试消息投递。这个差异是实测结论，不是偏好：
 * Chromium 的鼠标单击能通过消息投递生效，键盘不能——因为鼠标有坐标可以走命中测试，
 * 键盘依赖焦点，而焦点只属于前台窗口。
 */

import koffi from "koffi";

/** 键盘事件的 KEYEVENTF_* 标志。 */
const KEYEVENTF = Object.freeze({
  EXTENDEDKEY: 0x0001,
  KEYUP: 0x0002,
  UNICODE: 0x0004,
  SCANCODE: 0x0008,
});

/** 虚拟键码。只列本模块映射表用到的。 */
const VK = Object.freeze({
  BACK: 0x08,
  TAB: 0x09,
  RETURN: 0x0d,
  SHIFT: 0x10,
  CONTROL: 0x11,
  MENU: 0x12, // Alt
  PAUSE: 0x13,
  CAPITAL: 0x14,
  ESCAPE: 0x1b,
  SPACE: 0x20,
  PRIOR: 0x21, // PageUp
  NEXT: 0x22, // PageDown
  END: 0x23,
  HOME: 0x24,
  LEFT: 0x25,
  UP: 0x26,
  RIGHT: 0x27,
  DOWN: 0x28,
  INSERT: 0x2d,
  DELETE: 0x2e,
  LWIN: 0x5b,
  RWIN: 0x5c,
  APPS: 0x5d,
});

/**
 * 单键名 → 虚拟键码。
 *
 * 键名集合按 SDK 的 `KEY_ALIASES` 输出对齐（`normalizeKeyChord` 的产物）：
 * 它已经把 `control_l`、`prior`、`period` 这类写法规范化成 `ctrl` / `pageup` / `.`。
 * 这里必须接住那套 token，否则 SDK 层合法、执行层报「未知键」。
 */
const KEY_TO_VK: Readonly<Record<string, number>> = {
  return: VK.RETURN,
  enter: VK.RETURN,
  tab: VK.TAB,
  esc: VK.ESCAPE,
  escape: VK.ESCAPE,
  space: VK.SPACE,
  backspace: VK.BACK,
  delete: VK.DELETE,
  del: VK.DELETE,
  insert: VK.INSERT,
  home: VK.HOME,
  end: VK.END,
  pageup: VK.PRIOR,
  pagedown: VK.NEXT,
  left: VK.LEFT,
  right: VK.RIGHT,
  up: VK.UP,
  down: VK.DOWN,
  ctrl: VK.CONTROL,
  control: VK.CONTROL,
  shift: VK.SHIFT,
  alt: VK.MENU,
  win: VK.LWIN,
  super: VK.LWIN,
  meta: VK.LWIN,
  caps: VK.CAPITAL,
  pause: VK.PAUSE,
  apps: VK.APPS,
};

/**
 * 单个字符 → 虚拟键码。
 *
 * 只覆盖「VK 码等于 ASCII 码」的字符：A-Z 与 0-9。
 * 小写字母要先转大写——SDK 规范化后的键名都是小写（`ctrl+a`），
 * 而 VK 码定义的是大写（`0x41` = A）。这一步漏了会让所有字母组合键失效。
 *
 * 标点符号刻意不映射：它们的 VK 是 OEM 键，码值随键盘布局变化，
 * 硬编码在某一种布局上会在另一种布局下发错键。这类输入走 Unicode 通道。
 */
function charToVk(char: string): number | undefined {
  if (char.length !== 1) return undefined;
  const upper = char.toUpperCase();
  const code = upper.charCodeAt(0);
  // A-Z
  if (code >= 65 && code <= 90) return code;
  // 0-9
  const digitCode = char.charCodeAt(0);
  if (digitCode >= 48 && digitCode <= 57) return digitCode;
  return undefined;
}

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
let fnPostMessage: RawFn | undefined;

function sendInputFn(): RawFn {
  if (!fnSendInput) {
    fnSendInput = user().func(
      "uint32 __stdcall SendInput(uint32 cInputs, void *pInputs, int cbSize)",
    ) as unknown as RawFn;
  }
  return fnSendInput;
}

function postMessageFn(): RawFn {
  if (!fnPostMessage) {
    fnPostMessage = user().func(
      "int __stdcall PostMessageW(void *hwnd, uint32 msg, uintptr wParam, intptr lParam)",
    ) as unknown as RawFn;
  }
  return fnPostMessage;
}

function hwndToPointer(hwnd: bigint): unknown {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(hwnd);
  return koffi.decode(buffer, "void *");
}

/** INPUT 结构在 x64 上恒为 40 字节。KEYBDINPUT 与 MOUSEINPUT 同宽。 */
const INPUT_STRUCT_SIZE = 40;
const INPUT_KEYBOARD = 1;

/**
 * 构造一个键盘 INPUT。
 *
 * x64 INPUT 布局：
 *   offset 0:  type(4) + pad(4)
 *   offset 8:  union { MOUSEINPUT | KEYBDINPUT | HARDWAREINPUT }
 *   offset 40: （结构结束）
 *
 * KEYBDINPUT 在 union 内的布局：
 *   offset 8:  wVk(2) wScan(2) dwFlags(4) time(4) pad(4) dwExtraInfo(8)
 *
 * 注意 `time` 之后有 4 字节 padding 再是 `dwExtraInfo`——这是 x64 的指针对齐要求。
 * 手写 buffer 必须精确，否则 SendInput 返回 0 且 `GetLastError=87`（参数错误）。
 */
function buildKeyboardInput(vk: number, scan: number, flags: number): Buffer {
  const buffer = Buffer.alloc(INPUT_STRUCT_SIZE);
  buffer.writeUInt32LE(INPUT_KEYBOARD, 0);
  buffer.writeUInt16LE(vk, 8);
  buffer.writeUInt16LE(scan, 10);
  buffer.writeUInt32LE(flags, 12);
  buffer.writeUInt32LE(0, 16); // time，0 表示由系统填写
  buffer.writeUInt32LE(0, 20); // padding
  // dwExtraInfo 在 offset 24，保持 0
  return buffer;
}

function sendInputs(inputs: Buffer[]): number {
  if (inputs.length === 0) return 0;
  const total = Buffer.concat(inputs);
  return sendInputFn()(inputs.length, total, INPUT_STRUCT_SIZE) as number;
}

// ---------------------------------------------------------------------------
// 键序列解析
// ---------------------------------------------------------------------------

/**
 * 修饰键。顺序按「按下」时的发送顺序（Ctrl → Shift → Alt → Win），
 * 「抬起」时反序——这与用户手动按键的物理顺序一致，避免组合键被识别错。
 */
const MODIFIER_ORDER = ["ctrl", "shift", "alt", "win"] as const;

interface ParsedChord {
  modifiers: string[];
  /** 主键 token。可能为空（纯修饰键断言，如只按 Ctrl）。 */
  key: string | undefined;
}

/**
 * 解析 `ctrl+shift+a` 这类组合。
 *
 * 拆法必须从**右往左**识别修饰键：`ctrl+shift+ctrl` 这种少见写法里
 * 最后一个才是主键位置——虽然这种用法本身可疑，但从左往右会把主键误判成修饰键。
 * 反过来更稳：从末尾取第一个非修饰键作为主键。
 */
export function parseChord(chord: string): ParsedChord {
  const tokens = chord
    .split("+")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase());

  const modifiers: string[] = [];
  const keys: string[] = [];
  for (const token of tokens) {
    if ((MODIFIER_ORDER as readonly string[]).includes(token)) {
      modifiers.push(token);
    } else {
      keys.push(token);
    }
  }

  return {
    // 按固定顺序排，保证同一组合的不同写法产生相同序列
    modifiers: MODIFIER_ORDER.filter((m) => modifiers.includes(m)),
    key: keys[keys.length - 1],
  };
}

function modifierVk(name: string): number {
  return KEY_TO_VK[name] ?? 0;
}

// ---------------------------------------------------------------------------
// 键盘发送
// ---------------------------------------------------------------------------

export interface KeySendResult {
  ok: boolean;
  injected: number;
  /** 未能识别的键名，供错误文本使用。 */
  unknownKey?: string;
}

/**
 * 发送一个键或组合键。
 *
 * 用物理注入而非消息投递：键盘消息依赖焦点，投递给后台窗口的 `WM_KEYDOWN`
 * 在 Chromium、WPF、WinUI 上都被忽略（实测）。要真正生效只能注入输入队列。
 *
 * **调用方必须已确认授权与预算**——这里是纯粹的「执行」层。
 */
export function sendKeyChord(chord: string, holdMs = 0): KeySendResult {
  const parsed = parseChord(chord);

  // 纯修饰键组合（如只按 Ctrl）：按下再抬起，中间停留。
  // 这是合法用法（部分应用用单修饰键触发提示层）。
  const key = parsed.key;
  if (key === undefined) {
    const press: Buffer[] = [];
    for (const modifier of parsed.modifiers) {
      const vk = modifierVk(modifier);
      if (vk !== 0) press.push(buildKeyboardInput(vk, 0, 0));
    }
    const release: Buffer[] = [];
    for (const modifier of [...parsed.modifiers].reverse()) {
      const vk = modifierVk(modifier);
      if (vk !== 0) release.push(buildKeyboardInput(vk, 0, KEYEVENTF.KEYUP));
    }
    const sentPress = sendInputs(press);
    if (holdMs > 0) sleepSync(holdMs);
    const sentRelease = sendInputs(release);
    const total = press.length + release.length;
    return { ok: sentPress + sentRelease === total, injected: sentPress + sentRelease };
  }

  const vk = KEY_TO_VK[key] ?? charToVk(key);

  // 单字符但没有 VK 映射（标点、中文等）：用 Unicode 事件。
  //
  // 带修饰键时不能这么走：`Ctrl+标点` 在 Windows 上没有明确的 Unicode 语义，
  // 发了也不会有应用响应「另存为」之类的组合。这种情况明确报错，
  // 让上层用 `set_value` 或 `key` 的等价写法，而不是发一串无效事件假装成功。
  if (vk === undefined || vk === 0) {
    if (parsed.modifiers.length > 0) {
      return { ok: false, injected: 0, unknownKey: key };
    }
    return sendText(key);
  }

  const inputs: Buffer[] = [];
  for (const modifier of parsed.modifiers) {
    const modifierCode = modifierVk(modifier);
    if (modifierCode !== 0) inputs.push(buildKeyboardInput(modifierCode, 0, 0));
  }
  inputs.push(buildKeyboardInput(vk, 0, 0));
  inputs.push(buildKeyboardInput(vk, 0, KEYEVENTF.KEYUP));

  const releaseInputs: Buffer[] = [];
  for (const modifier of [...parsed.modifiers].reverse()) {
    const modifierCode = modifierVk(modifier);
    if (modifierCode !== 0) releaseInputs.push(buildKeyboardInput(modifierCode, 0, KEYEVENTF.KEYUP));
  }

  // 分两次发送：按下序列 → 停留 → 抬起修饰键。
  // 合并成一次会让部分应用看不到中间状态（Ctrl+A 全选这类组合尤其明显）。
  const sentPress = sendInputs(inputs);
  if (holdMs > 0) sleepSync(holdMs);
  const sentRelease = sendInputs(releaseInputs);

  const total = inputs.length + releaseInputs.length;
  return { ok: sentPress + sentRelease === total, injected: sentPress + sentRelease };
}

/**
 * 逐字符输入文本。
 *
 * 用 Unicode 事件而非虚拟键：不依赖键盘布局，中文、emoji、特殊符号都能发。
 * 代价是它绕过键盘映射层，因此对少数只认扫描码的老式应用无效——
 * 这种情况应改用 `set_value`（走 UIA 的 ValuePattern）。
 *
 * **按 UTF-16 码元发**（不是按码点）：`KEYEVENTF_UNICODE` 的 `wScan` 是 16 位，
 * 只能承载一个码元。emoji 这类增补平面字符占两个码元（代理对），
 * 必须连续发两个事件，操作系统侧会自动拼接。按码点发会丢字符。
 */
export function sendText(text: string): KeySendResult {
  if (text.length === 0) return { ok: true, injected: 0 };
  const inputs: Buffer[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const codeUnit = text.charCodeAt(i);
    inputs.push(buildKeyboardInput(0, codeUnit, KEYEVENTF.UNICODE));
    inputs.push(buildKeyboardInput(0, codeUnit, KEYEVENTF.UNICODE | KEYEVENTF.KEYUP));
  }
  const sent = sendInputs(inputs);
  return { ok: sent === inputs.length, injected: sent };
}

// ---------------------------------------------------------------------------
// 滚动
// ---------------------------------------------------------------------------

const WM_MOUSEWHEEL = 0x020a;

/** WHEEL_DELTA 是滚轮一格的单位。部分应用支持小于一格的精细滚动。 */
const WHEEL_DELTA = 120;

export interface ScrollResult {
  ok: boolean;
  path: "post_message" | "send_input";
  /** 实际发送的轮数。正数为向上，负数为向下。 */
  wheelCount: number;
}

/**
 * 用消息投递发送滚轮事件。
 *
 * 零干扰，但**只对接收 `WM_MOUSEWHEEL` 的宿主有效**。Chromium 实测丢弃
 * 投递的滚轮消息（它只认真实输入队列里的滚轮），因此调用方需要能降级。
 */
export function postScroll(options: {
  hwnd: bigint;
  screenX: number;
  screenY: number;
  /** 正数向上，负数向下。 */
  wheelCount: number;
}): ScrollResult {
  // WM_MOUSEWHEEL 的 lParam 是**屏幕坐标**，不是客户区坐标——
  // 这与 WM_LBUTTONDOWN 不同，搞错会让滚动落在错误位置甚至完全无效。
  const position = (((options.screenY & 0xffff) << 16) | (options.screenX & 0xffff)) >>> 0;
  const delta = (options.wheelCount * WHEEL_DELTA) & 0xffff;
  // wParam 高 16 位是 delta（有符号），低 16 位是键状态
  const wParam = ((delta << 16) & 0xffff0000) >>> 0;

  const ok =
    postMessageFn()(hwndToPointer(options.hwnd), WM_MOUSEWHEEL, wParam, position) !== 0;
  return { ok, path: "post_message", wheelCount: options.wheelCount };
}

/**
 * 用物理注入发送滚轮。
 *
 * `MOUSEEVENTF_WHEEL` 滚动的是**光标下的窗口**，所以必须先把光标移到目标位置，
 * 滚完再还原——否则用户会发现鼠标跑到别处去了。
 *
 * 这个「移动 → 滚动 → 还原」的组合是本函数的职责，不是调用方的：
 * 让调用方自己移光标的话，一旦它忘了还原或中途抛错，用户的光标就留在原地不动了。
 * 唯一需要调用方保证的是「已经获得授权」。
 */
export function sendScrollAt(options: {
  screenX: number;
  screenY: number;
  wheelCount: number;
  /** 是否还原光标。默认 true。 */
  restoreCursor?: boolean;
}): ScrollResult {
  const restore = options.restoreCursor !== false;
  const before = captureCursor();

  try {
    if (setCursorFn()(options.screenX, options.screenY) === 0) {
      return { ok: false, path: "send_input", wheelCount: options.wheelCount };
    }
    // 部分应用需要一点时间让 hover 状态生效（滚动目标按 hover 判定）
    sleepSync(20);

    const buffer = Buffer.alloc(INPUT_STRUCT_SIZE);
    buffer.writeUInt32LE(0, 0); // INPUT_MOUSE
    // MOUSEINPUT: dx(8) dy(12) mouseData(16) dwFlags(20) time(24) pad(28) extraInfo(32)
    buffer.writeInt32LE(options.wheelCount * WHEEL_DELTA, 16);
    buffer.writeUInt32LE(0x0800, 20); // MOUSEEVENTF_WHEEL

    const sent = sendInputFn()(1, buffer, INPUT_STRUCT_SIZE) as number;
    sleepSync(30);
    return { ok: sent === 1, path: "send_input", wheelCount: options.wheelCount };
  } finally {
    if (restore && before) {
      setCursorFn()(before.x, before.y);
    }
  }
}

/** 读当前光标位置。 */
function captureCursor(): { x: number; y: number } | undefined {
  if (!fnGetCursorPos) {
    fnGetCursorPos = user().func("int __stdcall GetCursorPos(_Out_ void *p)") as unknown as RawFn;
  }
  const buffer = Buffer.alloc(8);
  if (fnGetCursorPos(buffer) === 0) return undefined;
  return { x: buffer.readInt32LE(0), y: buffer.readInt32LE(4) };
}

let fnGetCursorPos: RawFn | undefined;
let fnSetCursorPos: RawFn | undefined;

function setCursorFn(): RawFn {
  if (!fnSetCursorPos) {
    fnSetCursorPos = user().func("int __stdcall SetCursorPos(int x, int y)") as unknown as RawFn;
  }
  return fnSetCursorPos;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}
