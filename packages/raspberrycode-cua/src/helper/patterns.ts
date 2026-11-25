/**
 * 无障碍动作派发（二级路径）。
 *
 * 与一级的根本差异（spec §1.1 实测）：**UIA 的所有动作 pattern 都会把目标窗口
 * 激活到前台**。Invoke / Toggle / ExpandCollapse / SetFocus 四个 pattern 全部如此，
 * 且在 UWP 计算器、Win32 资源管理器、agent-desktop 三个独立来源上一致复现。
 *
 * 因此本路径只在不满足于「一级不生效」时才用，且必须计入干扰预算：
 * 它**不抢键鼠**（符合硬底线），但会激活窗口。
 *
 * 语义精确度是一级的超集：
 * - Invoke：按钮、超链接、菜单项
 * - Toggle：复选框、单选框
 * - SelectionItem：列表项、树项、标签页
 * - ExpandCollapse：树节点、下拉框
 * - Value：编辑框、滑块、微调器
 */

import koffi from "koffi";
import { isHresultOk, readBstr, stabilizeComInterface, vtableEntry } from "./win32.ts";
import {
  P_ELEMENT_SET_FOCUS,
  P_GET_CURRENT_PATTERN,
  P_INVOKE,
  P_TOGGLE,
  P_SELECT,
  P_EXPAND,
  P_COLLAPSE,
  P_SET_VALUE,
  P_GET_CURRENT_VALUE,
  P_TEXT_GET_DOCUMENT_RANGE,
  P_TEXT_GET_SELECTION,
  P_RANGE_CLONE,
  P_RANGE_MOVE_ENDPOINT_BY_RANGE,
  P_RANGE_MOVE_ENDPOINT_BY_UNIT,
  P_RANGE_SELECT,
  P_RANGE_GET_TEXT,
  P_RANGE_ARRAY_LENGTH,
  P_RANGE_ARRAY_GET_ELEMENT,
} from "./protos.ts";

/**
 * UIA Pattern ID。
 *
 * 这些编号来自 UIAutomationClient.h 的 UIA_*PatternId 枚举，
 * 与属性 ID（30xxx）是两套独立编号，别混。
 */
/**
 * UIA control pattern ID。
 *
 * **这些值必须与 Microsoft 官方 `UIAutomationClient.h` 逐字一致。**
 * 曾经这张表有六项抄错（VALUE 写成 10014、TOGGLE 写成 10010、
 * SELECTION_ITEM 写成 10002 …），代价极具误导性：
 *
 * - 用 10014 当 ValuePattern，实际拿到的是 **TextPattern**；
 *   调它的「SetValue」（虚表索引 3 = TextPattern::GetSelection 附近的槽位）
 *   参数完全不对 → `ACCESS_VIOLATION` 崩溃。
 * - 用 10010 当 TogglePattern，实际是 **SelectionItemPattern**；
 *   所以复选框「不支持 Toggle」——因为查的根本不是 Toggle。
 *
 * 结论被误记为「ValuePattern::SetValue 必然崩溃」，实际是**查错了 pattern**。
 * 表列官方值（https://learn.microsoft.com/windows/win32/winauto/uiauto-controlpattern-ids）：
 *
 * | ID | 常量 |
 * | --- | --- |
 * | 10000 | Invoke |
 * | 10001 | Selection |
 * | 10002 | Value |
 * | 10003 | RangeValue |
 * | 10004 | Scroll |
 * | 10005 | ExpandCollapse |
 * | 10007 | GridItem |
 * | 10009 | Window |
 * | 10010 | SelectionItem |
 * | 10012 | Table |
 * | 10013 | TableItem |
 * | 10014 | Text |
 * | 10015 | Toggle |
 * | 10016 | Transform |
 * | 10017 | ScrollItem |
 * | 10018 | LegacyIAccessible |
 * | 10019 | ItemContainer |
 * | 10020 | VirtualizedItem |
 * | 10021 | SynchronizedInput |
 */
export const UIA_PATTERN = Object.freeze({
  INVOKE: 10000,
  SELECTION: 10001,
  VALUE: 10002,
  RANGE_VALUE: 10003,
  SCROLL: 10004,
  EXPAND_COLLAPSE: 10005,
  GRID_ITEM: 10007,
  WINDOW: 10009,
  SELECTION_ITEM: 10010,
  TABLE: 10012,
  TABLE_ITEM: 10013,
  TEXT: 10014,
  TOGGLE: 10015,
  TRANSFORM: 10016,
  SCROLL_ITEM: 10017,
  /** LegacyIAccessible 作为最后兜底（部分老控件只支持它）。 */
  LEGACY_ACCESSIBLE: 10018,
  ITEM_CONTAINER: 10019,
  VIRTUALIZED_ITEM: 10020,
  SYNCHRONIZED_INPUT: 10021,
});

