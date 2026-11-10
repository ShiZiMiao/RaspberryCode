#!/usr/bin/env node

// i18n 词表专用合并器。
//
// 背景：上游同步时，i18n 词表的冲突几乎全部是「同一个位置各插了一批 key」，
// 而不是同 key 不同译文。直接用通用三方合并会把两边当成互斥内容二选一，丢词条。
//
// 规则：
//   1. 块内按 key 取并集——上游新增的 key 全部吸收
//   2. key 重复时保留我们的译文（品牌与措辞以本仓库为准）
//   3. 保留上游的 key 顺序作为骨架，我们的独有 key 追加在后
//   4. 裸内容（无 key 的行，如注释/大括号）保持原顺序拼接
//
// 用法：
//   node scripts/sync/merge-i18n.mjs <file> [--apply]

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const file = process.argv[2];
const apply = process.argv.includes("--apply");
if (!file) {
  console.error("用法: node scripts/sync/merge-i18n.mjs <file> [--apply]");
  process.exit(2);
}

const KEY_RE = /^\s*"([^"]+)"\s*:/u;

const text = readFileSync(file, "utf8");
const lines = text.split("\n");

function isMarker(l, ch) {
  return l.replace(/\r$/u, "") === ch;
}

// 把一个块拆成「带 key 的条目」与「裸行」，保持原始顺序
// 多行 value 续行归属于前一个条目
function toEntries(blockLines) {
  const entries = [];
  const bare = [];
  let cur = null;
  for (const l of blockLines) {
    const m = l.match(KEY_RE);
    if (m) {
      cur = { key: m[1], lines: [l] };
      entries.push(cur);
    } else if (cur && /^\s+/.test(l) && l.trim() !== "") {
      // 续行
      cur.lines.push(l);
    } else if (cur && /^\s*\}/.test(l)) {
      cur.lines.push(l);
      cur = null;
    } else {
      cur = null;
      bare.push(l);
    }
  }
  return { entries, bare };
}

const out = [];
let i = 0;
let blocks = 0;
let added = 0;
let kept = 0;

while (i < lines.length) {
  if (!lines[i].startsWith("<<<<<<< ")) {
    out.push(lines[i]);
    i += 1;
    continue;
  }

  // 收集三方
  const oursL = [];
  const theirsL = [];
  let sec = "ours";
  i += 1;
  while (i < lines.length && !lines[i].startsWith(">>>>>>> ")) {
    const l = lines[i];
    if (l.startsWith("||||||| ") && sec === "ours") {
      sec = "base";
      i += 1;
      continue;
    }
    if (isMarker(l, "=======") && sec !== "theirs") {
      sec = "theirs";
      i += 1;
      continue;
    }
    if (sec === "ours") oursL.push(l);
    else if (sec === "theirs") theirsL.push(l);
    i += 1;
  }
  i += 1; // 跳过 >>>>>>>

  blocks += 1;
  const ours = toEntries(oursL);
  const theirs = toEntries(theirsL);

  const oursMap = new Map(ours.entries.map((e) => [e.key, e]));
  const theirsKeys = new Set(theirs.entries.map((e) => e.key));

  // 骨架以上游顺序为准；上游没有的我们的 key 追加在后面
  const merged = [];
  for (const e of theirs.entries) {
    if (oursMap.has(e.key)) {
      // key 重复：保留我们的译文（品牌与措辞以本仓库为准）
      merged.push(...oursMap.get(e.key).lines);
      kept += 1;
    } else {
      merged.push(...e.lines);
      added += 1;
    }
  }
  for (const e of ours.entries) {
    if (!theirsKeys.has(e.key)) merged.push(...e.lines);
  }

  // 裸行取并集（去重后拼接）
  const bareSeen = new Set();
  const bareOut = [];
  for (const l of [...theirs.bare, ...ours.bare]) {
    const k = l.trim();
    if (k === "") continue;
    if (bareSeen.has(k)) continue;
    bareSeen.add(k);
    bareOut.push(l);
  }

  out.push(...merged, ...bareOut);
}

const result = out.join("\n");

if (apply) {
  writeFileSync(file, result);
  console.log(`${file}: 处理 ${blocks} 块，吸收上游新 key ${added} 个，保留我方译文 ${kept} 个`);
} else {
  console.log(`${file}: 预计处理 ${blocks} 块，吸收上游新 key ${added} 个，保留我方译文 ${kept} 个（未写入）`);
  console.log(`残留冲突标记: ${(result.match(/^<<<<<<< /gmu) ?? []).length}`);
}
