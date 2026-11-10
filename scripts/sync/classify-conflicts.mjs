#!/usr/bin/env node

// 冲突块分类器：把三方融合后仍残留的冲突块拆成三类，缩小人工判断范围。
//
//   UPSTREAM_ONLY  我们这侧为空、上游有内容 → 上游新增，直接采用上游
//   OURS_ONLY      上游为空、我们这侧有内容 → 我们新增，直接保留我们
//   BOTH           两侧都有内容 → 语义冲突，需逐块判断
//
// 用法：
//   node scripts/sync/classify-conflicts.mjs            # 汇总统计
//   node scripts/sync/classify-conflicts.mjs --detail   # 列出 BOTH 块摘要
//   node scripts/sync/classify-conflicts.mjs --apply-simple  # 自动解决 UPSTREAM_ONLY / OURS_ONLY

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1");

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
}

const detail = process.argv.includes("--detail");
const applySimple = process.argv.includes("--apply-simple");

function conflictedFiles() {
  return git(["diff", "--name-only", "--diff-filter=U"]).split("\n").filter(Boolean);
}

// 解析出所有冲突块，返回 { blocks, lines }
function parseBlocks(text) {
  const lines = text.split("\n");
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
    const baseLines = [];
    let section = "ours"; // ours | base | theirs
    // 工作区在 Windows 上是 CRLF，冲突标记需容忍行尾 \r
    const isMarker = (l, ch) => l.replace(/\r$/u, "") === ch;
    i += 1;
    while (i < lines.length && !lines[i].startsWith(">>>>>>> ")) {
      const l = lines[i];
      if (l.startsWith("||||||| ") && section === "ours") {
        section = "base";
        i += 1;
        continue;
      }
      if (isMarker(l, "=======") && section !== "theirs") {
        section = "theirs";
        i += 1;
        continue;
      }
      if (section === "ours") ours.push(l);
      else if (section === "base") baseLines.push(l);
      else theirs.push(l);
      i += 1;
    }
    blocks.push({ start, end: i, ours, theirs, base: baseLines });
    i += 1;
  }
  return blocks;
}

const stats = { files: 0, upstreamOnly: 0, oursOnly: 0, both: 0, cleaned: 0 };
const bothDetail = [];

for (const relPath of conflictedFiles()) {
  stats.files += 1;
  const abs = `${repoRoot}/${relPath}`;
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    continue;
  }
  const blocks = parseBlocks(text);
  if (blocks.length === 0) continue;

  let changed = false;
  // 从后往前替换，避免行号漂移
  for (const b of [...blocks].reverse()) {
    const oursEmpty = b.ours.every((l) => l.trim() === "");
    const theirsEmpty = b.theirs.every((l) => l.trim() === "");
    // 纯空白差异不算语义冲突：两侧都空则整块删除
    if (oursEmpty && theirsEmpty) {
      if (applySimple) {
        const lines = text.split("\n");
        lines.splice(b.start, b.end - b.start + 1);
        text = lines.join("\n");
        changed = true;
      }
    } else if (oursEmpty && !theirsEmpty) {
      stats.upstreamOnly += 1;
      if (applySimple) {
        const lines = text.split("\n");
        lines.splice(b.start, b.end - b.start + 1, ...b.theirs);
        text = lines.join("\n");
        changed = true;
      }
    } else if (theirsEmpty && !oursEmpty) {
      stats.oursOnly += 1;
      if (applySimple) {
        const lines = text.split("\n");
        lines.splice(b.start, b.end - b.start + 1, ...b.ours);
        text = lines.join("\n");
        changed = true;
      }
    } else {
      stats.both += 1;
      bothDetail.push({
        relPath,
        line: b.start + 1,
        ours: b.ours.slice(0, 2).join(" / ").slice(0, 110),
        theirs: b.theirs.slice(0, 2).join(" / ").slice(0, 110),
      });
    }
  }

  if (applySimple && changed) {
    writeFileSync(abs, text);
    stats.cleaned += 1;
  }
}

console.log(`# 冲突块分类${applySimple ? "（已自动解决单侧块）" : ""}`);
console.log(`涉及文件: ${stats.files}`);
console.log(`上游单侧新增(UPSTREAM_ONLY): ${stats.upstreamOnly}`);
console.log(`我们单侧新增(OURS_ONLY): ${stats.oursOnly}`);
console.log(`两侧都有内容(BOTH): ${stats.both}`);
if (applySimple) console.log(`已重写文件: ${stats.cleaned}`);

if (detail) {
  console.log("\n[BOTH 明细]");
  for (const d of bothDetail.slice(0, 80)) {
    console.log(`\n${d.relPath}:${d.line}`);
    console.log(`  OURS:   ${d.ours}`);
    console.log(`  THEIRS: ${d.theirs}`);
  }
  if (bothDetail.length > 80) console.log(`\n... 另 ${bothDetail.length - 80} 块`);
}
