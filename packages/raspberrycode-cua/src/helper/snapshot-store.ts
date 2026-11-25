/**
 * 快照存储与差分基线管理。
 *
 * 核心语义（spec §5.3）：**差分基线是「模型实际看过的树」**。
 *
 * 这条规则来自上游真机教训：Helper 若按「该 pid+窗口的上一次 capture」做基线，
 * 那么内部为身份解析而做的观察（模型没看见）会成为基线，
 * 导致模型第一次 getAXState() 拿到的是一棵它从未见过的树的增量，
 * 出现「飞书 930 元素只吐出 8 行菜单抖动」这类现象。
 *
 * 因此本模块把「采集」与「展示」分开：
 * - capture() 只更新「最新快照」，不移动基线
 * - markShown() 才把某次快照登记为基线
 */

import type { UiaSnapshot } from "./tree.ts";

/**
 * 快照存储。
 *
 * 以「窗口身份」为键而非 pid：同一进程可能有多个窗口，
 * 按 pid 存会让不同窗口的快照互相覆盖。
 *
 * **为什么保留多份历史快照而不只留最新一份**：
 * 只留最新会让「观察 A → 观察 B → 回去操作 A」立即失败（A 的 stateId 已失效）。
 * 这是真实的多步任务模式：模型先看主窗口，再看弹窗，然后回来点主窗口里的按钮。
 * 因此每个窗口保留最近 `HISTORY_LIMIT` 份快照，按 stateId 都能查到。
 *
 * 上限的作用：防止长任务里无限持有 COM 元素引用导致内存增长。
 * 超限淘汰最旧的——模型手里的 stateId 通常只往前几步，淘汰最旧的足够安全。
 */
const HISTORY_LIMIT = 8;

/** 单个窗口的观察状态。 */
interface WindowObservation {
  /** 该窗口的历史快照，最新在前。 */
  history: UiaSnapshot[];
  /** 模型实际看过的快照，差分基线。undefined 表示还没展示过。 */
  shown: UiaSnapshot | undefined;
}
export class SnapshotStore {
  private readonly observations = new Map<string, WindowObservation>();
  private sequence = 0;

  /** 分配一个新的快照序号。单调递增，保证 stateId 在会话内唯一。 */
  nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  /**
   * 记录一次新采集的快照。不移动差分基线。
   *
   * 返回 `evicted`：本次写入是否淘汰了旧快照。调用方据此提示
   * 「历史已满，旧 stateId 可能失效」，而不是让模型在旧索引上反复失败。
   */
  record(windowKey: string, snapshot: UiaSnapshot): { evicted: boolean } {
    const existing = this.observations.get(windowKey);
    if (existing) {
      existing.history.unshift(snapshot);
      const evicted = existing.history.length > HISTORY_LIMIT;
      if (evicted) {
        existing.history.length = HISTORY_LIMIT;
      }
      return { evicted };
    }
    this.observations.set(windowKey, { history: [snapshot], shown: undefined });
    return { evicted: false };
  }

  /** 把某次快照登记为「模型看过」，移动差分基线。 */
  markShown(windowKey: string, snapshot: UiaSnapshot): void {
    const existing = this.observations.get(windowKey);
    if (existing) {
      existing.shown = snapshot;
    } else {
      this.observations.set(windowKey, { history: [snapshot], shown: snapshot });
    }
  }

  /** 取最近一次采集的快照。 */
  latestOf(windowKey: string): UiaSnapshot | undefined {
    return this.observations.get(windowKey)?.history[0];
  }

  /** 取差分基线（模型看过的快照）。 */
  baselineOf(windowKey: string): UiaSnapshot | undefined {
    return this.observations.get(windowKey)?.shown;
  }

  /**
   * 取指定 stateId 的快照。
   *
   * 动作执行时用 stateId 校验元素索引是否仍然有效——
   * 若模型拿的是旧快照的索引，必须拒绝而不是猜。
   *
   * 查历史而非只看最新：见类注释里「观察 A → 观察 B → 回去操作 A」的场景。
   */
  findByStateId(stateId: string): UiaSnapshot | undefined {
    for (const observation of this.observations.values()) {
      if (observation.shown?.stateId === stateId) return observation.shown;
      const found = observation.history.find((snapshot) => snapshot.stateId === stateId);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * 清空全部状态。
   *
   * Helper 重启后必须调用（spec §7.2 硬规则二）：旧 stateId 与元素索引全部失效。
   */
  reset(): void {
    this.observations.clear();
    this.sequence = 0;
  }

  /** 当前窗口数，诊断用。 */
  get size(): number {
    return this.observations.size;
  }
}
