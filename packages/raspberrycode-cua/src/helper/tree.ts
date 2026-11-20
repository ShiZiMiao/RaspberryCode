/**
 * UIA 树遍历与快照采集。
 *
 * 核心约束（spec §5.2）：预算在**遍历期**生效，不是遍历后截断。
 * 依据实测：开始菜单真实元素数超过 5000，无上限遍历耗时 5.2 秒、产出 13 万字符，
 * 事后截断无法挽回这段时间与内存。
 *
 * 三个上限缺一不可：
 * - maxNodes：控制 token 规模
 * - maxDepth：防止深链递归
 * - deadlineMs：防止单个 provider 卡死（节点数不多也可能超时）
 */

import koffi from "koffi";
import {
  UIA_PROPERTY,
} from "./properties.ts";
import {
  controlTypeToKind,
  hasContent,
  isInteractiveKind,
  STATE_FLAGS,
} from "./kinds.ts";
import {
  decodeVariant,
  isHresultOk,
  pointerFromBigInt,
  readSafeArrayDoubles,
  vtableEntry,
  type AutomationHandle,
} from "./win32.ts";
import {
  P_ARRAY_GET_ELEMENT,
  P_ARRAY_LENGTH,
  P_CREATE_TRUE_CONDITION,
  P_ELEMENT_FIND_ALL,
  P_GET_CURRENT_PROPERTY_VALUE,
  P_GET_ROOT_ELEMENT,
  P_GET_RUNTIME_ID,
} from "./protos.ts";

/**
 * 遍历预算。
 *
 * 800/12/1500 来自 spec §1.7 实测：健康树 60–200 元素、开始菜单 5000+、
 * 深度普遍 ≤13。取 800 节点对应约 2000 token，12 层覆盖绝大多数应用。
 */
export interface TraversalBudget {
  maxNodes: number;
  maxDepth: number;
  deadlineMs: number;
}

export const DEFAULT_BUDGET: TraversalBudget = Object.freeze({
  maxNodes: 800,
  maxDepth: 12,
  deadlineMs: 1500,
});


/** 单个元素的采集结果。字段选择依据「模型渲不渲染得上 + 差分能不能对齐」。 */
export interface UiaNode {
  /** 稳定身份：UIA RuntimeId 序列化为 "42.1234.5"。差分对齐用，不暴露给模型。 */
  runtimeId: string;
  /** 归一化类型（button / edit / ...）。 */
  kind: string;
  /** 原始 ControlType 数字，诊断用。 */
  controlType: number | undefined;
  name: string;
  value: string;
  automationId: string;
  className: string;
  /** 层级深度，0 为窗口根。 */
  depth: number;
  /** 父节点在 nodes 数组中的下标；-1 表示根。 */
  parentIndex: number;
  /** 子节点在 nodes 数组中的下标列表，保持 UIA 原始顺序。 */
  childIndexes: number[];
  /** 屏幕坐标包围盒；无有效值时 undefined。 */
  bounds: { left: number; top: number; width: number; height: number } | undefined;
  /** 状态标记，见 STATE_FLAGS。 */
  states: string[];
  /** 是否可交互（决定是否给模型动作句柄）。 */
  interactive: boolean;
  /** 是否离屏（IsOffscreen）。离屏元素仍保留在树里，但渲染时会标注。 */
  offscreen: boolean;
  /**
   * COM 元素句柄。
   *
   * 只在 Helper 进程内使用，绝不跨管道传输——句柄不跨进程。
   * 动作阶段靠它取 bounds / 调 pattern，不必重新遍历整棵树。
   */
  element: unknown;
}

