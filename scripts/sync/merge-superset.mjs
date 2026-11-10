#!/usr/bin/env node

// 方法级并集合并：解决「上游新增方法 + 我方保留签名/删除功能」混合型冲突。
//
// 典型形态（services/.../agentService.ts）：
//   <<<<<<< HEAD
//       async getTaskTokenUsage(params: RaspberryCodeAgentTaskTokenUsageParams) {
//   =======
//       async measureSessionData(params) { ...新增方法... },
//       async purgeSessionData({...}) { ... },
//       async getTaskTokenUsage(params: RaspberryCodeAgentTaskTokenUsageParams) {
//   >>>>>>>
//
// 解法：取上游整段（含新方法），然后把上游片段里的品牌标识符改回我方口径。
// 这样新方法被吸收，我方签名由品牌规范化自动恢复。
//
// 适用前提：冲突块内上游侧是「我方内容的超集」，即我方首行出现在上游侧中
// （按品牌规范化后比对）。不满足则该块跳过，留给人工。
//
// 用法：
//   node scripts/sync/merge-superset.mjs <file>            # 报告
//   node scripts/sync/merge-superset.mjs --apply <file>    # 写入

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("用法: node scripts/sync/merge-superset.mjs [--apply] <file>");
  process.exit(2);
}

const RULES = [
  [/\bzcode-cli\b/gu, "raspberrycode-cli"],
  [/\bzcode-server-cli\b/gu, "raspberrycode-server-cli"],
  [/\bzcode-cua\b/gu, "raspberrycode-cua"],
  [/\bzcode-protocol-v4\b/gu, "raspberrycode-protocol-v4"],
  [/\bzcode-protocol\b/gu, "raspberrycode-protocol"],
  [/\bzcode_([a-z0-9_]+)\b/gu, "raspberrycode_$1"],
  [/\bZCODE_([A-Z0-9_]+)\b/gu, "RASPBERRYCODE_$1"],
  [/\bzcode([A-Z][A-Za-z0-9]*)/gu, "raspberrycode$1"],
  [/\bZcode([A-Z][A-Za-z0-9]*)/gu, "Raspberrycode$1"],
  [/\buseZCode([A-Z][A-Za-z0-9]*)/gu, "useRaspberryCode$1"],
  [/\bZCode([A-Z][A-Za-z0-9]*)/gu, "RaspberryCode$1"],
  [/([a-z0-9])RaspberryCode([A-Z][A-Za-z0-9]*)/gu, "$1RaspberryCode$2"],
  [/\bZCode\b/gu, "RaspberryCode"],
  [/\bZ Code\b/gu, "RaspberryCode"],
  [/\bzcode(?![A-Za-z0-9])/gu, "raspberrycode"],
];

function norm(text) {
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}

const lines = readFileSync(file, "utf8").split("\n");
const isMarker = (l, ch) => l.replace(/\r$/u, "") === ch;

const out = [];
let i = 0;
let taken = 0;
let skipped = 0;
const skippedList = [];

while (i < lines.length) {
  if (!lines[i].startsWith("<<<<<<< ")) {
    out.push(lines[i]);
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
  i += 1;

  const oursKey = norm(ours.join("\n")).trim();
  const theirsNorm = norm(theirs.join("\n"));
  const theirsKey = theirsNorm.trim();

  // 超集判定：我方内容整体出现在上游侧（规范化后）
  if (oursKey !== "" && theirsKey.includes(oursKey)) {
    out.push(...theirsNorm.split("\n"));
    taken += 1;
  } else if (oursKey === "" && theirsKey !== "") {
    out.push(...theirsNorm.split("\n"));
    taken += 1;
  } else {
    // 无法判定为超集：保留我方，标记待人工
    out.push(...ours);
    skipped += 1;
    skippedList.push({ line: start + 1, oursHead: (ours.find((l) => l.trim()) ?? "").trim().slice(0, 90) });
  }
}

const result = out.join("\n");
console.log(`# ${file}`);
console.log(`超集块（取上游+品牌规范化）: ${taken}`);
console.log(`跳过（保留我方，待人工）: ${skipped}`);
if (skippedList.length) {
  console.log("\n[待人工块]");
  for (const s of skippedList) console.log(`  行${s.line}: ${s.oursHead}`);
}
console.log(`\n残留冲突标记: ${(result.match(/^<<<<<<< /gmu) ?? []).length}`);

if (apply) {
  writeFileSync(file, result);
  console.log("已写入");
}
