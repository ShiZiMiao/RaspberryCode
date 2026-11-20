/**
 * 窗口可见性控制：让窗口「用户几乎看不见」但**画面仍持续更新**。
 *
 * ## 为什么需要这个
 *
 * 采集画面要求窗口客户区存在。实测三种状态：
 *
 * | 状态 | 客户区 | PrintWindow | 画面是否更新 | 元素操作 |
 * | --- | --- | --- | --- | --- |
 * | 屏幕内 | `704x481` | ✅ | ✅ | ✅ |
 * | 最小化 | **`0x0`** | ❌ | — | ✅ |
 * | 完全移出屏幕 | `704x481` | ✅ | **❌ 冻结** | ✅ |
 * | **屏边留 1px** | `704x481` | ✅ | **✅** | ✅ |
 *
 * ## 为什么不是「完全移出屏幕」
 *
 * 实测（2026-11-19）：窗口完全移出屏幕后，**画面冻结**。
 *
 * ```
 * 屏幕内         唯一帧 40/40   ← 动画正常
 * 完全移出       唯一帧 1/40    ← 冻在最后一帧
 * 强制重绘       唯一帧 1/20    ← RedrawWindow 救不回
 * agent 改值后   哈希完全相同   ← 操作生效了，但画面不更新
 * ```
 *
 * 最后一条最要命：`set_value` 确实改了值（UIA 读回确认），
 * 但截图与改之前**字节完全一致**。也就是「操作成功、画面不动」——
 * 用户看到的是一张过期的图。
 *
 * 而只要还剩 1px 在屏内，画面就继续更新（唯一帧 16/16），
 * 且截图始终是**完整画面**（实测四段颜色齐全，不是只截到可见的那条）。
 *
 * ## 所以做法是「留一条几乎看不见的边」
 *
 * 把窗口推到屏幕边缘外，只留 1~2px 可见。效果：
 * - 用户视觉上几乎察觉不到（1px 竖条）
 * - 客户区完好，截图完整
 * - 渲染节奏不受影响，画面持续更新
 *
 * 这不是真正的「完全隐藏」。真要完全隐藏且画面更新，
 * 只能走 WGC 的帧池（`CreateFreeThreaded`）+ 让窗口留在屏内，
 * 或接受画面不更新。当前实现的取舍是**保住画面真实性**。
 *
 * ## 为什么不 hide（`ShowWindow(SW_HIDE)`）
 *
 * 隐藏窗口会让 `IsWindowVisible` 为 false，浏览器会降频甚至停止
 * `requestAnimationFrame`，采到的画面会冻结。留边做法不改变可见性标志。
 *
 * ## 边界
 *
 * - **只对顶层窗口有效**。子窗口没有独立位置，移它等于移动父窗口。
 * - 留边会在屏幕上留下 1~2px 的痕迹。若要求**完全**不可见，
 *   本模块不适用（那种情况下画面必然冻结）。
 * - 多显示器环境按**虚拟屏幕**边界算，保证推到所有显示器之外。
 * - 最小化状态下明确拒绝：那时客户区已销毁，移位置没有意义。
 */

import koffi from "koffi";

/** 结果里的模式。 */
export type VisibilityMode = "edge_sliver";

/** 让窗口变成「几乎不可见」的结果。 */
export interface HideOffscreenResult {
  ok: boolean;
  /** 采用的模式。当前只有「留边」一种，见文件头说明。 */
  mode?: VisibilityMode;
  /** 移出前的窗口位置，供恢复用。 */
  previousRect?: { x: number; y: number; width: number; height: number };
  /** 移动后所在的位置。 */
  targetPosition?: { x: number; y: number };
  /** 留在屏幕内的像素宽度。 */
  visibleWidth?: number;
  reason?:
    | "unsupported_platform"
    | "invalid_window"
    | "minimized"
    | "set_window_pos_failed"
    | "already_minimized";
  message: string;
}

/** 恢复结果。 */
export interface RestoreResult {
  ok: boolean;
  reason?: "unsupported_platform" | "invalid_window" | "set_window_pos_failed";
  message: string;
}