/** 一次快照的完整结果。 */
export interface UiaSnapshot {
  /** 本次快照的稳定 ID，形如 "s-12"。 */
  stateId: string;
  /** 目标窗口标题。 */
  windowTitle: string;
  /**
   * 目标窗口的稳定标识，形如 `hwnd-0x1a2b3c`。
   *
   * 用途是**按窗口串行化动作**（见 `runtime/window-lanes.ts`）：
   * 同一窗口的写操作必须排队，不同窗口可以并行。
   *
   * 为什么用 HWND 而不是标题或 pid：
   * - 标题可变（用户改标题、切页面），拿它当 key 会让同一窗口被当成两个
   * - 一个 pid 可能有多个窗口，按 pid 会误把不同窗口算成一个
   * - HWND 在窗口存活期间唯一且稳定
   *
   * 取不到 HWND 时为 undefined（例如无树应用或元素本身无 NativeWindowHandle）。
   * 那种情况下动作层会退化为不排队——宁可少排队，也不要按错 key 串行。
   */
  windowKey: string | undefined;
  /** 目标进程 pid。 */
  processId: number | undefined;
  /** 宿主框架（Win32 / WPF / Chrome / Qt...），来自 FrameworkId。 */
  frameworkId: string;
  /** 扁平化的节点表，下标即元素索引。 */
  nodes: UiaNode[];
  /** 是否因预算被截断。 */
  truncated: boolean;
  /** 截断原因，未截断为 undefined。 */
  truncationReason: "nodes" | "depth" | "deadline" | undefined;
  /** 遍历耗时，用于诊断和预算调优。 */
  elapsedMs: number;
  /** 是否为「无树应用」（spec §5.2.1）。 */
  brittleTree: boolean;
  /**
   * 窗口根元素的 COM 指针。
   *
   * 用于动作时重新定位元素（见 `relocateByRuntimeId`）。这个指针**不可靠**：
   * 它同样可能因窗口重建而失效，但作为重新遍历的起点是必需的。
   * 定位失败时调用方应让模型重新观察。
   */
  rootElement: unknown;
}

// ---------------------------------------------------------------------------
// 属性读取原语
// ---------------------------------------------------------------------------

interface PropReader {
  (element: unknown, propertyId: number): ReturnType<typeof decodeVariant> | undefined;
}

/**
 * 构造一个属性读取器。
 *
 * IUIAutomationElement::GetCurrentPropertyValue 是虚表索引 10
 * （IUnknown 0-2，SetFocus 3，GetRuntimeId 4，FindFirst 5，FindAll 6，
 *  FindFirstBuildCache 7，FindAllBuildCache 8，BuildUpdatedCache 9，然后才是 10）。
 */
function createPropReader(): PropReader {
  return (element: unknown, propertyId: number) => {
    const buffer = Buffer.alloc(24);
    const hr = koffi.call(
      vtableEntry(element, 10) as never,
      P_GET_CURRENT_PROPERTY_VALUE,
      element,
      propertyId,
      buffer,
    ) as number;
    if (!isHresultOk(hr)) return undefined;
    return decodeVariant(buffer);
  };
}

/** 读字符串属性，失败返回空串（UIA 对不支持的属性常返回错误而非默认值）。 */
function readString(read: PropReader, element: unknown, propertyId: number): string {
  const result = read(element, propertyId);
  return typeof result?.value === "string" ? result.value : "";
}

/** 读数字属性。 */
function readNumber(read: PropReader, element: unknown, propertyId: number): number | undefined {
  const result = read(element, propertyId);
  return typeof result?.value === "number" ? result.value : undefined;
}

/** 读布尔属性。 */
function readBoolean(read: PropReader, element: unknown, propertyId: number): boolean | undefined {
  const result = read(element, propertyId);
  return typeof result?.value === "boolean" ? result.value : undefined;
}

// ---------------------------------------------------------------------------
// RuntimeId
// ---------------------------------------------------------------------------

/**
 * 读 RuntimeId 并序列化为字符串。
 *
 * SAFEARRAY(VT_I4) 的 rgsabound.cElements 在**偏移 24**（不是 28）。
 * 读反会恒得到错误长度，进而把所有元素的身份读成同一个值——spec §1.11 踩过。
 */
function readRuntimeId(element: unknown): string {
  const out: unknown[] = [null];
  const hr = koffi.call(
    vtableEntry(element, 4) as never,
    P_GET_RUNTIME_ID,
    element,
    out,
  ) as number;
  if (!isHresultOk(hr) || !out[0]) return "";

  // SAFEARRAY 头 32 字节足够取 cElements 与 pvData
  const header = Buffer.from(
    koffi.decode(out[0] as never, koffi.array("uint8", 32)),
  );
  const elementCount = header.readUInt32LE(24);
  const dataPtr = header.readBigUInt64LE(16);
  if (dataPtr === 0n || elementCount === 0) return "";

  const count = Math.min(elementCount, 8);
  const values = Array.from(
    koffi.decode(pointerFromBigInt(dataPtr) as never, koffi.array("int32", count)),
  );
  return values.join(".");
}

// ---------------------------------------------------------------------------
// 子元素枚举
// ---------------------------------------------------------------------------

/**
 * 取直接子元素。
 *
 * 必须用 TreeScope_Children(2)，用 Descendants(4) 会导致同一元素被多次访问，
 * 进而让 RuntimeId 出现重复（spec §1.11 踩过）。
 */
