/**
 * 契约一致性检查（仅编译期，不产出运行时代码）。
 *
 * 背景：本包的公共类型有两处声明——
 *   1. `index.d.ts`（手写的公开契约，消费方 `import type` 看到的就是它）
 *   2. `src/runtime/index.ts`（真实实现的类型）
 *
 * 两处必须保持一致，否则会出现「消费方能传某个字段但实现读不到」
 * 这种最难排查的问题（TS 通过、运行时静默忽略）。
 *
 * 检查方式：**逐字段展开比对**，不用条件类型推导「整体是否一致」。
 *
 * 为什么不用「键集相同 + 双向可赋值」这种简洁写法：
 * 条件类型在未约束的泛型位置上会分发（distribute），实测出现过
 * 「每个子条件单独都是 true、组合起来却是 false」的怪异结果，
 * 排查成本远高于收益。逐字段展开虽然啰嗦，但结果确定、报错位置精确
 * （能直接指出是哪个字段漂移了）。
 *
 * 新增字段时必须在这里补一行——这是刻意的：契约变更应该是有意识的动作。
 *
 * 之所以不在构建时从实现生成 `.d.ts`：`dist/` 不入 git，
 * 从源码 checkout 的开发者若没跑构建，`index.d.ts` 就会指向不存在的文件，
 * 类型检查直接崩。手写契约 + 编译期对齐是更稳的组合。
 */

import type {
  ComputerUseRuntimeContext as PublicContext,
  ComputerUseRuntimeExecuteInput as PublicExecuteInput,
  ComputerUseRuntimeOptions as PublicOptions,
} from "../../index.js";
import type {
  ComputerUseRuntimeContext as ImplContext,
  ComputerUseRuntimeExecuteInput as ImplExecuteInput,
  ComputerUseRuntimeOptions as ImplOptions,
} from "./index.ts";

/** 断言两个类型完全相同（含可选性）。 */
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** 断言为 true，否则 `tsc` 在**这一行**报错，直接指出字段。 */
type Assert<T extends true> = T;

// ---------------------------------------------------------------------------
// ComputerUseRuntimeContext
//
// 逐字段比对。每个 Assert 失败都会在下面这行报 TS2344，
// 配合字段名即可定位漂移。
// ---------------------------------------------------------------------------

export type ContextSessionId = Assert<Exact<PublicContext["sessionId"], ImplContext["sessionId"]>>;
export type ContextRuntimeScope = Assert<
  Exact<PublicContext["runtimeScope"], ImplContext["runtimeScope"]>
>;
export type ContextWorkspaceKey = Assert<
  Exact<PublicContext["workspaceKey"], ImplContext["workspaceKey"]>
>;
export type ContextWorkspacePath = Assert<
  Exact<PublicContext["workspacePath"], ImplContext["workspacePath"]>
>;
export type ContextWorkspaceIdentity = Assert<
  Exact<PublicContext["workspaceIdentity"], ImplContext["workspaceIdentity"]>
>;
export type ContextRemoteSessionId = Assert<
  Exact<PublicContext["remoteSessionId"], ImplContext["remoteSessionId"]>
>;
export type ContextTurnId = Assert<Exact<PublicContext["turnId"], ImplContext["turnId"]>>;
export type ContextClientMode = Assert<
  Exact<PublicContext["clientMode"], ImplContext["clientMode"]>
>;
export type ContextDeliveryKind = Assert<
  Exact<PublicContext["deliveryKind"], ImplContext["deliveryKind"]>
>;
export type ContextTrace = Assert<Exact<PublicContext["trace"], ImplContext["trace"]>>;
export type ContextInterferenceBudget = Assert<
  Exact<PublicContext["interferenceBudget"], ImplContext["interferenceBudget"]>
>;
export type ContextAllowPhysicalInjection = Assert<
  Exact<PublicContext["allowPhysicalInjection"], ImplContext["allowPhysicalInjection"]>
>;
/**
 * 字段数量必须一致。
 *
 * 上面逐个字段比对只能发现「字段类型变了」，
 * 发现不了「一边多了一个字段」。这里比对键的数量：
 * 新增字段而忘了在本文件补断言时，数量会对不上。
 */
export type ContextKeyCount = Assert<
  Exact<keyof PublicContext extends never ? never : CountKeys<PublicContext>, CountKeys<ImplContext>>
>;

/** 统计类型的键数量（把键映射成元组长度）。 */
type CountKeys<T> = UnionToTuple<keyof T> extends infer U
  ? U extends unknown[]
    ? U["length"]
    : never
  : never;

/** 联合类型 → 元组。利用条件类型的递归分发。 */
type UnionToTuple<U> = IsUnion<U> extends true
  ? [...UnionToTuple<Exclude<U, LastOf<U>>>, LastOf<U>]
  : [U];

/** 联合的最后一个成员（利用函数重载推断的顺序）。 */
type LastOf<U> = UnionToIntersection<U extends unknown ? () => U : never> extends () => infer R
  ? R
  : never;

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (
  arg: infer I,
) => void
  ? I
  : never;

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

// ---------------------------------------------------------------------------
// ComputerUseRuntimeExecuteInput
// ---------------------------------------------------------------------------

export type ExecuteToolName = Assert<
  Exact<PublicExecuteInput["toolName"], ImplExecuteInput["toolName"]>
>;
export type ExecuteArguments = Assert<
  Exact<PublicExecuteInput["arguments"], ImplExecuteInput["arguments"]>
>;
export type ExecuteContext = Assert<
  Exact<PublicExecuteInput["context"], ImplExecuteInput["context"]>
>;
export type ExecuteSignal = Assert<
  Exact<PublicExecuteInput["signal"], ImplExecuteInput["signal"]>
>;
export type ExecuteKeyCount = Assert<
  Exact<CountKeys<PublicExecuteInput>, CountKeys<ImplExecuteInput>>
>;

// ---------------------------------------------------------------------------
// ComputerUseRuntimeOptions
// ---------------------------------------------------------------------------

export type OptionsBrokerSocketPath = Assert<
  Exact<PublicOptions["brokerSocketPath"], ImplOptions["brokerSocketPath"]>
>;
export type OptionsRefreshMarkerPath = Assert<
  Exact<PublicOptions["refreshMarkerPath"], ImplOptions["refreshMarkerPath"]>
>;
export type OptionsEnsureBrokerAvailable = Assert<
  Exact<PublicOptions["ensureBrokerAvailable"], ImplOptions["ensureBrokerAvailable"]>
>;
export type OptionsEnv = Assert<Exact<PublicOptions["env"], ImplOptions["env"]>>;
export type OptionsKeyCount = Assert<
  Exact<CountKeys<PublicOptions>, CountKeys<ImplOptions>>
>;
