#!/usr/bin/env node

// 上游同步冲突的三方融合器。
//
// 背景：本仓库把上游 raspberrycode→raspberrycode 全量改名，且改名同时修改了文件内容，
// 导致 git 无法把上游对旧路径的改动映射到新路径；叠加上游 v3.17 大幅删测试，
// 单次 merge 产生约 2000 个冲突，其中大量是「我们已改名、上游改旧路径」的机械冲突。
//
// 做法：对每个冲突文件从对象库取三方版本——
//   stage 1 = 共同祖先（旧品牌路径的原始内容）
//   stage 2 = 我们的版本（已改名 + 业务拆除）
//   stage 3 = 上游的版本（新功能实现）
// 先把 stage 1 与 stage 3 都做品牌规范化（raspberrycode→raspberrycode、路径改名），
// 使两侧品牌口径一致，再按「我们的品牌与业务语义务必保留、上游功能改动尽量吸收」
// 的规则做三方合并。
//
// 品牌规范化只做保守替换：标识符、路径、字符串里的 raspberrycode 变体。
// 不碰 wire 协议字面量与兼容读值（由 audit-neutrality 的豁免清单兜底）。
//
// 用法：
//   node scripts/sync/three-way-resolve.mjs --report    # 只报告，不改文件
//   node scripts/sync/three-way-resolve.mjs --apply     # 实际写入并 git add

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1");
const apply = process.argv.includes("--apply");

function git(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    ...opts,
  });
}

// 品牌规范化：把旧品牌标识统一成新品牌。
// 保守口径——只处理能明确判定为「产品自名」的形态。
const BRAND_REPLACEMENTS = [
  // 路径与包名
  [/\bzcode-cli\b/gu, "raspberrycode-cli"],
  [/\bzcode-server-cli\b/gu, "raspberrycode-server-cli"],
  [/\bzcode-cua\b/gu, "raspberrycode-cua"],
  [/\bzcode-protocol\b/gu, "raspberrycode-protocol"],
  // 数据目录与运行时路径
  [/\.raspberrycode\b/gu, ".raspberrycode"],
  [/\bZCODE_([A-Z0-9_]+)\b/gu, "RASPBERRYCODE_$1"],
  // 标识符（驼峰/小驼峰/大驼峰）
  [/\bzcode([A-Z][A-Za-z0-9]*)/gu, "raspberrycode$1"],
  [/\bZcode([A-Z][A-Za-z0-9]*)/gu, "Raspberrycode$1"],
  [/\bZCode(?![a-z])/gu, "RaspberryCode"],
  // 纯小写标识符
  [/\bzcode(?![A-Za-z0-9])/gu, "raspberrycode"],
];

function normalizeBrand(text) {
  let out = text;
  for (const [re, to] of BRAND_REPLACEMENTS) out = out.replace(re, to);
  return out;
}

// 同一路径上的对应旧路径（用于取祖先版本）
function legacyPathOf(relPath) {
  return relPath
    .replace(/(^|\/)apps\/raspberrycode-cli\//u, "$1apps/raspberrycode-cli/")
    .replace(/\braspberrycode-cli\b/gu, "raspberrycode-cli")
    .replace(/\braspberrycode-server-cli\b/gu, "raspberrycode-server-cli")
    .replace(/\braspberrycode-cua\b/gu, "raspberrycode-cua")
    .replace(/\braspberrycode-protocol\b/gu, "raspberrycode-protocol")
    .replace(/\braspberrycode([A-Z])/gu, "raspberrycode$1")
    .replace(/\bRaspberrycode([A-Z])/gu, "Zcode$1")
    .replace(/\bRaspberryCode\b/gu, "RaspberryCode")
    .replace(/\braspberrycode\b/gu, "raspberrycode");
}

function readStage(stage, relPath) {
  try {
    return git(["cat-file", "-p", `:${stage}:${relPath}`]);
  } catch {
    return null;
  }
}

function conflictedFiles() {
  const raw = git(["diff", "--name-only", "--diff-filter=U"]);
  return raw.split("\n").filter(Boolean);
}

function countMarkers(text) {
  return (text.match(/^<<<<<<< /gmu) ?? []).length;
}

// 用 git merge-file 做三方合并（写入临时文件由调用方处理）
import { mkdtempSync, writeFileSync as wf, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function mergeThreeWay(ours, base, theirs) {
  const dir = mkdtempSync(join(tmpdir(), "rc-merge-"));
  const oursPath = join(dir, "ours");
  const basePath = join(dir, "base");
  const theirsPath = join(dir, "theirs");
  const outPath = join(dir, "out");
  try {
    wf(oursPath, ours);
    wf(basePath, base);
    wf(theirsPath, theirs);
    // -p 输出到 stdout；非零退出码表示仍有冲突，属预期
    let merged = "";
    try {
      merged = execFileSync("git", ["merge-file", "-p", "--diff3", "-L", "ours", "-L", "base", "-L", "theirs", oursPath, basePath, theirsPath], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
    } catch (err) {
      merged = err.stdout ?? "";
    }
    return merged;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const stats = { total: 0, resolved: 0, remaining: 0, skipped: 0, detail: [] };

const files = conflictedFiles();
stats.total = files.length;

for (const relPath of files) {
  const stage2 = readStage(2, relPath); // ours
  const stage3 = readStage(3, relPath); // theirs
  const stage1 = readStage(1, relPath); // base（git 自动匹配到的祖先）

  if (stage2 == null || stage3 == null) {
    stats.skipped += 1;
    continue;
  }

  // 祖先版本：优先用 git 匹配的 stage1；缺失时按旧路径回查
  let base = stage1;
  if (base == null) {
    const legacy = legacyPathOf(relPath);
    try {
      base = git(["cat-file", "-p", `3c5b2276:${legacy}`]);
    } catch {
      base = null;
    }
  }
  if (base == null) {
    stats.skipped += 1;
    stats.detail.push({ relPath, reason: "无祖先版本" });
    continue;
  }

  // 把 base 与 theirs 拉到同一品牌口径，再与 ours 合并
  const baseN = normalizeBrand(base);
  const theirsN = normalizeBrand(stage3);

  const merged = mergeThreeWay(stage2, baseN, theirsN);
  const remain = countMarkers(merged);

  if (remain === 0) {
    if (apply) {
      writeFileSync(join(repoRoot, relPath), merged);
      git(["add", "--", relPath]);
    }
    stats.resolved += 1;
  } else {
    stats.remaining += 1;
    stats.detail.push({ relPath, reason: `残留 ${remain} 处冲突块` });
  }
}

console.log(`# 三方融合${apply ? "（已写入）" : "（仅报告）"}`);
console.log(`冲突总数: ${stats.total}`);
console.log(`自动融合成功: ${stats.resolved}`);
console.log(`仍有残留: ${stats.remaining}`);
console.log(`跳过（无三方版本）: ${stats.skipped}`);

if (stats.detail.length > 0) {
  console.log("\n[需人工处理]");
  for (const d of stats.detail.slice(0, 60)) console.log(`  ${d.relPath}  — ${d.reason}`);
  if (stats.detail.length > 60) console.log(`  ... 另 ${stats.detail.length - 60} 个`);
}