/**
 * Pattern 方法在各自虚表中的索引。
 *
 * 所有 pattern 接口都从 IUnknown(0-2) 开始，因此动作方法从前 3 之后算起。
 * 这些索引是实测确认的（spec §1.12 踩过 Toggle 用 4 的错）。
 */
const PATTERN_METHOD_INDEX = Object.freeze({
  /** IUIAutomationInvokePattern::Invoke */
  invoke: 3,
  /** IUIAutomationTogglePattern::Toggle */
  toggle: 3,
  /** IUIAutomationSelectionItemPattern::Select */
  select: 3,
  /** IUIAutomationExpandCollapsePattern::Expand */
  expand: 3,
  /** IUIAutomationExpandCollapsePattern::Collapse */
  collapse: 4,
  /** IUIAutomationValuePattern::SetValue */
  setValue: 3,
});

/** IUIAutomationElement::GetCurrentPattern 的虚表索引。 */
const ELEMENT_GET_CURRENT_PATTERN = 16;

/**
 * TextPattern / TextRange / TextRangeArray 的方法索引。
 *
 * **三者是不同接口，索引互不通用。** 这些值已在真实记事本上用「返回值内容
 * 是否符合预期」逐条验证（2026-11-19）：get_DocumentRange 取到全文、
 * 折叠后为空串、右移 5 字符后 System 读回的选区正好是前 5 个字符。
 *
 * 与 pattern ID 表抄错那次的教训一致：混用接口索引会调进错误槽位，
 * 表现为 ACCESS_VIOLATION 或 S_OK 配垃圾值，且错误码不指向根因。
 */
const TEXT_PATTERN_INDEX = Object.freeze({
  /** get_DocumentRange */
  documentRange: 7,
  /** GetSelection → IUIAutomationTextRangeArray */
  getSelection: 5,
});

const TEXT_RANGE_INDEX = Object.freeze({
  /** Clone */
  clone: 3,
  /** MoveEndpointByUnit */
  moveEndpointByUnit: 14,
  /** MoveEndpointByRange */
  moveEndpointByRange: 15,
  /** Select */
  select: 16,
  /** GetText */
  getText: 12,
});

const TEXT_RANGE_ARRAY_INDEX = Object.freeze({
  /** get_Length */
  length: 3,
  /** GetElement */
  getElement: 4,
});

/** TextPatternRangeEndpoint 枚举：Start=0, End=1。 */
const TEXT_PATTERN_RANGE_ENDPOINT = Object.freeze({ START: 0, END: 1 });

/** TextUnit 枚举：Character=0（选文本只按字符，按行/段是另一回事）。 */
const TEXT_UNIT = Object.freeze({ CHARACTER: 0 });

/**
 * 取元素上的指定 pattern。
 *
 * 返回 null 表示该元素不支持此 pattern——这是**正常情况**而非错误。
 *
 * **关键陷阱**：`GetCurrentPattern` 对不支持的 pattern 会返回 **S_OK 但空指针**，
 * 而不是返回错误 HRESULT。因此判断依据必须是「HRESULT 成功 **且** 指针非空」。
 *
 * 只判断 HRESULT 会把 null 当成有效 pattern 传给 `koffi.call`，
 * 导致**空指针解引用、进程无输出地崩溃**（实测踩过：Helper 静默 segfault，
 * 连接断开但无任何错误日志）。
 */
export function getPattern(element: unknown, patternId: number): unknown | null {
  const out: unknown[] = [null];
  const hr = koffi.call(
    vtableEntry(element, ELEMENT_GET_CURRENT_PATTERN) as never,
    P_GET_CURRENT_PATTERN,
    element,
    patternId,
    out,
  ) as number;
  if (!isHresultOk(hr)) return null;
  // 指针必须非空才算可用：对不支持的 pattern，本调用返回 S_OK + 空指针
  if (!out[0]) return null;

  // 强制稳定化。**稳定化失败时返回 null，绝不能回退到原指针**——
  // 原指针直接调用会 ACCESS_VIOLATION 打崩整个 Helper 进程（实测多次）。
  // 宁可直接返回「该 pattern 不可用」，也不要让调用方拿到一个会崩的指针。
  return stabilizeComInterface(out[0]) ?? null;
}