function childrenOf(element: unknown, rawCondition: unknown): unknown[] {
  const out: unknown[] = [null];
  const hr = koffi.call(
    vtableEntry(element, 6) as never,
    P_ELEMENT_FIND_ALL,
    element,
    2, // TreeScope_Children
    rawCondition,
    out,
  ) as number;
  if (!isHresultOk(hr) || !out[0]) return [];

  const lengthOut: number[] = [0];
  const lengthHr = koffi.call(
    vtableEntry(out[0], 3) as never,
    P_ARRAY_LENGTH,
    out[0],
    lengthOut,
  ) as number;
  if (!isHresultOk(lengthHr) || lengthOut[0] <= 0) return [];

  const children: unknown[] = [];
  for (let index = 0; index < lengthOut[0]; index += 1) {
    const childOut: unknown[] = [null];
    const childHr = koffi.call(
      vtableEntry(out[0], 4) as never,
      P_ARRAY_GET_ELEMENT,
      out[0],
      index,
      childOut,
    ) as number;
    if (isHresultOk(childHr) && childOut[0]) children.push(childOut[0]);
  }
  return children;
}

/** 创建 TrueCondition，FindAll 必须传非空条件否则返回 E_POINTER。 */
function createTrueCondition(automation: unknown): unknown {
  const out: unknown[] = [null];
  const hr = koffi.call(
    vtableEntry(automation, 21) as never,
    P_CREATE_TRUE_CONDITION,
    automation,
    out,
  ) as number;
  // 同 getPattern 的陷阱：HRESULT 成功不代表指针非空，
  // 空 condition 会让 FindAll 返回 E_POINTER 或崩溃。
  return isHresultOk(hr) ? (out[0] ?? null) : null;
}

// ---------------------------------------------------------------------------
// 状态提取
// ---------------------------------------------------------------------------

/**
 * 采集单个元素的状态标记。
 *
 * 只读必要的几个属性：每个属性都是一次跨进程 COM 调用，
 * 大树上做全集采集会把遍历时间从百毫秒级推到秒级。
 */
function collectStates(
  read: PropReader,
  element: unknown,
  kind: string,
): string[] {
  const states: string[] = [];

  if (readBoolean(read, element, UIA_PROPERTY.HAS_KEYBOARD_FOCUS) === true) {
    states.push(STATE_FLAGS.FOCUSED);
  }
  if (readBoolean(read, element, UIA_PROPERTY.IS_ENABLED) === false) {
    states.push(STATE_FLAGS.DISABLED);
  }

  // 只对相关 kind 读专用属性，避免无谓的 COM 往返
  if (kind === "edit" || kind === "document") {
    if (readBoolean(read, element, UIA_PROPERTY.IS_READ_ONLY) === true) {
      states.push(STATE_FLAGS.READONLY);
    } else {
      states.push(STATE_FLAGS.EDITABLE);
    }
  }
  if (kind === "checkbox" || kind === "radiobutton") {
    const toggle = readNumber(read, element, UIA_PROPERTY.TOGGLE_STATE);
    if (toggle === 1) states.push(STATE_FLAGS.CHECKED);
  }
  if (kind === "listitem" || kind === "treeitem" || kind === "tabitem" || kind === "dataitem") {
    if (readBoolean(read, element, UIA_PROPERTY.IS_SELECTED) === true) {
      states.push(STATE_FLAGS.SELECTED);
    }
  }
  if (kind === "treeitem" || kind === "combobox" || kind === "menuitem") {
    const expand = readNumber(read, element, UIA_PROPERTY.EXPAND_COLLAPSE_STATE);
    if (expand === 1) states.push(STATE_FLAGS.EXPANDED);
    else if (expand === 0) states.push(STATE_FLAGS.COLLAPSED);
  }

  return states;
}

// ---------------------------------------------------------------------------
// 主遍历
// ---------------------------------------------------------------------------

export interface CaptureOptions {
  budget?: Partial<TraversalBudget>;
  /** 目标元素的 root（通常是某窗口的 IUIAutomationElement）。 */
  root: unknown;
  /** 用于生成 stateId 的序号。由调用方递增以保证唯一。 */
  sequence: number;
}

/**
 * 从给定 root 采集一棵快照。
 *
 * 为什么用显式栈而不是递归：递归在 12 层深度上限下虽然安全，
 * 但显式栈让「预算耗尽即停止」的判定集中在一处，且不受 JS 调用栈限制。
 *
 * 遍历顺序采用**先序遍历 + 子节点逆序入栈**，保证输出顺序与 UIA 树一致，
 * 这样元素索引对模型是稳定可预测的。
 */
