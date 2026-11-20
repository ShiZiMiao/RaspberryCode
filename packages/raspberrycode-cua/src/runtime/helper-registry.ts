/**
 * Helper 进程的单例协调。
 *
 * 问题：`createComputerUseRuntime` 会被调用多次——bootstrap 在 main() 里捕获一次
 * 供所有 MCP server 复用，但测试、子会话、以及未来可能的「按会话一个 runtime」
 * 都会各自建实例。若每个实例都自己 spawn 一个 Helper，用户会在任务管理器里
 * 看到若干个同名后台进程，且每个都持有自己的 UIA COM 连接与快照缓存。
 *
 * 更糟的是**快照语义会分裂**：模型在 A 实例观察拿到 `s-1`，
 * 若动作发到 B 实例，B 没有 `s-1`，报 `state_invalidated` ——
 * 用户看到的是「刚观察完就说失效」。
 *
 * 因此：**同一进程内，同一入口路径的 Helper 只允许有一个**，
 * 由引用计数管理生命周期。最后一个使用者释放时才真正退出。
 *
 * 不做跨进程共享（那是命名管道的「已有实例」检测要做的事）：
 * 跨进程共享需要把快照状态也搬出去，会让 Helper 变成有状态的公共资源，
 * 故障面大得多。本实现的边界就是「一个进程一个 Helper」。
 */

import { CuaHelperClient } from "./helper-client.ts";

/** 共享条目的状态。 */
interface SharedEntry {
  client: CuaHelperClient;
  /** 当前引用数。归零时启动延迟回收。 */
  refs: number;
  /** 回收定时器。给「释放后立刻又申请」留出复用窗口。 */
  reapTimer: NodeJS.Timeout | undefined;
}

/**
 * 回收延迟。
 *
 * 不立即销毁的理由：MCP server 关闭时多个 runtime 会几乎同时 dispose，
 * 而紧接着新连接可能马上要重建。立即销毁会让这条路径变成
 * 「每次重建都付一次 65ms 冷启动」，且丢失全部快照缓存。
 *
 * 5 秒：足够覆盖「关闭-重开」的连续性，又不至于让空转的 Helper 长期驻留。
 */
const REAP_DELAY_MS = 5_000;

const entries = new Map<string, SharedEntry>();

/** 共享键：入口路径 + 命令。不同入口必须用不同 Helper（版本可能不同）。 */
function keyOf(entryPath: string, command: string): string {
  return `${command}\u0000${entryPath}`;
}

/**
 * 申请一个 Helper 客户端引用。
 *
 * 返回的客户端由注册表持有，调用方**不要**直接 stop 它——
 * 用 `releaseHelper` 归还引用，让注册表决定何时真正退出。
 */
export function acquireHelper(
  entryPath: string,
  command: string,
  factory: () => CuaHelperClient,
): CuaHelperClient {
  const key = keyOf(entryPath, command);
  const existing = entries.get(key);

  if (existing) {
    existing.refs += 1;
    // 上一次释放可能已经排了回收，取消它
    if (existing.reapTimer) {
      clearTimeout(existing.reapTimer);
      existing.reapTimer = undefined;
    }
    return existing.client;
  }

  const client = factory();
  entries.set(key, { client, refs: 1, reapTimer: undefined });
  return client;
}

/**
 * 归还引用。
 *
 * 引用数归零时安排延迟回收，不是立即销毁——理由见 `REAP_DELAY_MS`。
 * 重复归还是安全的（不会把 refs 减成负数），因为 dispose 可能被调用多次。
 */
export function releaseHelper(entryPath: string, command: string): void {
  const key = keyOf(entryPath, command);
  const entry = entries.get(key);
  if (!entry) return;

  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0) return;
  if (entry.reapTimer) return;

  entry.reapTimer = setTimeout(() => {
    const current = entries.get(key);
    if (!current) return;
    // 定时器触发时若又有人申请了，就不要销毁
    if (current.refs > 0) {
      current.reapTimer = undefined;
      return;
    }
    entries.delete(key);
    // stop 是幂等的，且失败也不该影响其他条目
    void current.client.stop().catch(() => undefined);
  }, REAP_DELAY_MS);
  // 不阻止进程退出：Helper 有自己的父进程看护，宿主退出它会跟着退出
  entry.reapTimer.unref?.();
}

/**
 * 立即销毁全部共享 Helper。
 *
 * 只在进程即将退出、或测试需要干净状态时调用。
 * 正常关闭流程走 `releaseHelper`。
 */
export async function disposeAllHelpers(): Promise<void> {
  const snapshot = [...entries.values()];
  entries.clear();
  await Promise.all(
    snapshot.map(async (entry) => {
      if (entry.reapTimer) clearTimeout(entry.reapTimer);
      await entry.client.stop().catch(() => undefined);
    }),
  );
}

/** 当前共享条目数，诊断与测试用。 */
export function sharedHelperCount(): number {
  return entries.size;
}

/** 某个键的当前引用数，诊断与测试用。 */
export function helperRefCount(entryPath: string, command: string): number {
  return entries.get(keyOf(entryPath, command))?.refs ?? 0;
}
