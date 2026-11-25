/**
 * koffi 原型定义集中注册表。
 *
 * 为什么单独一个文件：`koffi.proto(name, signature)` 按**名字全局注册**，
 * 同一进程内重复定义同名 proto 会抛 `Duplicate type name`。
 * 这个问题在实际开发中踩了三次——每次都是在某个函数体内定义 proto，
 * 调用两次就炸。而且错误只在第二次调用时才出现，第一次完全正常，
 * 所以很容易漏到验收阶段。
 *
 * 解决方式：全部 proto 在模块加载时定义一次，各模块从此处取用。
 * 这是唯一能从根本上避免该问题的结构。
 */

import koffi from "koffi";

// ---------------------------------------------------------------------------
// IUIAutomation（COM 根对象）
// ---------------------------------------------------------------------------

/** IUIAutomationElement::GetRootElement —— 虚表索引 5。 */
export const P_GET_ROOT_ELEMENT = koffi.proto(
  "long __stdcall GetRootElement(void *self, _Out_ void **root)",
);

/** IUIAutomation::CreateTrueCondition —— 虚表索引 21。 */
export const P_CREATE_TRUE_CONDITION = koffi.proto(
  "long __stdcall CreateTrueCondition(void *self, _Out_ void **condition)",
);

// ---------------------------------------------------------------------------
// IUIAutomationElement
// ---------------------------------------------------------------------------

/** 虚表索引 4。 */
export const P_GET_RUNTIME_ID = koffi.proto(
  "long __stdcall GetRuntimeId(void *self, _Out_ void **out)",
);

/** 虚表索引 6。scope 传 2（Children），传 4（Descendants）会导致重复访问。 */
export const P_ELEMENT_FIND_ALL = koffi.proto(
  "long __stdcall FindAll(void *self, int scope, void *condition, _Out_ void **found)",
);

/** 虚表索引 10。 */
export const P_GET_CURRENT_PROPERTY_VALUE = koffi.proto(
  "long __stdcall GetCurrentPropertyValue(void *self, int propertyId, _Out_ void *retVal)",
);

/**
 * 虚表索引 16。
 *
 * 注意这只是「取 pattern 对象」，不同 pattern 的**动作方法**索引各不相同，
 * 见下方各 pattern 定义。
 */
export const P_GET_CURRENT_PATTERN = koffi.proto(
  "long __stdcall GetCurrentPattern(void *self, int patternId, _Out_ void **pattern)",
);

/** 虚表索引 3：SetFocus。会激活窗口，仅作诊断用。 */
export const P_ELEMENT_SET_FOCUS = koffi.proto(
  "long __stdcall SetFocus(void *self)",
);

// ---------------------------------------------------------------------------
// IUIAutomationElementArray
// ---------------------------------------------------------------------------

/** 虚表索引 3。 */
export const P_ARRAY_LENGTH = koffi.proto(
  "long __stdcall get_Length(void *self, _Out_ int *length)",
);

/** 虚表索引 4。 */
export const P_ARRAY_GET_ELEMENT = koffi.proto(
  "long __stdcall GetElement(void *self, int index, _Out_ void **element)",
);

// ---------------------------------------------------------------------------
// Pattern 动作方法
//
// 每个 pattern 接口都从 IUnknown(0-2) 开始，动作方法在 3 之后。
// 各 pattern 的方法顺序不同，索引必须逐个核对（spec §1.12 踩过 Toggle 写成 4 的错）。
// ---------------------------------------------------------------------------

/** IUIAutomationInvokePattern::Invoke —— 索引 3。 */
export const P_INVOKE = koffi.proto("long __stdcall InvokePatternInvoke(void *self)");

/** IUIAutomationTogglePattern::Toggle —— 索引 3（不是 4）。 */
export const P_TOGGLE = koffi.proto("long __stdcall TogglePatternToggle(void *self)");

/** IUIAutomationSelectionItemPattern::Select —— 索引 3。 */
export const P_SELECT = koffi.proto("long __stdcall SelectionItemPatternSelect(void *self)");

/** IUIAutomationExpandCollapsePattern::Expand —— 索引 3。 */
export const P_EXPAND = koffi.proto("long __stdcall ExpandCollapsePatternExpand(void *self)");

/** IUIAutomationExpandCollapsePattern::Collapse —— 索引 4。 */
export const P_COLLAPSE = koffi.proto(
  "long __stdcall ExpandCollapsePatternCollapse(void *self)",
);

/** IUIAutomationValuePattern::SetValue —— 索引 3。 */
export const P_SET_VALUE = koffi.proto(
  "long __stdcall ValuePatternSetValue(void *self, const char16_t *value)",
);

/** IUIAutomationValuePattern::get_CurrentValue —— 索引 4。 */
export const P_GET_CURRENT_VALUE = koffi.proto(
  "long __stdcall ValuePatternGetCurrentValue(void *self, _Out_ char16_t **value)",
);