export function captureSnapshot(automation: AutomationHandle, options: CaptureOptions): UiaSnapshot {
  const budget: TraversalBudget = { ...DEFAULT_BUDGET, ...options.budget };
  const startedAt = Date.now();

  const read = createPropReader();
  const condition = createTrueCondition(automation.automation);

  const nodes: UiaNode[] = [];
  let truncated = false;
  let truncationReason: UiaSnapshot["truncationReason"];
  const deadline = startedAt + budget.deadlineMs;

  const rootElement = options.root;
  const rootChildren = childrenOf(rootElement, condition);

  // 先建根节点
  const rootNode = buildNode(read, rootElement, 0, -1);
  nodes.push(rootNode);

  // 栈元素：{ element, depth, parentIndex }
  interface Frame {
    element: unknown;
    depth: number;
    parentIndex: number;
  }

  const stack: Frame[] = [];
  for (let index = rootChildren.length - 1; index >= 0; index -= 1) {
    stack.push({ element: rootChildren[index], depth: 1, parentIndex: 0 });
  }

  while (stack.length > 0) {
    if (nodes.length >= budget.maxNodes) {
      truncated = true;
      truncationReason = "nodes";
      break;
    }
    if (Date.now() > deadline) {
      truncated = true;
      truncationReason = "deadline";
      break;
    }

    const frame = stack.pop() as Frame;
    if (frame.depth > budget.maxDepth) {
      truncated = true;
      truncationReason = truncationReason ?? "depth";
      continue;
    }

    const nodeIndex = nodes.length;
    const node = buildNode(read, frame.element, frame.depth, frame.parentIndex);
    nodes.push(node);
    nodes[frame.parentIndex]?.childIndexes.push(nodeIndex);

    const children = childrenOf(frame.element, condition);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ element: children[index], depth: frame.depth + 1, parentIndex: nodeIndex });
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const interactiveCount = nodes.filter((node) => node.interactive).length;
  // 无树判定（spec §5.2.1）：可交互元素为 0 且总数 ≤2
  const brittleTree = interactiveCount === 0 && nodes.length <= 2;

  // 窗口标识：优先 HWND，其次 pid + 标题。
  //
  // 为什么需要回退：Chromium 等框架的根元素**不暴露 NativeWindowHandle**
  // （实测 Electron 窗口的根元素该属性为 0）。只靠 HWND 会让
  // 这类应用的 windowKey 恒为 undefined，动作层就永远不排队。
  //
  // pid + 标题的组合不够完美（同一进程的两个同名窗口会被当成一个，
  // 表现为过度串行），但比「完全不排队」安全——串行只是慢，
  // 不排队会让同窗口的写操作交错，那是正确性问题。
  const rootHwnd = readNativeWindowHandle(rootElement);
  const rootPid = readNumber(read, rootElement, UIA_PROPERTY.PROCESS_ID);
  const windowKey =
    rootHwnd !== undefined && rootHwnd !== 0
      ? `hwnd-0x${rootHwnd.toString(16)}`
      : rootPid !== undefined
        ? `pid-${rootPid}:${rootNode.name}`
        : undefined;

  return {
    stateId: `s-${options.sequence}`,
    windowTitle: rootNode.name,
    windowKey,
    processId: readNumber(read, rootElement, UIA_PROPERTY.PROCESS_ID),
    frameworkId: readString(read, rootElement, UIA_PROPERTY.FRAMEWORK_ID),
    nodes,
    truncated,
    truncationReason,
    elapsedMs,
    brittleTree,
    rootElement: options.root,
  };
}

/** 采集单个节点的全部字段。 */
function buildNode(
  read: PropReader,
  element: unknown,
  depth: number,
  parentIndex: number,
): UiaNode {
  const controlType = readNumber(read, element, UIA_PROPERTY.CONTROL_TYPE);
  const kind = controlTypeToKind(controlType);
  const name = readString(read, element, UIA_PROPERTY.NAME);
  const value = readString(read, element, UIA_PROPERTY.VALUE);

  const rectResult = read(element, UIA_PROPERTY.BOUNDING_RECTANGLE);
  let bounds: UiaNode["bounds"];
  if (Array.isArray(rectResult?.value) && rectResult.value.length >= 4) {
    const [left, top, width, height] = rectResult.value as number[];
    // 过滤越界坐标：实测「最小化窗口」会返回 (-32115, -31984) 这类值（spec §1.8）
    if (
      Number.isFinite(left) &&
      Number.isFinite(top) &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0 &&
      left > -30000 &&
      top > -30000
    ) {
      bounds = { left, top, width, height };
    }
  }

  return {
    runtimeId: readRuntimeId(element),
    kind,
    controlType,
    name,
    value,
    automationId: readString(read, element, UIA_PROPERTY.AUTOMATION_ID),
    className: readString(read, element, UIA_PROPERTY.CLASS_NAME),
    depth,
    parentIndex,
    childIndexes: [],
    bounds,
    states: collectStates(read, element, kind),
    interactive: isInteractiveKind(kind),
    offscreen: readBoolean(read, element, UIA_PROPERTY.IS_OFFSCREEN) === true,
    element,
  };
}

