#!/usr/bin/env node

// i18n 词条精确删除器：按「键值对」为最小单位删除，避免只删一行造成值行/键行错配。
//
// 背景：直接按关键词过滤行会破坏结构——多行值（键行 + 缩进值行）只删其中一行，
// 会留下孤立的字符串导致 TS1005 语法错误。本脚本先把文件切成「条目」，
// 条目 = 键行 + 其后的缩进续行（直到下一个键行或闭合括号），再按谓词整条删除。
//
// 用法：
//   node scripts/sync/prune-i18n-keys.mjs <file> <pattern> [--apply]
//   pattern 为正则字符串，作用于「条目全文」

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const positional = argv.filter((a) => !a.startsWith("--"));
const file = positional[0];
const patternArg = positional[1];
if (!file || !patternArg) {
  console.error("用法: node scripts/sync/prune-i18n-keys.mjs <file> <pattern> [--apply]");
  process.exit(2);
}
const pattern = new RegExp(patternArg, "u");

const text = readFileSync(file, "utf8");
const lines = text.split("\n");

const KEY_RE = /^\s*"[^"]+"\s*:/u;

// 切条目：键行开启新条目，缩进续行归入当前条目，其他行（注释/括号）独立成条
const items = [];
for (const line of lines) {
  const isKey = KEY_RE.test(line);
  const isContinuation =
    !isKey && items.length > 0 && /^\s+\S/u.test(line) && items[items.length - 1].isEntry;
  if (isKey) {
    items.push({ isEntry: true, lines: [line] });
  } else if (isContinuation) {
    items[items.length - 1].lines.push(line);
  } else {
    items.push({ isEntry: false, lines: [line] });
  }
}

let removedEntries = 0;
const kept = [];
for (const item of items) {
  const body = item.lines.join("\n");
  if (item.isEntry && pattern.test(body)) {
    removedEntries += 1;
    continue;
  }
  kept.push(...item.lines);
}

const result = kept.join("\n");
console.log(`# ${file}`);
console.log(`条目总数: ${items.filter((i) => i.isEntry).length}`);
console.log(`命中删除: ${removedEntries}`);
console.log(`剩余键行: ${result.split("\n").filter((l) => KEY_RE.test(l)).length}`);
if (apply) {
  writeFileSync(file, result);
  console.log("已写入");
}
