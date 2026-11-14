import type { BrowserWindow, Rectangle } from "electron";
import type { AppSettings } from "@raspberrycode/shared";

export const DEFAULT_DESKTOP_WINDOW_WIDTH = 1200;
export const DEFAULT_DESKTOP_WINDOW_HEIGHT = 800;
/**
 * 最小窗口宽度按「输入卡上方那一行的两块内容不重叠」推导，不是随手取的整数。
 *
 * 那一行有两个贴边元素（specs/composer-status-bar.md）：
 * - 左：消息尾部动作行（复制/点赞/点踩/时间戳），实测约 137px（1040 宽窗口、中文文案）；
 * - 右：会话状态条三个 chip（会话统计 / Token 用量 / 上下文容量），实测约 372px。
 * 两者之间还要留出可辨认的间隙（取 24px，实际渲染 gap 为 12px，留一倍余量）。
 *
 * 再加主列以外的固定占用：
 * - 工作区侧栏最小宽度 264px（`WORKSPACE_SIDEBAR_MIN_WIDTH_PX`，与 UI 保持一致）；
 * - 主列输入区左右内边距 8px×2（Timeline 的 `px-2`）。
 *
 * 137 + 24 + 372 + 264 + 16 = 813。
 *
 * 实测校正（2026-11-13）：840 宽下两块确实不重叠（动作行止于 x≈325，状态条起于 x≈441），
 * 但间隙只剩约 116px，英文界面 chip 文案更长（`cache hit` / `uncached input`）会进一步吃紧。
 * 因此取 900：在 813 的理论下限之上留出跨语言余量，仍明显小于默认 1200，不牺牲可用性。
 *
 * 同步约束：改动状态条 chip 数量/文案长度，或改工作区侧栏最小宽度时，必须重算这里，
 * 并按「动作行 + 状态条同行不重叠」在真机上复核。
 */
export const MIN_DESKTOP_WINDOW_WIDTH = 900;
export const MIN_DESKTOP_WINDOW_HEIGHT = 640;
const WINDOW_SIZE_PERSIST_DEBOUNCE_MS = 250;

export type DesktopWindowSize = NonNullable<AppSettings["desktopWindowSize"]>;

function clampDimension(value: number, minimum: number, available: number): number {
  const maximum = Math.max(minimum, Math.floor(available));
  return Math.min(Math.max(Math.floor(value), minimum), maximum);
}

export function resolveDesktopWindowSize(
  persisted: DesktopWindowSize | undefined,
  workAreaSize: Pick<Rectangle, "width" | "height">,
): DesktopWindowSize {
  const width = persisted?.width ?? DEFAULT_DESKTOP_WINDOW_WIDTH;
  const height = persisted?.height ?? DEFAULT_DESKTOP_WINDOW_HEIGHT;

  return {
    width: clampDimension(width, MIN_DESKTOP_WINDOW_WIDTH, workAreaSize.width),
    height: clampDimension(height, MIN_DESKTOP_WINDOW_HEIGHT, workAreaSize.height),
    maximized: persisted?.maximized ?? false,
  };
}

type WindowSizePersistenceTarget = Pick<
  BrowserWindow,
  "getNormalBounds" | "isDestroyed" | "isMaximized" | "on"
>;

export function attachDesktopWindowSizePersistence(
  win: WindowSizePersistenceTarget,
  save: (state: DesktopWindowSize) => Promise<void>,
  onSaveError: (error: unknown) => void = () => undefined,
): void {
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  const persistCurrentState = (): void => {
    if (win.isDestroyed()) return;

    // 最大化窗口的当前 bounds 等于显示器工作区，直接持久化会覆盖用户最后一次
    // 手动调整的普通窗口尺寸。始终读取 normal bounds，并把 maximized 作为独立状态保存。
    const bounds = win.getNormalBounds();
    const state: DesktopWindowSize = {
      width: Math.max(MIN_DESKTOP_WINDOW_WIDTH, Math.floor(bounds.width)),
      height: Math.max(MIN_DESKTOP_WINDOW_HEIGHT, Math.floor(bounds.height)),
      maximized: win.isMaximized(),
    };
    void save(state).catch(onSaveError);
  };

  const clearResizeTimer = () => {
    if (resizeTimer === null) return;
    clearTimeout(resizeTimer);
    resizeTimer = null;
  };
  const persistImmediately = (): void => {
    clearResizeTimer();
    persistCurrentState();
  };

  win.on("resize", () => {
    // resize 在 Linux 和部分 Windows 窗口管理器中会随拖拽高频触发；只保存稳定后的尺寸，
    // 避免把与渲染帧同量级的写入堆进 setting.json 原子写队列。
    clearResizeTimer();
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      void persistCurrentState();
    }, WINDOW_SIZE_PERSIST_DEBOUNCE_MS);
  });
  win.on("maximize", () => void persistImmediately());
  win.on("unmaximize", () => void persistImmediately());
  // 退出屏障结束后 Electron 会再次触发 close；这里若启动异步设置写入，
  // 随后的 app.exit 可能在 releaseLock 完成前终止 Main，遗留 setting.json.lock。
  // close 只取消尚未触发的 resize 防抖，不再启动新的设置写入。
  win.on("close", clearResizeTimer);
}
