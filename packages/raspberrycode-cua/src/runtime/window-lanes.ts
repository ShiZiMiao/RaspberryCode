/**
 * 按窗口的串行队列。
 *
 * ## 解决的问题
 *
 * 多个任务（会话）可以并发使用 CUA。它们操作**不同窗口**时互不干扰，
 * 但操作**同一个窗口**时会有真实风险：
 *
 * ```
 * 任务 A: 观察窗口 X → state-5
 * 任务 B: 观察窗口 X → state-6（X 的快照桶被刷新）
 * 任务 A: 用 state-5 点击 → 元素索引可能已错位
 * ```
 *
 * `stateId` 校验能挡住错位（返回 `state_invalidated`），
 * 但那是**事后拒绝**，不是事前防护。真正的防护是让同窗口的操作排队。
 *
 * ## 为什么按窗口而不是全局
 *
 * 全局串行会让「A 操作窗口 X、B 操作窗口 Y」也互相等待——
 * 那是没必要的牺牲。按窗口分隔既保证安全，又保留跨窗口并发。
 *
 * ## 为什么排队在动作层而不是请求层
 *
 * 「这个动作属于哪个窗口」是**动作的知识**，不是请求的知识。
 * 请求层只看到 method 和 params，不知道目标窗口。
 * 在请求层排队会退化成全局串行。
 */

/** 队列中的一项。 */
interface QueueEntry<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  enqueuedAt: number;
  /** 发起者的会话标识，用于诊断与回报。 */
  sessionId: string | undefined;
}

/** 单个窗口队列的状态。 */
interface LaneState {
  /** 是否有任务正在跑。 */
  busy: boolean;
  /** 等待中的任务。 */
  queue: QueueEntry<unknown>[];
  /** 当前正在执行的任务的会话标识。 */
  activeSessionId: string | undefined;
  /** 当前任务已执行的毫秒数（诊断用）。 */
  activeStartedAt: number | undefined;
}

/**
 * 跨窗口并发、同窗口串行的调度器。
 *
 * 生命周期与进程一致。不需要 dispose：队列空了就是空了，
 * 没有定时器也没有外部资源。
 */
export class WindowLaneScheduler {
  private readonly lanes = new Map<string, LaneState>();

  private laneOf(windowKey: string): LaneState {
    let lane = this.lanes.get(windowKey);
    if (!lane) {
      lane = {
        busy: false,
        queue: [],
        activeSessionId: undefined,
        activeStartedAt: undefined,
      };
      this.lanes.set(windowKey, lane);
    }
    return lane;
  }

  /**
   * 在指定窗口的队列里执行一个动作。
   *
   * 返回的 Promise 在动作完成后 resolve。排队期间不占用任何资源。
   *
   * `sessionId` 只用于诊断：它让「为什么慢」能归因到具体会话，
   * 不参与调度决策。
   */
  async run<T>(
    windowKey: string,
    sessionId: string | undefined,
    action: () => Promise<T>,
  ): Promise<{ value: T; queuedMs: number; waitedForSession: string | undefined }> {
    const lane = this.laneOf(windowKey);
    const enqueuedAt = Date.now();

    // 队列空闲且无人排队 → 立刻执行，走快路径。
    // 这条路径不该有额外的 Promise 链，否则每次动作都多一层微任务延迟。
    if (!lane.busy && lane.queue.length === 0) {
      const value = await this.execute(windowKey, lane, sessionId, action);
      return { value, queuedMs: 0, waitedForSession: undefined };
    }

    // 需要排队。记录「在等谁」——这是诊断的关键信息：
    // 用户问「为什么 B 慢了」，答案通常是「在等 A 的同窗口操作」。
    const waitedFor = lane.activeSessionId ?? lane.queue[0]?.sessionId;
    const value = await new Promise<T>((resolve, reject) => {
      lane.queue.push({
        run: action as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        enqueuedAt,
        sessionId,
      });
    });
    return { value, queuedMs: Date.now() - enqueuedAt, waitedForSession: waitedFor };
  }

  /** 立即执行并驱动后续队列。 */
  private async execute<T>(
    windowKey: string,
    lane: LaneState,
    sessionId: string | undefined,
    action: () => Promise<T>,
  ): Promise<T> {
    lane.busy = true;
    lane.activeSessionId = sessionId;
    lane.activeStartedAt = Date.now();
    try {
      return await action();
    } finally {
      lane.busy = false;
      lane.activeSessionId = undefined;
      lane.activeStartedAt = undefined;
      this.drain(windowKey, lane);
    }
  }

  /** 队列非空则取下一位继续跑。 */
  private drain(windowKey: string, lane: LaneState): void {
    const next = lane.queue.shift();
    if (!next) {
      // 队列空了：删掉这条 lane，避免 Map 无限增长。
      // 但仅在没有正在执行且确实为空时删，否则会把刚 push 的项丢掉。
      if (!lane.busy && lane.queue.length === 0) {
        this.lanes.delete(windowKey);
      }
      return;
    }

    const startedAt = Date.now();
    lane.busy = true;
    lane.activeSessionId = next.sessionId;
    lane.activeStartedAt = startedAt;

    void (async () => {
      try {
        const value = await next.run();
        next.resolve(value);
      } catch (error) {
        next.reject(error);
      } finally {
        lane.busy = false;
        lane.activeSessionId = undefined;
        lane.activeStartedAt = undefined;
        this.drain(windowKey, lane);
      }
    })();
  }

