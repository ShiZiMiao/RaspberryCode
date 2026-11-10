#!/usr/bin/env node

// 大文件冲突块逐块诊断：为每个冲突块判断归属，输出决策建议。
//
// 判断口径：
//   IMPORT_MERGE  两侧都是 import 语句 → 合并（品牌取我方，吸收上游新增符号）
//   THEIRS_ONLY   我方为空 → 直接取上游
//   OURS_ONLY     上游为空 → 直接取我方
//   BOTH_<特征>   两侧有实质内容 → 标记待人工，并给出特征
//
// 用法：
//   node scripts/sync/diagnose-conflicts.mjs <file>

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("用法: node scripts/sync/diagnose-conflicts.mjs <file>");
  process.exit(2);
}

const lines = readFileSync(file, "utf8").split("\n");
const isMarker = (l, ch) => l.replace(/\r$/u, "") === ch;

const blocks = [];
let i = 0;
while (i < lines.length) {
  if (!lines[i].startsWith("<<<<<<< ")) {
    i += 1;
    continue;
  }
  const start = i;
  const ours = [];
  const theirs = [];
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
    if (sec === "ours") ours.push(l);
    else if (sec === "theirs") theirs.push(l);
    i += 1;
  }
  blocks.push({ start, end: i, ours, theirs });
  i += 1;
}

const isImportLine = (l) =>
  /^\s*import\b/u.test(l) || /^\s*\} from "/u.test(l) || /^\s*type [A-Za-z]/u.test(l) || /^\s*[A-Za-z_]+,$/u.test(l) || l.trim() === "" || l.trim() === "{" || l.trim() === "}";

// 关键符号：判断侧内容引用的模块是否涉及已拆除功能
const RETIRED = /webRemoteControl|web-remote-relay|conversationShare|CodingPlan|codingPlan|offPeak|off-peak|highspeed|marketingTouch|accountRequestRetry|RuntimeHeadersRefresh|zaiBusiness|zhipuAccount/i;

console.log(`# ${file}`);
console.log(`冲突块总数: ${blocks.length}\n`);

const summary = { importMerge: 0, oursOnly: 0, theirsOnly: 0, both: 0 };

for (const [idx, b] of blocks.entries()) {
  const n = idx + 1;
  const oursNonEmpty = b.ours.some((l) => l.trim() !== "");
  const theirsNonEmpty = b.theirs.some((l) => l.trim() !== "");
  const oursAllImport = b.ours.every((l) => isImportLine(l) || l.trim() === "");
  const theirsAllImport = b.theirs.every((l) => isImportLine(l) || l.trim() === "");

  let kind;
  if (!oursNonEmpty && theirsNonEmpty) kind = "THEIRS_ONLY";
  else if (oursNonEmpty && !theirsNonEmpty) kind = "OURS_ONLY";
  else if (oursAllImport && theirsAllImport) kind = "IMPORT_MERGE";
  else kind = "BOTH";

  if (kind === "IMPORT_MERGE") summary.importMerge += 1;
  else if (kind === "OURS_ONLY") summary.oursOnly += 1;
  else if (kind === "THEIRS_ONLY") summary.theirsOnly += 1;
  else summary.both += 1;

  const oursRetired = b.ours.filter((l) => RETIRED.test(l)).length;
  const theirsRetired = b.theirs.filter((l) => RETIRED.test(l)).length;

  console.log(`块${n} [${kind}] 行${b.start + 1}-${b.end + 1} ours=${b.ours.length}行 theirs=${b.theirs.length}行`);
  if (oursRetired || theirsRetired) {
    console.log(`  已拆功能引用: ours=${oursRetired} theirs=${theirsRetired}`);
  }
  if (kind === "BOTH") {
    console.log(`  OURS 首行: ${(b.ours.find((l) => l.trim()) ?? "").trim().slice(0, 100)}`);
    console.log(`  THEIRS 首行: ${(b.theirs.find((l) => l.trim()) ?? "").trim().slice(0, 100)}`);
  }
  console.log("");
}

console.log("=== 汇总 ===");
console.log(`IMPORT_MERGE: ${summary.importMerge}`);
console.log(`OURS_ONLY: ${summary.oursOnly}`);
console.log(`THEIRS_ONLY: ${summary.theirsOnly}`);
console.log(`BOTH: ${summary.both}`);
