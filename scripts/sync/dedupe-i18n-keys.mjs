#!/usr/bin/env node

// i18n 词表去重：按「条目」粒度删除重复键，保留首次出现。
//
// 背景：多轮合并/词表并集操作会产生同 key 多份定义，TS 报 TS1117。
// 直接按行过滤会破坏多行值结构，因此复用条目切分口径：
// 条目 = 键行 + 紧随的缩进续行（直到下一个键行或非缩进行）。
//
// 用法：
//   node scripts/sync/dedupe-i18n-keys.mjs <file> [--apply]

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("用法: node scripts/sync/dedupe-i18n-keys.mjs <file> [--apply]");
  process.exit(2);
}

const lines = readFileSync(file, "utf8").split("\n");
const KEY_RE = /^\s{2}"([^"]+)"\s*:/u;

const items = [];
for (const line of lines) {
  const m = line.match(KEY_RE);
  if (m) {
    items.push({ isEntry: true, key: m[1], lines: [line] });
    continue;
  }
  const prev = items[items.length - 1];
  const isContinuation = prev && prev.isEntry && /^\s+\S/u.test(line);
  if (isContinuation) prev.lines.push(line);
  else items.push({ isEntry: false, lines: [line] });
}

const seen = new Set();
const kept = [];
const removed = [];
for (const item of items) {
  if (item.isEntry) {
    if (seen.has(item.key)) {
      removed.push(item.key);
      continue;
    }
    seen.add(item.key);
  }
  kept.push(...item.lines);
}

console.log(`# ${file}`);
console.log(`唯一条目: ${seen.size}`);
console.log(`删除重复: ${removed.length}`);
if (removed.length) console.log(`  样例: ${removed.slice(0, 8).join(", ")}`);
if (apply) {
  writeFileSync(file, kept.join("\n"));
  console.log("已写入");
}