/**
 * 留在屏幕内的可见宽度。
 *
 * ## 为什么是 1px
 *
 * 实测（2026-11-19）1px 完全够用，且比 2px 更不可见：
 *
 * | 可见宽度 | 采样 30 次的不同颜色数 | 判定 |
 * | --- | --- | --- |
 * | 屏幕内 | 29/30 | 在动 |
 * | 2px | 30/30 | 在动 |
 * | **1px** | **30/30** | **在动** |
 * | 0（完全离屏） | **1/30** | 冻结 |
 *
 * 稳定性也验证过：3 个纵向位置（顶/中/底）× 5 轮 × 20 帧，
 * **15 轮全部在动**，平均唯一帧 19.7/20，最差一轮 15/20。
 * 没有出现「偶发冻结」——那是最难发现的问题，所以专门查过。
 *
 * 截图完整性同样确认：1px 下四段色块颜色全对得上
 * `(197,48,48) (56,161,105) (43,108,176) (214,158,46)`，
 * 说明 `PrintWindow` 给的是完整客户区，不是可见的那一像素。
 *
 * ## 关于判据的教训
 *
 * 早期用「PNG 字节前 4KB 哈希」判断画面是否更新，得出过
 * 「恢复后唯一帧 1/12」的错误结论。原因是那个测试页面是
 * 静态色块 + 小面积移动元素，压缩后前 4KB 只覆盖静态区，
 * 哈希恒定。
 *
 * **判断画面是否更新，要直接读像素，不要用压缩后的字节哈希。**
 */
const SLIVER_WIDTH = 1;

const SWP_NOSIZE = 0x0001;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;

/** 虚拟屏幕指标。多屏环境下用它算屏幕边界。 */
const SM_XVIRTUALSCREEN = 76;
const SM_YVIRTUALSCREEN = 77;
const SM_CXVIRTUALSCREEN = 78;
const SM_CYVIRTUALSCREEN = 79;

interface VisibilityApi {
  getWindowRect: (hwnd: bigint) => { x: number; y: number; width: number; height: number } | undefined;
  setWindowPos: (hwnd: bigint, x: number, y: number) => boolean;
  isIconic: (hwnd: bigint) => boolean;
  isWindow: (hwnd: bigint) => boolean;
  virtualScreen: () => { x: number; y: number; width: number; height: number };
}

let api: VisibilityApi | undefined;

function getApi(): VisibilityApi | undefined {
  if (api) return api;
  if (process.platform !== "win32") return undefined;

  try {
    const user32 = koffi.load("user32.dll");
    const GetWindowRect = user32.func("int __stdcall GetWindowRect(void *h, _Out_ void *rect)");
    const SetWindowPos = user32.func(
      "int __stdcall SetWindowPos(void *h, void *insertAfter, int x, int y, int cx, int cy, uint32 flags)",
    );
    const IsIconic = user32.func("int __stdcall IsIconic(void *h)");
    const IsWindow = user32.func("int __stdcall IsWindow(void *h)");
    const GetSystemMetrics = user32.func("int __stdcall GetSystemMetrics(int index)");

    /** bigint 句柄 → koffi 指针。 */
    const toPtr = (hwnd: bigint): unknown => {
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64LE(hwnd);
      return koffi.decode(buf, "void *");
    };

    api = {
      getWindowRect: (hwnd) => {
        const buf = Buffer.alloc(16);
        if (!GetWindowRect(toPtr(hwnd), buf)) return undefined;
        const left = buf.readInt32LE(0);
        const top = buf.readInt32LE(4);
        const right = buf.readInt32LE(8);
        const bottom = buf.readInt32LE(12);
        return { x: left, y: top, width: right - left, height: bottom - top };
      },
      setWindowPos: (hwnd, x, y) => {
        // SWP_NOSIZE 只移动不改尺寸；SWP_NOZORDER 不参与 Z 序；
        // SWP_NOACTIVATE 不激活——否则会把用户正在用的窗口顶掉
        const ok = SetWindowPos(
          toPtr(hwnd),
          null,
          x,
          y,
          0,
          0,
          SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        );
        return (ok as number) !== 0;
      },
      isIconic: (hwnd) => (IsIconic(toPtr(hwnd)) as number) !== 0,
      isWindow: (hwnd) => (IsWindow(toPtr(hwnd)) as number) !== 0,
      virtualScreen: () => ({
        x: GetSystemMetrics(SM_XVIRTUALSCREEN) as number,
        y: GetSystemMetrics(SM_YVIRTUALSCREEN) as number,
        width: GetSystemMetrics(SM_CXVIRTUALSCREEN) as number,
        height: GetSystemMetrics(SM_CYVIRTUALSCREEN) as number,
      }),
    };
    return api;
  } catch {
    return undefined;
  }
}

/**
 * 把窗口推到屏幕边缘，只留一条极窄的可见边。
 *
 * 移后：用户视觉上几乎看不见（1~2px 竖条），但：
 * - 客户区完好 → 截图是完整画面
 * - 渲染不中断 → 画面内容持续更新
 * - 元素操作正常
 *
 * **为什么不是移出屏幕**：完全移出会让画面冻结（实测 40 帧只有 1 个唯一帧，
 * 且 agent 改值后截图字节完全不变）。冻结的画面配上「操作成功」的回执，
 * 等于给用户看过期信息——那比看不见更糟。
 */