/** 调用 pattern 的无参动作方法。proto 从集中注册表取。 */
function callPatternAction(
  pattern: unknown,
  methodIndex: number,
  proto: koffi.IKoffiCType,
): number {
  return koffi.call(vtableEntry(pattern, methodIndex) as never, proto, pattern) as number;
}

/** 可供模型请求的动作类型。 */
export type SemanticAction =
  | "press"
  | "toggle"
  | "select"
  | "expand"
  | "collapse"
  | "set_value";

/**
 * 把模型可能传来的动作名归一化成真正的 UIA 语义动作。
 *
 * 为什么需要这一层：树摘要里的 `actions` 是**声明性**推断（`handler-support.ts`
 * 的 `inferActionsFor`），它给出的是面向模型的通俗名字——`click` 表示「这个元素
 * 可以点」，而不是「它有 UIA InvokePattern」。而执行层只认 UIA 动作名。
 *
 * 两套名字不一致的代价（2026-11-19 实测）：模型照着树里写的 `click` 调用
 * `perform_action`，被动作层以「元素没有声明 click」拒绝——而它明明就是照着
 * 树写的。这类「按文档做却失败」的错最消耗信任。
 *
 * 归一化规则：`click` → `press`（UIA 里点按钮就是 Invoke）。
 * 其它名字原样返回，由调用方判定是否被元素支持。
 */
export function normalizeSemanticAction(action: string): SemanticAction {
  if (action === "click") return "press";
  return action as SemanticAction;
}

/**
 * TextPattern 选区结果。
 *
 * `ok` 为假时 `reason` 说明是哪一步不通——文本选区有四个独立的失败点，
 * 合并成一句「不支持」会让调用方无法判断该重试、该换目标、还是该换方法。
 */
export interface TextSelectionResult {
  ok: boolean;
  /** 实际被选中的文本（从系统读回，不是本地推算）。 */
  selectedText?: string;
  /** 文档全文长度，便于调用方校验 range 是否越界。 */
  documentLength?: number;
  reason?: string;
  hresult?: string;
}

/**
 * 在元素上按字符区间选中文本（UIA TextPattern）。
 *
 * 实现路径（每一步的虚表索引都已实测，见 protos.ts 的注释）：
 *   `get_DocumentRange(7)` → `Clone(3)` → `MoveEndpointByRange(15)` 折叠到文首
 *   → `MoveEndpointByUnit(14)` 右移末端 N 字符 → `Select(16)`
 *   → 再 `GetSelection(5)` 读回真实选区作为验证。
 *
 * 为什么最后要读回：`Select` 返回 S_OK 只代表调用被接受。
 * 若目标控件是只读、或有其他逻辑重置了选区，S_OK 与实际不符；
 * 读回系统真实选区是唯一能证明「用户真的会看到高亮」的依据。
 *
 * **失败不降级到物理注入**：文本选区靠 SetFocus + 方向键模拟也能做到，
 * 但那会抢键鼠且位置极易算错（需要处理换行、软换行、自动换行）。
 * 这里宁可明确报错，也不静默换成一条会打乱用户输入的路径。
 */