// ---------------------------------------------------------------------------
// 顶层窗口枚举
// ---------------------------------------------------------------------------

export interface WindowSummary {
  runtimeId: string;
  title: string;
  className: string;
  processId: number | undefined;
  frameworkId: string;
  bounds: UiaNode["bounds"];
  element: unknown;
}

/** 枚举所有顶层窗口。PID 过滤在调用侧做，这里返回全集供上层决策。 */
export function listWindows(automation: AutomationHandle): WindowSummary[] {
  const read = createPropReader();
  const condition = createTrueCondition(automation.automation);
  const rootOut: unknown[] = [null];
  const hr = koffi.call(
    vtableEntry(automation.automation, 5) as never,
    P_GET_ROOT_ELEMENT,
    automation.automation,
    rootOut,
  ) as number;
  if (!isHresultOk(hr) || !rootOut[0]) return [];

  return childrenOf(rootOut[0], condition).map((element) => {
    const rectResult = read(element, UIA_PROPERTY.BOUNDING_RECTANGLE);
    let bounds: UiaNode["bounds"];
    if (Array.isArray(rectResult?.value) && rectResult.value.length >= 4) {
      const [left, top, width, height] = rectResult.value as number[];
      if (width > 0 && height > 0 && left > -30000 && top > -30000) {
        bounds = { left, top, width, height };
      }
    }
    return {
      runtimeId: readRuntimeId(element),
      title: readString(read, element, UIA_PROPERTY.NAME),
      className: readString(read, element, UIA_PROPERTY.CLASS_NAME),
      processId: readNumber(read, element, UIA_PROPERTY.PROCESS_ID),
      frameworkId: readString(read, element, UIA_PROPERTY.FRAMEWORK_ID),
      bounds,
      element,
    };
  });
}

export { hasContent, readSafeArrayDoubles };

/**
 * 读元素的 NativeWindowHandle。
 *
 * 抽成公开函数是因为动作阶段需要它，而属性读取器是私有实现。
 * 返回值保留原始有符号语义，由调用方用 normalizeHwnd 规范化。
 */
export function readNativeWindowHandle(element: unknown): number | undefined {
  const read = createPropReader();
  return readNumber(read, element, UIA_PROPERTY.NATIVE_WINDOW_HANDLE);
}

/**
 * 按 RuntimeId 在窗口子树中重新定位元素。
 *
 * **为什么必须重新定位而不能复用缓存的 COM 指针**：
 *
 * 快照里保存的 `element` 是 UIA 的 COM 接口指针。这些指针的生命周期由
 * UIA 内部管理——当 UI 发生变化（元素被销毁重建、树被刷新）后，
 * 旧指针要么返回 `E_ELEMENTNOTAVAILABLE`，要么在部分 provider 上
 * 直接导致**进程崩溃**（实测：先 capture、再 capture、然后用第一个
 * 快照的元素指针调 pattern，Helper 无输出地 segfault）。
 *
 * 因此动作执行时一律按 RuntimeId 在新遍历中重新解析，
 * 缓存指针只用于「同一批次内的连续读取」（不跨 capture）。
 *
 * 返回 undefined 表示元素已不存在（模型需要重新观察）。
 */
export function relocateByRuntimeId(
  automation: AutomationHandle,
  rootElement: unknown,
  runtimeId: string,
  maxNodes = 2000,
): unknown | undefined {
  if (!runtimeId) return undefined;
  const condition = createTrueCondition(automation.automation);

  // 广度优先搜索：先比根，再逐层下壶。
  // 用 BFS 而非 DFS 是因为目标通常不会太深，BFS 能在命中时立即返回。
  const queue: unknown[] = [rootElement];
  let visited = 0;
  while (queue.length > 0 && visited < maxNodes) {
    const current = queue.shift() as unknown;
    visited += 1;
    if (readRuntimeId(current) === runtimeId) return current;
    for (const child of childrenOf(current, condition)) {
      queue.push(child);
    }
  }
  return undefined;
}