// ---------------------------------------------------------------------------
// TextPattern（文本选区，select_text 用）
//
// IUIAutomationTextPattern 与 IUIAutomationTextRange 是两套独立接口，
// 方法顺序完全不同。索引按 UIAutomationClient.h 的声明顺序（IUnknown 之后起算）：
//
// TextPattern : 3=RangeFromPoint 4=RangeFromChild 5=GetSelection
//               6=GetVisibleRanges 7=get_DocumentRange 8=get_SupportedTextSelection
// TextRange   : 3=Clone 4=Compare 5=CompareEndpoints 6=ExpandToEnclosingUnit
//               7=FindAttribute 8=FindText 9=GetAttributeValue
//               10=GetBoundingRectangles 11=GetEnclosingElement 12=GetText
//               13=Move 14=MoveEndpointByUnit 15=MoveEndpointByRange
//               16=Select 17=AddToSelection 18=RemoveFromSelection
//               19=ScrollIntoView 20=GetChildren
//
// **这些索引必须实测确认后才能依赖**：TextPattern 与 TextRange 是不同接口，
// 把一者的索引用到另一者上会调进错误槽位 → ACCESS_VIOLATION，
// 且错误码完全不指向根因（见 patterns.ts 顶部那张抄错表的代价）。
// ---------------------------------------------------------------------------

/** IUIAutomationTextPattern::get_DocumentRange —— 索引 7。 */
export const P_TEXT_GET_DOCUMENT_RANGE = koffi.proto(
  "long __stdcall TextPatternGetDocumentRange(void *self, _Out_ void **range)",
);

/** IUIAutomationTextPattern::GetSelection —— 索引 5。返回 IUIAutomationTextRangeArray。 */
export const P_TEXT_GET_SELECTION = koffi.proto(
  "long __stdcall TextPatternGetSelection(void *self, _Out_ void **ranges)",
);

/** IUIAutomationTextRange::Clone —— 索引 3。 */
export const P_RANGE_CLONE = koffi.proto(
  "long __stdcall TextRangeClone(void *self, _Out_ void **range)",
);

/**
 * IUIAutomationTextRange::MoveEndpointByRange —— 索引 15。
 *
 * 用来把某个端点对齐到另一个端点（此处用于把 range 折叠到文首）。
 * 无 out 参数，签名简单，是三者中最安全的调用。
 */
export const P_RANGE_MOVE_ENDPOINT_BY_RANGE = koffi.proto(
  "long __stdcall TextRangeMoveEndpointByRange(void *self, int srcEndpoint, void *range, int targetEndpoint)",
);

/** IUIAutomationTextRange::MoveEndpointByUnit —— 索引 14。`moved` 回填实际移动的字符数。 */
export const P_RANGE_MOVE_ENDPOINT_BY_UNIT = koffi.proto(
  "long __stdcall TextRangeMoveEndpointByUnit(void *self, int endpoint, int unit, int count, _Out_ int *moved)",
);

/** IUIAutomationTextRange::Select —— 索引 16。 */
export const P_RANGE_SELECT = koffi.proto("long __stdcall TextRangeSelect(void *self)");

/** IUIAutomationTextRangeArray::get_Length —— 索引 3。 */
export const P_RANGE_ARRAY_LENGTH = koffi.proto(
  "long __stdcall TextRangeArrayLength(void *self, _Out_ int *length)",
);

/** IUIAutomationTextRangeArray::GetElement —— 索引 4。 */
export const P_RANGE_ARRAY_GET_ELEMENT = koffi.proto(
  "long __stdcall TextRangeArrayGetElement(void *self, int index, _Out_ void **range)",
);

/**
 * IUIAutomationTextRange::GetText —— 索引 12。
 *
 * maxLength=-1 表示不限长度。返回 BSTR，**必须用 SysFreeString 释放**
 * （BSTR 有长度前缀，直接当普通 wchar 指针 free 会破坏堆）。
 *
 * 出参刻意声明为 `void **` 而不是 `char16_t **`：koffi 会把 `char16_t *`
 * 自动解码成 JS 字符串，那样既拿不到指针（无法 SysFreeString → 内存泄漏），
 * 也绕过 `readBstr` 的 UTF-16→UTF-8 路径（非 ASCII 会乱码）。
 * 这里只要原始指针，解码交给 `readBstr`。
 */
export const P_RANGE_GET_TEXT = koffi.proto(
  "long __stdcall TextRangeGetText(void *self, int maxLength, _Out_ void **text)",
);

/** IUnknown::QueryInterface —— 索引 0。用于稳定化 pattern 指针。 */
export const P_QUERY_INTERFACE = koffi.proto(
  "long __stdcall QueryInterfaceStabilize(void *self, const void *riid, _Out_ void **out)",
);

/** IUnknown::Release —— 索引 2。 */
export const P_RELEASE = koffi.proto("uint32 __stdcall ReleaseUnknown(void *self)");