export function selectTextRange(
  element: unknown,
  start: number,
  length: number,
): TextSelectionResult {
  const pattern = getPattern(element, UIA_PATTERN.TEXT);
  if (!pattern) {
    return {
      ok: false,
      reason:
        "该元素不支持 UIA TextPattern（可能是自绘控件、Qt 应用，或 Chromium 未开渲染无障碍）。" +
        "可改用 set_value 整体替换文本，或用 key 发 ctrl+a 选中全部。",
    };
  }

  const docOut: unknown[] = [null];
  const hrDoc = koffi.call(
    vtableEntry(pattern, TEXT_PATTERN_INDEX.documentRange) as never,
    P_TEXT_GET_DOCUMENT_RANGE,
    pattern,
    docOut,
  ) as number;
  if (!isHresultOk(hrDoc) || !docOut[0]) {
    return {
      ok: false,
      reason: "取文档范围失败（get_DocumentRange）。",
      hresult: formatHr(hrDoc),
    };
  }

  const docText = readRangeText(docOut[0]);
  const documentLength = docText === undefined ? undefined : docText.length;
  if (documentLength !== undefined && start + length > documentLength) {
    return {
      ok: false,
      documentLength,
      reason:
        `选区 [${start}, ${start + length}) 超出文档长度 ${documentLength}。` +
        "请先观察（get_app_state 的 value 字段）确认真实文本长度。",
    };
  }

  // 折叠到文首：克隆一份，再把它的 End 端点对齐到文档 Start。
  // 直接改文档范围会让控件自身的插入点跳到文首，克隆可避免这个副作用。
  const cloneOut: unknown[] = [null];
  const hrClone = koffi.call(
    vtableEntry(docOut[0], TEXT_RANGE_INDEX.clone) as never,
    P_RANGE_CLONE,
    docOut[0],
    cloneOut,
  ) as number;
  const work = cloneOut[0];
  if (!isHresultOk(hrClone) || !work) {
    return { ok: false, reason: "克隆文本范围失败（Clone）。", hresult: formatHr(hrClone) };
  }

  const hrFold = koffi.call(
    vtableEntry(work, TEXT_RANGE_INDEX.moveEndpointByRange) as never,
    P_RANGE_MOVE_ENDPOINT_BY_RANGE,
    work,
    TEXT_PATTERN_RANGE_ENDPOINT.END,
    docOut[0],
    TEXT_PATTERN_RANGE_ENDPOINT.START,
  ) as number;
  if (!isHresultOk(hrFold)) {
    return {
      ok: false,
      reason: "把选区折叠到文首失败（MoveEndpointByRange）。",
      hresult: formatHr(hrFold),
    };
  }

  // 右移末端：两个端点**各自独立定位**。
  //
  // 关键理解（实测得出，写错会得到错误选区）：`MoveEndpointByUnit` 移动的是
  // 端点自身，不是「从当前位置扩展」。所以正确顺序是
  //   Start 移到 start，End 移到 start + length。
  //
  // 曾经的错误写法是「先移 Start 到 start，再移 End 移 length」——
  // 那会让 End 落到 length 而不是 start+length，
  // 于是请求 [11,5) 会选到 [11, 5) 被解释成 [0,16) 之类的结果（实测选到 16 个字符）。
  const moveEndpoint = (endpoint: number, count: number, label: string): number | undefined => {
    if (count <= 0) return 0;
    const moved = koffi.alloc("int", 1);
    const hr = koffi.call(
      vtableEntry(work, TEXT_RANGE_INDEX.moveEndpointByUnit) as never,
      P_RANGE_MOVE_ENDPOINT_BY_UNIT,
      work,
      endpoint,
      TEXT_UNIT.CHARACTER,
      count,
      moved,
    ) as number;
    if (!isHresultOk(hr)) {
      throw Object.assign(new Error(`${label}失败（MoveEndpointByUnit）。`), {
        code: "element_unavailable",
        detail: { hresult: formatHr(hr) },
      });
    }
    return koffi.decode(moved, "int") as number;
  };

  try {
    // 先移末端（End）到 start + length，再移起点（Start）到 start。
    // 顺序不能反：若先把 Start 推到 start，再移 End 时范围已非空，
    // 部分 provider 会以「保持相对」的方式移动，结果不再等于绝对位置。
    const endTarget = start + length;
    if (endTarget > 0) {
      const movedEnd = moveEndpoint(TEXT_PATTERN_RANGE_ENDPOINT.END, endTarget, "定位选区末端");
      if (movedEnd !== undefined && movedEnd < endTarget) {
        return {
          ok: false,
          documentLength,
          reason:
            `文档只有 ${documentLength ?? "未知"} 个字符，末端只能到 ${movedEnd}（请求 ${endTarget}）。`,
        };
      }
    }
    if (start > 0) {
      const movedStart = moveEndpoint(TEXT_PATTERN_RANGE_ENDPOINT.START, start, "定位选区起点");
      if (movedStart !== undefined && movedStart < start) {
        return {
          ok: false,
          documentLength,
          reason:
            `文档只有 ${documentLength ?? "未知"} 个字符，起点只能到 ${movedStart}（请求 ${start}）。`,
        };
      }
    }
  } catch (error) {
    const detail = (error as { detail?: { hresult?: string } }).detail;
    return {
      ok: false,
      reason: (error as Error).message,
      ...(detail?.hresult ? { hresult: detail.hresult } : {}),
    };
  }

  const hrSelect = koffi.call(
    vtableEntry(work, TEXT_RANGE_INDEX.select) as never,
    P_RANGE_SELECT,
    work,
  ) as number;
  if (!isHresultOk(hrSelect)) {
    return { ok: false, reason: "应用选区失败（Select）。", hresult: formatHr(hrSelect) };
  }

  // 读回系统真实选区：Select 返回 S_OK 不等于用户真的看到高亮。
  const selectedText = readCurrentSelectionText(pattern);
  return {
    ok: true,
    ...(selectedText !== undefined ? { selectedText } : {}),
    ...(documentLength !== undefined ? { documentLength } : {}),
  };
}

