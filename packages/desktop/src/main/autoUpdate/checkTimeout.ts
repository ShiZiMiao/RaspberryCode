/**
 * 更新检查的超时兜底。
 *
 * 背景：electron-updater 的 `checkForUpdates()` 在 GitHub 不可达时不会自己收口，
 * 手动「检查更新」的按钮会永久停在「检查中…」且拿不到任何结果（实测：direct 路线
 * 走系统代理、GitHub 不可达时窗口一直处于 disabled 等待态）。这里给检查加一层
 * 上限，超时按 Error 抛出，走与真实失败相同的降级/收口路径。
 *
 * 60s 取得比镜像/直连两次尝试的实测耗时（各约 24s）更宽裕，不误伤慢网络。
 *
 * 从 autoUpdateService.ts 抽出：该文件已触达 800 行架构上限，超时机制是一块
 * 与更新状态机无关的纯逻辑，独立成文件更清晰，也便于单测直接覆盖。
 */

export const CHECK_TIMEOUT_MS = 60_000;

/**
 * 测试专用超时覆盖：vitest 里用真实短超时验证「挂起必定收口」，
 * 不必等 60s，也避免 fake timers 与内部 await 链的兼容问题。
 */
let checkTimeoutOverrideMs: number | null = null;

/** 仅供测试注入更短的检查超时；传 null 恢复默认。 */
export function __setCheckTimeoutForTesting(ms: number | null): void {
  checkTimeoutOverrideMs = ms;
}

/** 当前生效的检查超时（测试覆盖优先，否则默认 60s）。 */
export function resolveCheckTimeoutMs(): number {
  return checkTimeoutOverrideMs ?? CHECK_TIMEOUT_MS;
}

/** 给检查加超时；超时以 Error 抛出，走与真实失败相同的降级/收口路径。 */
export async function withCheckTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`update check timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
