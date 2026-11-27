#!/usr/bin/env node

// 上游 v4.0.0 同步冲突解析器。
//
// 背景：本仓库把上游 zcode→raspberrycode 全量改名（文件名与内容一起改），
// git 无法把上游对旧路径的改动映射到新路径；同时本仓库拆除了登录/OAuth/JWT、
// 订阅购买、Rewards/营销、闲时任务/加速卡、分享/手机远控、旧 autoUpdater 等业务。
//
// 本脚本按类别处理 merge 冲突：
//   1. 已拆业务：保持删除（或保留我方版本）
//   2. 旧路径新增文件（file location）：迁入新路径并做品牌规范化
//   3. 内容冲突：三方融合（base/theirs 先品牌规范化）
//   4. 上游移动的测试：合并回我方旧路径，避免重复
//   5. modify/delete：我方删除的保持删除；上游删除的我方保留
//   6. rename/delete：我方改名的保留；上游移动而我方删除的保持删除
//
// 用法：
//   node scripts/sync/resolve-v4.mjs --report
//   node scripts/sync/resolve-v4.mjs --apply [--suggestions <json>]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1");
const apply = process.argv.includes("--apply");
const suggestionsArg = process.argv.indexOf("--suggestions");
const suggestionsPath = suggestionsArg >= 0 ? process.argv[suggestionsArg + 1] : null;
const suggestions = suggestionsPath && existsSync(suggestionsPath)
  ? JSON.parse(readFileSync(suggestionsPath, "utf8"))
  : {};

function git(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    ...opts,
  });
}

