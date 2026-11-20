/**
 * UIA 属性 ID 常量。
 *
 * 编号来源：UIAutomationClient.h 的 UIA_*PropertyId 枚举。
 * 集中在此是因为有几个编号极易记错，且错了不报错、只返回语义不同的值——
 * 最难排查的一类 bug。
 *
 * 已核对的易错项（2026-11-19，对照 Microsoft uiauto-automation-element-propids）：
 * - **30019** 是 IsPassword（布尔）。**30022** 是 IsOffscreen（布尔）。
 *   曾误以为 30022 是 IsPassword，那会让 IsOffscreen 的 true/false
 *   被当成密码标记，诊断信息全错。
 * - **30086** 是 ToggleToggleState（0=Off / 1=On / 2=Indeterminate）。
 *   用 30022 读 ToggleState 会恒得布尔值，误判「切换无效」。
 */

export const UIA_PROPERTY = Object.freeze({
  /** BoundingRectangle，VT_ARRAY|VT_R8 的 4 元组 {left, top, width, height}。 */
  BOUNDING_RECTANGLE: 30001,
  /** ProcessId，VT_I4。 */
  PROCESS_ID: 30002,
  /** ControlType，VT_I4。 */
  CONTROL_TYPE: 30003,
  /** Name，VT_BSTR。 */
  NAME: 30005,
  /** HasKeyboardFocus，VT_BOOL。 */
  HAS_KEYBOARD_FOCUS: 30008,
  /** IsKeyboardFocusable，VT_BOOL。 */
  IS_KEYBOARD_FOCUSABLE: 30009,
  /** IsEnabled，VT_BOOL。 */
  IS_ENABLED: 30010,
  /** AutomationId，VT_BSTR。 */
  AUTOMATION_ID: 30011,
  /** ClassName，VT_BSTR。 */
  CLASS_NAME: 30012,
  /** HelpText，VT_BSTR。 */
  HELP_TEXT: 30013,
  /** IsPassword，VT_BOOL。注意是 30019，不是 30022。 */
  IS_PASSWORD: 30019,
  /** NativeWindowHandle，VT_I4。 */
  NATIVE_WINDOW_HANDLE: 30020,
  /** IsOffscreen，VT_BOOL。用于过滤不可见元素。 */
  IS_OFFSCREEN: 30022,
  /** FrameworkId，VT_BSTR。用于识别宿主框架（Win32/WPF/Chromium/Qt）。 */
  FRAMEWORK_ID: 30024,
  /** ItemStatus，VT_BSTR。 */
  ITEM_STATUS: 30026,
  /** Value.Value，VT_BSTR。 */
  VALUE: 30045,
  /** IsReadOnly（Value），VT_BOOL。 */
  IS_READ_ONLY: 30046,
  /** ExpandCollapseState，VT_I4（0=Collapsed 1=Expanded 2=Partially 3=LeafNode）。 */
  EXPAND_COLLAPSE_STATE: 30070,
  /** IsSelected（SelectionItem），VT_BOOL。 */
  IS_SELECTED: 30079,
  /** ToggleState，VT_I4。注意是 30086。 */
  TOGGLE_STATE: 30086,
});