/** 读取 text range 的文本。失败返回 undefined（不抛，便于当作诊断信息）。 */
function readRangeText(range: unknown): string | undefined {
  const out: unknown[] = [null];
  const hr = koffi.call(
    vtableEntry(range, TEXT_RANGE_INDEX.getText) as never,
    P_RANGE_GET_TEXT,
    range,
    -1,
    out,
  ) as number;
  if (!isHresultOk(hr) || !out[0]) return undefined;
  const { value, release } = readBstr(BigInt(koffi.address(out[0])));
  release();
  return value;
}

/** 读回 TextPattern 当前的真实选区文本。无选区时返回空串。 */
function readCurrentSelectionText(pattern: unknown): string | undefined {
  const arrayOut: unknown[] = [null];
  const hr = koffi.call(
    vtableEntry(pattern, TEXT_PATTERN_INDEX.getSelection) as never,
    P_TEXT_GET_SELECTION,
    pattern,
    arrayOut,
  ) as number;
  if (!isHresultOk(hr) || !arrayOut[0]) return undefined;

  const count = koffi.alloc("int", 1);
  const hrLen = koffi.call(
    vtableEntry(arrayOut[0], TEXT_RANGE_ARRAY_INDEX.length) as never,
    P_RANGE_ARRAY_LENGTH,
    arrayOut[0],
    count,
  ) as number;
  const n = koffi.decode(count, "int") as number;
  if (!isHresultOk(hrLen) || n <= 0) return "";

  const rangeOut: unknown[] = [null];
  const hrGet = koffi.call(
    vtableEntry(arrayOut[0], TEXT_RANGE_ARRAY_INDEX.getElement) as never,
    P_RANGE_ARRAY_GET_ELEMENT,
    arrayOut[0],
    0,
    rangeOut,
  ) as number;
  if (!isHresultOk(hrGet) || !rangeOut[0]) return undefined;
  return readRangeText(rangeOut[0]);
}

export interface SemanticActionResult {
  /** 实际使用的 pattern 名。 */
  pattern: string;
  /** HRESULT 是否成功。 */
  ok: boolean;
  /** 原始 HRESULT，诊断用。 */
  hresult: string;
}

/**
 * 读取 ValuePattern 的当前值。
 *
 * 定向文本输入需要「读当前值 → 计算插入后的新值 → SetValue」。
 * 读失败与读到空串必须区分：前者不能当成空值去覆盖。
 */
export interface ValuePatternReadResult {
  ok: boolean;
  value?: string;
  reason?: string;
  hresult?: string;
}

export function readValuePatternValue(element: unknown): ValuePatternReadResult {
  const pattern = getPattern(element, UIA_PATTERN.VALUE);
  if (!pattern) return { ok: false, reason: "该元素不支持 UIA ValuePattern。" };
  const out: unknown[] = [null];
  const hr = koffi.call(
    vtableEntry(pattern, 4) as never,
    P_GET_CURRENT_VALUE,
    pattern,
    out,
  ) as number;
  if (!isHresultOk(hr)) {
    return { ok: false, reason: "读取 ValuePattern 当前值失败。", hresult: formatHr(hr) };
  }
  const raw = out[0];
  if (typeof raw !== "bigint") {
    return { ok: false, reason: "ValuePattern 返回了非 BSTR 值。" };
  }
  const bstr = readBstr(raw);
  const value = bstr.value;
  bstr.release();
  return { ok: true, value };
}

/**
 * 按动作类型选择并执行 pattern。
 *
 * 为什么不做「自动挑一个能用的 pattern」：
 * 不同 pattern 的语义不同（Toggle 与 Select 对同一元素可能都可用但行为不同），
 * 自动选会被模型误解为「我要点击」实际执行了「切换选中状态」。
 * 因此动作类型由调用方明确指定，本函数只负责执行。
 */