function gitOrNull(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

// ---------- 品牌规范化 ----------
// 保守口径：只处理能明确判定为「产品自名」的形态；wire 协议事实与兼容读值不改。
const PROTECTED_LINE =
  /raspberrycode\.error\.|X-Bigmodel|Bigmodel-Organization|X-Zcode-Plan|\.__zcode\/|OFF_PEAK_SCHEMA|offPeakTaskId|provisioning-v1/iu;

const BRAND_RULES = [
  [/@zcode-dev\//gu, "@raspberrycode-dev/"],
  [/@zcode\//gu, "@raspberrycode/"],
  [/\bzcode-cli\b/gu, "raspberrycode-cli"],
  [/\bzcode-server-cli\b/gu, "raspberrycode-server-cli"],
  [/\bzcode-cua\b/gu, "raspberrycode-cua"],
  [/\bzcode-protocol-v4\b/gu, "raspberrycode-protocol-v4"],
  [/\bzcode-protocol\b/gu, "raspberrycode-protocol"],
  [/\bzcode-site-plugin\b/gu, "raspberrycode-site-plugin"],
  [/\bzcode-agent\b/gu, "raspberrycode-agent"],
  [/\bzcode-session\b/gu, "raspberrycode-session"],
  [/\bzcode_([a-z0-9_]+)\b/gu, "raspberrycode_$1"],
  [/\.raspberrycode\b/gu, ".raspberrycode"],
  [/\bZCODE_([A-Z0-9_]+)\b/gu, "RASPBERRYCODE_$1"],
  [/\bZCODE\b/gu, "RASPBERRYCODE"],
  [/\bZ-Code\b/gu, "RaspberryCode"],
  [/\bZ_Code\b/gu, "RaspberryCode"],
  [/\bZ Code\b/gu, "RaspberryCode"],
  [/\bz-code\b/gu, "raspberrycode"],
  [/\bz_code\b/gu, "raspberrycode"],
  [/\bz code\b/gu, "raspberrycode"],
  [/\bzcode([A-Z][A-Za-z0-9]*)/gu, "raspberrycode$1"],
  [/\bZcode([A-Z][A-Za-z0-9]*)/gu, "Raspberrycode$1"],
  [/\buseZCode([A-Z][A-Za-z0-9]*)/gu, "useRaspberryCode$1"],
  [/\bZCode([A-Z][A-Za-z0-9]*)/gu, "RaspberryCode$1"],
  [/\bZCode([a-z][A-Za-z0-9]*)/gu, "RaspberryCode$1"],
  [/([a-z0-9])ZCode([A-Za-z0-9]*)/gu, "$1RaspberryCode$2"],
  [/([a-z0-9])ZCODE([A-Za-z0-9]*)/gu, "$1RASPBERRYCODE$2"],
  [/([a-z0-9])RaspberryCode([A-Z][A-Za-z0-9]*)/gu, "$1RaspberryCode$2"],
  [/\bZCode\b/gu, "RaspberryCode"],
  [/\bZ Code\b/gu, "RaspberryCode"],
  [/\bzcode(?![A-Za-z0-9])/gu, "raspberrycode"],
  [/(__)raspberrycode([A-Z][A-Za-z0-9]*)/gu, "$1raspberrycode$2"],
  [/([a-z0-9])raspberrycode([A-Z][A-Za-z0-9]*)/gu, "$1raspberrycode$2"],
  [/\bzcode([a-z][A-Za-z0-9]*)/gu, "raspberrycode$1"],
];

function normalizeBrand(text) {
  return text
    .split("\n")
    .map((line) => {
      if (PROTECTED_LINE.test(line)) return line;
      let next = line;
      for (const [re, to] of BRAND_RULES) next = next.replace(re, to);
      return next;
    })
    .join("\n");
}

// ---------- 路径映射 ----------
function ruleMap(p) {
  return p
    .replace(/^apps\/zcode-cli\//, "apps/raspberrycode-cli/")
    .replace(/^packages\/zcode-cua\//, "packages/raspberrycode-cua/")
    .replace(/^packages\/zcode-server-cli\//, "packages/raspberrycode-server-cli/")
    .replace(/\/zcode-protocol-v4\//g, "/raspberrycode-protocol-v4/")
    .replace(/\/zcode-protocol\//g, "/raspberrycode-protocol/")
    .replace(/\/zcode-site-plugin\//g, "/raspberrycode-site-plugin/")
    .replace(/\/zcode-agent\//g, "/raspberrycode-agent/")
    .replace(/\/zcode-session\//g, "/raspberrycode-session/")
    .replace(/\bzcode-cli\b/g, "raspberrycode-cli")
    .replace(/\bzcode-server-cli\b/g, "raspberrycode-server-cli")
    .replace(/\bzcode-cua\b/g, "raspberrycode-cua")
    .replace(/\bzcode-protocol-v4\b/g, "raspberrycode-protocol-v4")
    .replace(/\bzcode-protocol\b/g, "raspberrycode-protocol")
    .replace(/\bzcode-site-plugin\b/g, "raspberrycode-site-plugin")
    .replace(/\bzcode-agent\b/g, "raspberrycode-agent")
    .replace(/\bzcode-session\b/g, "raspberrycode-session")
    .replace(/\bzcodeignore\b/g, "raspberrycodeignore")
    .replace(/\bzcode([A-Z])/g, "raspberrycode$1")
    .replace(/\bZcode([A-Z])/g, "Raspberrycode$1")
    .replace(/\bZCode([A-Z])/g, "RaspberryCode$1")
    .replace(/\bZCode\b/g, "RaspberryCode")
    .replace(/\bzcode\b/g, "raspberrycode");
}

// ---------- 已拆业务 ----------
// 只列真正拆除的业务；zcode-agent / zcode-session 是改名模块，不在此列。
const REMOVED_PATTERNS = [
  /^packages\/web\//,
  /^packages\/web-share\//,
  /^packages\/share-ui\//,
  /^packages\/android\//,
  /^packages\/desktop\/src\/main\/web-remote-relay\//,
  /^packages\/shared\/src\/web-remote-relay\//,
  /^packages\/client\/src\/webRemoteControl/,
  /^packages\/services\/src\/window-project-directory\/webRemoteProjectTreeActivity/,
  /^packages\/ui\/src\/assets\/highspeed\//,
  /^packages\/ui\/src\/lib\/oauthProviderIcon/,
  /^packages\/ui\/src\/lib\/zcodeProviders/,
  /^packages\/ui\/src\/lib\/rendererZCodeEndpoint/,
  /^packages\/shared\/src\/zcodeEndpoint/,
  /^packages\/server\/src\/bundledZCodeBuiltinProviderConfig/,
  /^packages\/desktop\/src\/main\/autoUpdater\.ts$/,
  /^packages\/desktop\/src\/main\/forceUpdateGuard\.ts$/,
  /^packages\/desktop\/src\/main\/manifestUpdateProvider\.ts$/,
  /^packages\/desktop\/scripts\/auto-update-install-reentry-smoke\.mjs$/,
  /^packages\/desktop\/src\/main\/mcpUserDirectory\/legacy\.ts$/,
  /^packages\/ui\/src\/store\/mcpStoreMigration\.ts$/,
  /^scripts\/download-glm/,
  /^scripts\/architecture\/upstream-/,
  /^apps\/zcode-cli\/packages\/restore-legacy-sessions-plugin\//,
  /^docs\/rewards-embedded\.md$/,
  /^docs\/web-share\//,
  /^docs\/oauth\//,
  /^docs\/coding-plan\//,
  /^docs\/off-peak-task\//,
  /^docs\/web-remote-control\//,
  /^docs\/marketing/,
  // E2E：登录/OAuth/JWT、订阅、营销、闲时、加速卡、分享、手机远控
  /^packages\/desktop\/test\/e2e\/(?:[^/]+\/)*(?:oauth|jwt|access-token-401|auth-config)(?:[/._-]|$)/i,
  /^packages\/desktop\/test\/e2e\/(?:[^/]+\/)*(?:off-peak|offpeak)(?:[/._-]|$)/i,
  /^packages\/desktop\/test\/e2e\/(?:[^/]+\/)*(?:coding-plan)(?:[/._-]|$)/i,
  /^packages\/desktop\/test\/e2e\/(?:[^/]+\/)*(?:marketing|reward)(?:[/._-]|$)/i,
  /^packages\/desktop\/test\/e2e\/(?:[^/]+\/)*(?:highspeed)(?:[/._-]|$)/i,
  /^packages\/desktop\/test\/e2e\/(?:[^/]+\/)*(?:share|sharing|web-share|share-ui)(?:[/._-]|$)/i,
  /^packages\/desktop\/test\/e2e\/(?:[^/]+\/)*(?:web-remote|mobile-push|mobilePush)(?:[/._-]|$)/i,
  /^packages\/desktop\/test\/e2e\/fixtures\/(?:[^/]+\/)*(?:oauth|jwt|access-token-401|auth-config)(?:[/._-]|$)/i,
  /^packages\/desktop\/test\/e2e\/fixtures\/(?:[^/]+\/)*(?:off-peak|offpeak)(?:[/._-]|$)/i,
  /^packages\/desktop\/test\/e2e\/fixtures\/(?:[^/]+\/)*(?:coding-plan)(?:[/._-]|$)/i,
  /^packages\/desktop\/test\/e2e\/fixtures\/(?:[^/]+\/)*(?:marketing|reward)(?:[/._-]|$)/i,
  /^packages\/desktop\/test\/e2e\/fixtures\/(?:[^/]+\/)*(?:highspeed)(?:[/._-]|$)/i,
  /^packages\/desktop\/test\/e2e\/fixtures\/(?:[^/]+\/)*(?:share|sharing|web-share|share-ui)(?:[/._-]|$)/i,
  /^packages\/desktop\/test\/e2e\/fixtures\/(?:[^/]+\/)*(?:web-remote|mobile-push|mobilePush)(?:[/._-]|$)/i,
];

function isRemoved(p) {
  return REMOVED_PATTERNS.some((re) => re.test(p));
}

// ---------- 文件集合 ----------
const headFiles = new Set(git(["ls-tree", "-r", "--name-only", "HEAD"]).split(/\r?\n/).filter(Boolean));
const upstreamFiles = new Set(git(["ls-tree", "-r", "--name-only", "upstream/main"]).split(/\r?\n/).filter(Boolean));
const baseFiles = new Set(git(["ls-tree", "-r", "--name-only", "a9fe401e"]).split(/\r?\n/).filter(Boolean));

// 上游 rename 映射（旧路径 → 新路径），用于把上游移动的测试合并回我方旧路径
const upstreamRename = new Map();
for (const line of git(["diff", "--name-status", "a9fe401e..a4b44451"]).split(/\r?\n/)) {
  const parts = line.split("\t");
  if (parts[0]?.startsWith("R") && parts.length >= 3) upstreamRename.set(parts[1], parts[2]);
}
const upstreamRenameReverse = new Map();
for (const [oldPath, newPath] of upstreamRename) upstreamRenameReverse.set(newPath, oldPath);

// ---------- 冲突读取 ----------
function conflictedFiles() {
  return git(["diff", "--name-only", "--diff-filter=U"]).split(/\r?\n/).filter(Boolean);
}

function stagesOf(relPath) {
  const raw = gitOrNull(["ls-files", "-u", "--", relPath]);
  if (!raw) return {};
  const stages = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\d+ ([0-9a-f]+) ([123])\t(.+)$/u);
    if (m) stages[Number(m[2])] = m[1];
  }
  return stages;
}

function readStage(stage, relPath) {
  return gitOrNull(["show", `:${stage}:${relPath}`]);
}

function readHead(relPath) {
  return gitOrNull(["show", `HEAD:${relPath}`]);
}

function readUpstream(relPath) {
  return gitOrNull(["show", `upstream/main:${relPath}`]);
}

function readBase(relPath) {
  return gitOrNull(["show", `a9fe401e:${relPath}`]);
}

// ---------- 三方合并 ----------
function mergeThreeWay(ours, base, theirs) {
  const dir = mkdtempSync(join(tmpdir(), "rc-v4-merge-"));
  const oursPath = join(dir, "ours");
  const basePath = join(dir, "base");
  const theirsPath = join(dir, "theirs");
  try {
    writeFileSync(oursPath, ours);
    writeFileSync(basePath, base);
    writeFileSync(theirsPath, theirs);
    let merged = "";
    try {
      merged = execFileSync(
        "git",
        ["merge-file", "-p", "--diff3", "-L", "ours", "-L", "base", "-L", "theirs", oursPath, basePath, theirsPath],
        { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 },
      );
    } catch (err) {
      merged = err.stdout ?? "";
    }
    return merged;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function countMarkers(text) {
  return (text.match(/^<<<<<<< /gmu) ?? []).length;
}

// ---------- 写盘 ----------
function writeAndAdd(relPath, content) {
  const abs = join(repoRoot, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  // 冲突文件可能命中 .gitignore（如 dist-types），但它们是已跟踪文件，必须强制加入。
  git(["add", "-f", "--", relPath]);
}

function removeFromIndexAndWorktree(relPath) {
  gitOrNull(["rm", "-f", "--cached", "--", relPath]);
  const abs = join(repoRoot, relPath);
  if (existsSync(abs)) rmSync(abs, { force: true });
}

function keepOurs(relPath) {
  gitOrNull(["checkout", "--ours", "--", relPath]);
  git(["add", "-f", "--", relPath]);
}

function keepDeleted(relPath) {
  removeFromIndexAndWorktree(relPath);
}

// ---------- 主流程 ----------
const stats = {
  total: 0,
  removedKeptDeleted: 0,
  removedKeptOurs: 0,
  fileLocationAdded: 0,
  fileLocationMerged: 0,
  contentMerged: 0,
  contentMergedIntoOldPath: 0,
  modifyDeleteKeptDeleted: 0,
  modifyDeleteKeptOurs: 0,
  modifyDeleteMergedIntoMapped: 0,
  renameDeleteKeptOurs: 0,
  renameDeleteKeptDeleted: 0,
  addAddMerged: 0,
  manual: 0,
};
const manual = [];
const removedPaths = [];

const files = conflictedFiles();
stats.total = files.length;

for (const relPath of files) {
  const stages = stagesOf(relPath);
  const hasOurs = stages[2] != null;
  const hasTheirs = stages[3] != null;
  const hasBase = stages[1] != null;
  const mapped = suggestions[relPath] ?? ruleMap(relPath);
  const removed = isRemoved(relPath) || isRemoved(mapped);

  // 1. 已拆业务
  if (removed) {
    removedPaths.push(relPath);
    if (hasOurs) {
      stats.removedKeptOurs += 1;
      if (apply) keepOurs(relPath);
    } else {
      stats.removedKeptDeleted += 1;
      if (apply) keepDeleted(relPath);
    }
    continue;
  }

  // 2. 上游新增文件落在旧路径（file location）
  if (!hasOurs && hasTheirs && !headFiles.has(relPath)) {
    const target = mapped;
    if (target !== relPath && headFiles.has(target)) {
      // 目标路径已存在：把上游内容三方融合进目标路径
      const base = (hasBase ? readStage(1, relPath) : null) ?? readBase(relPath) ?? "";
      const ours = readHead(target) ?? "";
      const theirs = normalizeBrand(readStage(3, relPath) ?? "");
      const merged = mergeThreeWay(ours, normalizeBrand(base), theirs);
      stats.fileLocationMerged += 1;
      if (apply) {
        writeAndAdd(target, merged);
        removeFromIndexAndWorktree(relPath);
      }
      if (countMarkers(merged) > 0) manual.push({ path: target, reason: `file-location 融合残留 ${countMarkers(merged)} 块` });
    } else {
      const theirs = normalizeBrand(readStage(3, relPath) ?? "");
      stats.fileLocationAdded += 1;
      if (apply) {
        writeAndAdd(target, theirs);
        if (target !== relPath) removeFromIndexAndWorktree(relPath);
      }
    }
    continue;
  }

  // 3. 内容冲突
  if (hasOurs && hasTheirs) {
    // 上游移动的测试：合并回我方旧路径，避免重复
    const oldPath = upstreamRenameReverse.get(relPath);
    if (oldPath && oldPath !== relPath && headFiles.has(oldPath) && relPath.startsWith("packages/desktop/test/")) {
      const base = (hasBase ? readStage(1, relPath) : null) ?? readBase(oldPath) ?? "";
      const ours = readHead(oldPath) ?? "";
      const theirs = normalizeBrand(readStage(3, relPath) ?? "");
      const merged = mergeThreeWay(ours, normalizeBrand(base), theirs);
      stats.contentMergedIntoOldPath += 1;
      if (apply) {
        writeAndAdd(oldPath, merged);
        removeFromIndexAndWorktree(relPath);
      }
      if (countMarkers(merged) > 0) manual.push({ path: oldPath, reason: `测试移动融合残留 ${countMarkers(merged)} 块` });
      continue;
    }

    const base = (hasBase ? readStage(1, relPath) : null) ?? "";
    const ours = readStage(2, relPath) ?? "";
    const theirs = normalizeBrand(readStage(3, relPath) ?? "");
    const merged = mergeThreeWay(ours, normalizeBrand(base), theirs);
    stats.contentMerged += 1;
    if (apply) writeAndAdd(relPath, merged);
    if (countMarkers(merged) > 0) manual.push({ path: relPath, reason: `内容融合残留 ${countMarkers(merged)} 块` });
    continue;
  }

  // 4. modify/delete：我方删除、上游修改
  if (!hasOurs && hasTheirs) {
    if (headFiles.has(mapped) && mapped !== relPath) {
      const base = (hasBase ? readStage(1, relPath) : null) ?? readBase(relPath) ?? "";
      const ours = readHead(mapped) ?? "";
      const theirs = normalizeBrand(readStage(3, relPath) ?? "");
      const merged = mergeThreeWay(ours, normalizeBrand(base), theirs);
      stats.modifyDeleteMergedIntoMapped += 1;
      if (apply) {
        writeAndAdd(mapped, merged);
        removeFromIndexAndWorktree(relPath);
      }
      if (countMarkers(merged) > 0) manual.push({ path: mapped, reason: `改名映射融合残留 ${countMarkers(merged)} 块` });
    } else {
      stats.modifyDeleteKeptDeleted += 1;
      if (apply) keepDeleted(relPath);
    }
    continue;
  }

  // 5. modify/delete：上游删除、我方修改
  if (hasOurs && !hasTheirs) {
    stats.modifyDeleteKeptOurs += 1;
    if (apply) keepOurs(relPath);
    continue;
  }

  // 6. rename/delete：两侧都没有内容（一方改名、一方删除）
  if (!hasOurs && !hasTheirs) {
    if (headFiles.has(mapped) && mapped !== relPath) {
      stats.renameDeleteKeptOurs += 1;
      if (apply) git(["add", "-f", "--", mapped]);
    } else {
      stats.renameDeleteKeptDeleted += 1;
      if (apply) keepDeleted(relPath);
    }
    continue;
  }

  // 7. add/add
  if (hasOurs && hasTheirs && !hasBase) {
    const ours = readStage(2, relPath) ?? "";
    const theirs = normalizeBrand(readStage(3, relPath) ?? "");
    const merged = mergeThreeWay(ours, "", theirs);
    stats.addAddMerged += 1;
    if (apply) writeAndAdd(relPath, merged);
    if (countMarkers(merged) > 0) manual.push({ path: relPath, reason: `add/add 融合残留 ${countMarkers(merged)} 块` });
    continue;
  }

  stats.manual += 1;
  manual.push({ path: relPath, reason: `未分类（stages: ${Object.keys(stages).join(",")}）` });
}

console.log(`# v4 冲突解析${apply ? "（已写入）" : "（仅报告）"}`);
console.log(JSON.stringify(stats, null, 2));
if (process.argv.includes("--list-removed")) {
  console.log(`\n[已拆业务保持删除/保留] ${removedPaths.length}`);
  for (const p of removedPaths) console.log(`  ${p}`);
}
if (manual.length > 0) {
  console.log(`\n[需人工处理] ${manual.length}`);
  for (const m of manual.slice(0, 120)) console.log(`  ${m.path}  — ${m.reason}`);
  if (manual.length > 120) console.log(`  ... 另 ${manual.length - 120} 个`);
}
