/**
 * UIA 控件类型到 normalized kind 的映射。
 *
 * 为什么要归一：UIA 的 ControlType 是数字 ID，模型看到的应该是语义词
 * （button / edit / listitem）。归一表同时是「跨平台一致」的基础，
 * 将来 macOS AX role 映射到同一套 kind，模型侧无需区分平台。
 *
 * ID 来源：UIAutomationClient.h 的 UIA_*ControlTypeId 常量。
 */

import { UIA_PROPERTY } from "./properties.ts";

const CONTROL_TYPE_KIND: Readonly<Record<number, string>> = {
  50000: "button",
  50001: "calendar",
  50002: "checkbox",
  50003: "combobox",
  50004: "edit",
  50005: "hyperlink",
  50006: "image",
  50007: "listitem",
  50008: "list",
  50009: "menu",
  50010: "menubar",
  50011: "menuitem",
  50012: "progressbar",
  50013: "radiobutton",
  50014: "scrollbar",
  50015: "slider",
  50016: "spinner",
  50017: "statusbar",
  50018: "tab",
  50019: "tabitem",
  50020: "text",
  50021: "toolbar",
  50022: "tooltip",
  50023: "tree",
  50024: "treeitem",
  50025: "custom",
  50026: "group",
  50027: "thumb",
  50028: "datagrid",
  50029: "dataitem",
  50030: "document",
  50031: "splitbutton",
  50032: "window",
  50033: "pane",
  50034: "header",
  50035: "headeritem",
  50036: "table",
  50037: "titlebar",
  50038: "separator",
};

/** 未知类型保留数字，便于诊断时反查，但用 ct 前缀标明它不是 normalized kind。 */
export function controlTypeToKind(controlType: number | undefined): string {
  if (controlType === undefined) return "unknown";
  return CONTROL_TYPE_KIND[controlType] ?? `ct${controlType}`;
}

/**
 * 可交互判定。
 *
 * 用途一：无树应用的识别（spec §5.2.1）——可交互元素数为 0 且总数 ≤2 即判无树。
 * 用途二：渲染时决定是否列出，避免把纯布局容器灌给模型。
 *
 * 注意这不等于「能操作」：能否操作取决于具体 pattern 是否可用，
 * 那属于动作阶段（P2）的判断。
 */
const INTERACTIVE_KINDS = new Set([
  "button",
  "splitbutton",
  "checkbox",
  "combobox",
  "edit",
  "hyperlink",
  "listitem",
  "menuitem",
  "radiobutton",
  "slider",
  "spinner",
  "tabitem",
  "treeitem",
  "dataitem",
  "headeritem",
  "thumb",
]);

export function isInteractiveKind(kind: string): boolean {
  return INTERACTIVE_KINDS.has(kind);
}

/**
 * 元素是否应被视为「有内容」。
 *
 * 空名称且空值的纯容器对模型无信息量，渲染时跳过；
 * 但有子元素的容器要保留（它承载层级结构）。
 */
export function hasContent(name: string, value: string, hasChildren: boolean): boolean {
  if (name.trim()) return true;
  if (value.trim()) return true;
  return hasChildren;
}

/** 会出现在 rendered 行里的状态标记。顺序固定，便于 diff 稳定。 */
export const STATE_FLAGS = Object.freeze({
  FOCUSED: "focused",
  EDITABLE: "editable",
  SELECTED: "selected",
  CHECKED: "checked",
  EXPANDED: "expanded",
  COLLAPSED: "collapsed",
  DISABLED: "disabled",
  READONLY: "readonly",
} as const);

/**
 * 属性 ID 常量集中在此文件外（properties.ts），因为 UIA 的属性编号
 * 有一批容易记错的坑（spec §1.12 实测：30022 是 IsPassword 而非 ToggleState）。
 */
export { UIA_PROPERTY };