export function runSemanticAction(
  element: unknown,
  action: SemanticAction,
  value?: string,
): SemanticActionResult | null {
  switch (action) {
    case "press": {
      const pattern = getPattern(element, UIA_PATTERN.INVOKE);
      if (!pattern) return null;
      const hr = callPatternAction(pattern, PATTERN_METHOD_INDEX.invoke, P_INVOKE);
      return { pattern: "invoke", ok: isHresultOk(hr), hresult: formatHr(hr) };
    }

    case "toggle": {
      const pattern = getPattern(element, UIA_PATTERN.TOGGLE);
      if (!pattern) return null;
      // 索引 3 正确（spec §1.12 实测：写成 4 会调到一个不存在的槽位）
      const hr = callPatternAction(pattern, PATTERN_METHOD_INDEX.toggle, P_TOGGLE);
      return { pattern: "toggle", ok: isHresultOk(hr), hresult: formatHr(hr) };
    }

    case "select": {
      const pattern = getPattern(element, UIA_PATTERN.SELECTION_ITEM);
      if (!pattern) return null;
      const hr = callPatternAction(pattern, PATTERN_METHOD_INDEX.select, P_SELECT);
      return { pattern: "selection_item", ok: isHresultOk(hr), hresult: formatHr(hr) };
    }

    case "expand": {
      const pattern = getPattern(element, UIA_PATTERN.EXPAND_COLLAPSE);
      if (!pattern) return null;
      const hr = callPatternAction(pattern, PATTERN_METHOD_INDEX.expand, P_EXPAND);
      return { pattern: "expand_collapse", ok: isHresultOk(hr), hresult: formatHr(hr) };
    }

    case "collapse": {
      const pattern = getPattern(element, UIA_PATTERN.EXPAND_COLLAPSE);
      if (!pattern) return null;
      const hr = callPatternAction(pattern, PATTERN_METHOD_INDEX.collapse, P_COLLAPSE);
      return { pattern: "expand_collapse", ok: isHresultOk(hr), hresult: formatHr(hr) };
    }

    case "set_value": {
      const pattern = getPattern(element, UIA_PATTERN.VALUE);
      if (!pattern) return null;
      const hr = koffi.call(
        vtableEntry(pattern, PATTERN_METHOD_INDEX.setValue) as never,
        P_SET_VALUE,
        pattern,
        value ?? "",
      ) as number;
      return { pattern: "value", ok: isHresultOk(hr), hresult: formatHr(hr) };
    }

    default:
      return null;
  }
}

/**
 * 探测元素支持哪些语义动作。
 *
 * 代价是每个 pattern 一次 `GetCurrentPattern`（跨进程 COM 调用）。
 * 只在动作阶段调用，不在树遍历期调用——遍历期做全集探测会让
 * 800 节点的树从百毫秒级推到秒级。
 */
export function detectActions(element: unknown): SemanticAction[] {
  const actions: SemanticAction[] = [];
  if (getPattern(element, UIA_PATTERN.INVOKE)) actions.push("press");
  if (getPattern(element, UIA_PATTERN.TOGGLE)) actions.push("toggle");
  if (getPattern(element, UIA_PATTERN.SELECTION_ITEM)) actions.push("select");
  const expand = getPattern(element, UIA_PATTERN.EXPAND_COLLAPSE);
  if (expand) {
    actions.push("expand");
    actions.push("collapse");
  }
  if (getPattern(element, UIA_PATTERN.VALUE)) actions.push("set_value");
  return actions;
}

function formatHr(hr: number): string {
  return `0x${(hr >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * 给元素设置焦点。
 *
 * 独立于 `runSemanticAction`：焦点不是「动作」，而是执行动作的前置条件。
 * 键盘输入必须先把焦点给到目标控件，否则输入会打到别处。
 *
 * 注意 `IUIAutomationElement::SetFocus` **会激活窗口**（实测），
 * 与二级 pattern 同性质——调用方需要把它计入干扰披露。
 *
 * 虚表索引 3，见 `tree.ts` 的接口方法表注释。
 */
export function focusElement(element: unknown): SemanticActionResult {
  if (!element) {
    return { pattern: "SetFocus", ok: false, hresult: "null_element" };
  }
  const hr = koffi.call(vtableEntry(element, 3) as never, P_ELEMENT_SET_FOCUS, element) as number;
  return {
    pattern: "SetFocus",
    ok: isHresultOk(hr),
    hresult: formatHr(hr),
  };
}