  /** 诊断：某窗口当前的排队情况。 */
  describe(windowKey: string): {
    busy: boolean;
    activeSessionId: string | undefined;
    activeForMs: number | undefined;
    queued: number;
    queuedSessions: (string | undefined)[];
  } {
    const lane = this.lanes.get(windowKey);
    if (!lane) {
      return { busy: false, activeSessionId: undefined, activeForMs: undefined, queued: 0, queuedSessions: [] };
    }
    return {
      busy: lane.busy,
      activeSessionId: lane.activeSessionId,
      activeForMs: lane.activeStartedAt === undefined ? undefined : Date.now() - lane.activeStartedAt,
      queued: lane.queue.length,
      queuedSessions: lane.queue.map((entry) => entry.sessionId),
    };
  }

  /** 诊断：全部活跃 lane 的快照。 */
  describeAll(): Record<string, ReturnType<WindowLaneScheduler["describe"]>> {
    const out: Record<string, ReturnType<WindowLaneScheduler["describe"]>> = {};
    for (const windowKey of this.lanes.keys()) {
      out[windowKey] = this.describe(windowKey);
    }
    return out;
  }
}

/**
 * 进程级单例。
 *
 * 队列必须跨 runtime 实例共享：`createComputerUseRuntime` 会被调用多次
 * （每个任务一个），但窗口是共享资源。若每个 runtime 一个调度器，
 * 两个任务仍会同时操作同一个窗口——排队就失效了。
 */
export const windowLanes = new WindowLaneScheduler();

/**
 * `stateId → windowKey` 的进程级映射。
 *
 * ## 为什么需要它
 *
 * 动作层只拿到 `state_id`（元素索引的校验凭据），拿不到窗口键。
 * 而排队必须按窗口分桶，否则会退化成全局串行。
 *
 * 观察时（`get_app_state`）顺手登记，动作时按 `state_id` 查回来。
 *
 * ## 为什么用 `stateId` 而不是别的
 *
 * 它是唯一贯穿「观察 → 动作」两端的标识：模型看到的就是它，
 * 动作时必须带上它。拿它当索引不需要改协议、不需要额外参数。
 *
 * ## 边界
 *
 * 最多保留 256 条，超出按插入顺序淘汰最旧的。
 * 这不是缓存而是**簿记**：丢了只会让排队退化为直连，不会让操作失败。
 * 因此用简单上限即可，不需要 LRU 那样的精细控制。
 */
const stateWindowKeys = new Map<string, string>();

/** 登记一次观察的归属。 */
export function rememberStateWindow(stateId: string, windowKey: string | undefined): void {
  if (!windowKey) return;
  // Map 保持插入顺序，超限时删最旧的
  if (stateWindowKeys.size >= 256) {
    const oldest = stateWindowKeys.keys().next().value;
    if (oldest !== undefined) stateWindowKeys.delete(oldest);
  }
  stateWindowKeys.set(stateId, windowKey);
}

/** 按 stateId 查窗口键。查不到返回 undefined（动作层会退化为不排队）。 */
export function windowKeyOfState(stateId: string): string | undefined {
  return stateWindowKeys.get(stateId);
}

/**
 * 应用标识 → 该应用最近一次观察的 stateId。
 *
 * ## 为什么需要这张表
 *
 * SDK 的动作调用**不发 `state_id`**，它发 `app_ref` + `target:{type:"element",index}`，
 * 语义是「按这个 app 的最新观察解析索引」（见 computer-use-client.mjs 的 `act()`）。
 * 只认 `state_id` 会让所有元素类动作在真实链路上失败——模型刚 `getApp()` 完
 * 就被要求「先观察」，而它已经观察过了。
 *
 * ## 键怎么定
 *
 * 用 `app_ref` 的字符串形式（进程号字符串 / 窗口标识）。观察时同时按
 * `processId` 与窗口标题登记两个键，是因为 SDK 允许用进程号或显示名绑定应用，
 * 登记少了会让后者查不到。
 *
 * ## 为什么不是「全局最近一次」
 *
 * 全局最近一次在多应用会话里会把 A 的索引解析到 B 的快照上——
 * 静默点到错的控件。按 app 分键才与 SDK 的语义一致。
 */
const appLastStateIds = new Map<string, string>();

/** 登记「某应用最近一次观察」。 */
export function rememberAppState(appKeys: readonly string[], stateId: string): void {
  for (const key of appKeys) {
    const trimmed = key?.trim();
    if (!trimmed) continue;
    if (appLastStateIds.size >= 512) {
      const oldest = appLastStateIds.keys().next().value;
      if (oldest !== undefined) appLastStateIds.delete(oldest);
    }
    appLastStateIds.set(trimmed, stateId);
  }
}

/** 查某应用最近一次观察的 stateId。查不到返回 undefined。 */
export function lastStateIdForApp(appKey: string): string | undefined {
  return appLastStateIds.get(appKey.trim());
}

/** 清空应用观察簿记。仅测试用。 */
export function clearAppStateRegistry(): void {
  appLastStateIds.clear();
}

/** 清空簿记。仅测试用。 */
export function resetStateWindowKeys(): void {
  stateWindowKeys.clear();
}