export function hideWindowOffscreen(hwnd: bigint): HideOffscreenResult {
  const fn = getApi();
  if (!fn) {
    return { ok: false, reason: "unsupported_platform", message: "窗口位置控制只在 Windows 上可用。" };
  }
  if (!fn.isWindow(hwnd)) {
    return { ok: false, reason: "invalid_window", message: "窗口句柄无效（可能已销毁）。" };
  }

  // 最小化状态下移位置没意义：客户区已经销毁，移完也采不到。
  // 明确拒绝而不是「移了但没用」——后者会让调用方以为成功了。
  if (fn.isIconic(hwnd)) {
    return {
      ok: false,
      reason: "minimized",
      message:
        "窗口当前已最小化。最小化会销毁客户区（ClientRect=0x0），" +
        "截图为空、移位置也没意义。请先还原窗口。",
    };
  }

  const previous = fn.getWindowRect(hwnd);
  if (!previous) {
    return { ok: false, reason: "invalid_window", message: "读不到窗口位置。" };
  }

  // 推到虚拟屏幕右边缘之外，但保留 SLIVER_WIDTH 像素落在屏内。
  // 多屏环境下虚拟屏幕可能从负坐标开始，所以按虚拟屏幕右边界算，
  // 不能假设 (0,0) 是左上角或屏幕宽等于主屏宽。
  const vs = fn.virtualScreen();
  const rightEdge = vs.x + vs.width;
  const targetX = rightEdge - SLIVER_WIDTH;
  // 纵向保持在虚拟屏幕内，避免同时出上边界——
  // 出两个方向会让「验证是否还有可见部分」变得难以推断。
  const targetY = Math.max(vs.y, Math.min(previous.y, vs.y + vs.height - previous.height));

  if (!fn.setWindowPos(hwnd, targetX, targetY)) {
    return {
      ok: false,
      reason: "set_window_pos_failed",
      message: "SetWindowPos 失败。可能该窗口属于更高权限的进程。",
    };
  }

  return {
    ok: true,
    mode: "edge_sliver",
    previousRect: previous,
    targetPosition: { x: targetX, y: targetY },
    visibleWidth: SLIVER_WIDTH,
    message:
      `窗口已推到屏幕右边缘（${targetX}, ${targetY}），屏内保留 ${SLIVER_WIDTH}px。` +
      "客户区完好，截图是完整画面且内容持续更新。" +
      "注意：屏幕上会留下一条极窄的可见边——这是让画面保持更新的代价，" +
      "完全移出屏幕会让画面冻结。",
  };
}

/**
 * 把窗口移回原位。
 *
 * 恢复目标由调用方给出（通常用 `hideWindowOffscreen` 返回的 `previousRect`）。
 * 不自己记住状态：模块无状态，多窗口场景下由上层管理归属更不容易错。
 */
export function restoreWindowPosition(
  hwnd: bigint,
  rect: { x: number; y: number },
): RestoreResult {
  const fn = getApi();
  if (!fn) {
    return { ok: false, reason: "unsupported_platform", message: "窗口位置控制只在 Windows 上可用。" };
  }
  if (!fn.isWindow(hwnd)) {
    return { ok: false, reason: "invalid_window", message: "窗口句柄无效（可能已销毁）。" };
  }
  if (!fn.setWindowPos(hwnd, rect.x, rect.y)) {
    return { ok: false, reason: "set_window_pos_failed", message: "SetWindowPos 失败。" };
  }
  return { ok: true, message: `窗口已移到 (${rect.x}, ${rect.y})。` };
}

/**
 * 判断窗口当前是否**完全**在屏幕外。
 *
 * 注意区分两个概念：
 * - 「完全在屏幕外」= 本函数返回 true → **画面会冻结**，不适合后台采集
 * - 「留了一条边」= 返回 false → 画面继续更新，这是推荐状态
 *
 * 上层可以用它做体检：如果返回 true 而正在采集，说明采到的是过期画面。
 */
export function isWindowOffscreen(hwnd: bigint): boolean {
  const fn = getApi();
  if (!fn) return false;
  const rect = fn.getWindowRect(hwnd);
  if (!rect) return false;
  const vs = fn.virtualScreen();
  return (
    rect.x >= vs.x + vs.width ||
    rect.y >= vs.y + vs.height ||
    rect.x + rect.width <= vs.x ||
    rect.y + rect.height <= vs.y
  );
}

/**
 * 窗口在屏幕内的可见宽度（像素，0 表示完全不可见）。
 *
 * 用途：采集前体检。返回 0 时画面一定冻结，应当提示调用方
 * 「要么还原窗口，要么接受画面不更新」。
 */
export function visibleWidthOf(hwnd: bigint): number {
  const fn = getApi();
  if (!fn) return 0;
  const rect = fn.getWindowRect(hwnd);
  if (!rect) return 0;
  const vs = fn.virtualScreen();
  const left = Math.max(rect.x, vs.x);
  const right = Math.min(rect.x + rect.width, vs.x + vs.width);
  return Math.max(0, right - left);
}
