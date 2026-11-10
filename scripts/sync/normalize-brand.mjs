#!/usr/bin/env node

// 品牌规范化批处理器：把上游带来的 raspberrycode 品牌残留统一改为 raspberrycode。
//
// 用途：合并在旧路径下新增的上游文件时，文件名已随目录迁移，但文件内容
// 仍带 raspberrycode 标识。本脚本按审计口径（scripts/audit-neutrality.mjs）做保守替换。
//
// 保守原则——以下形态**不改**（属 wire 协议事实或兼容读值）：
//   - raspberrycode.error.* 错误码 key
//   - X-Bigmodel-* / Bigmodel-Organization 头
//   - 迁移史中的旧值字面量（migrations/、OFF_PEAK_SCHEMA、offPeakTaskId 等）
//
// 用法：
//   node scripts/sync/normalize-brand.mjs <path...>            # 仅报告
//   node scripts/sync/normalize-brand.mjs --apply <path...>    # 写入

import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import process from "node:process";

const apply = process.argv.includes("--apply");
const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const TEXT_EXT = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".jsonc", ".jsx", ".mjs",
  ".ps1", ".py", ".sh", ".sql", ".svg", ".toml", ".ts", ".tsx", ".yaml", ".yml", ".md",
]);

// 不改的行：wire 协议事实与兼容读值
const PROTECTED_LINE = /raspberrycode\.error\.|X-Bigmodel|Bigmodel-Organization|OFF_PEAK_SCHEMA|offPeakTaskId|provisioning-v1/iu;

const RULES = [
  // npm 包作用域（@raspberrycode/x -> @raspberrycode/x）
  [/@raspberrycode\//gu, "@raspberrycode/"],
  [/\bzcode-cli\b/gu, "raspberrycode-cli"],
  [/\bzcode-server-cli\b/gu, "raspberrycode-server-cli"],
  [/\bzcode-cua\b/gu, "raspberrycode-cua"],
  [/\bzcode-protocol\b/gu, "raspberrycode-protocol"],
  [/\bzcode-protocol-v4\b/gu, "raspberrycode-protocol-v4"],
  [/\bzcode_([a-z0-9_]+)\b/gu, "raspberrycode_$1"],
  [/\.raspberrycode\b/gu, ".raspberrycode"],
  [/\bZCODE_([A-Z0-9_]+)\b/gu, "RASPBERRYCODE_$1"],
  [/\bzcode([A-Z][A-Za-z0-9]*)/gu, "raspberrycode$1"],
  [/\bZcode([A-Z][A-Za-z0-9]*)/gu, "Raspberrycode$1"],
  // RaspberryCode 后接大写驼峰时同样是产品名（useRaspberryCodeSessionStore -> useRaspberryCodeSessionStore）
  [/\buseZCode([A-Z][A-Za-z0-9]*)/gu, "useRaspberryCode$1"],
  [/\bZCode([A-Z][A-Za-z0-9]*)/gu, "RaspberryCode$1"],
  // 标识符中段（workspaceShellRaspberryCodeState -> workspaceShellRaspberryCodeState）
  [/([a-z0-9])RaspberryCode([A-Z][A-Za-z0-9]*)/gu, "$1RaspberryCode$2"],
  [/\bZCode\b/gu, "RaspberryCode"],
  [/\bZ Code\b/gu, "RaspberryCode"],
  [/\bzcode(?![A-Za-z0-9])/gu, "raspberrycode"],
  // window 全局桥（__raspberrycodeTabStoreE2E -> __raspberrycodeTabStoreE2E）
  [/(__)raspberrycode([A-Z][A-Za-z0-9]*)/gu, "$1raspberrycode$2"],
  // 无分隔符的驼峰中段/后缀（raspberrycodeEnv -> raspberrycodeEnv）
  [/([a-z0-9])raspberrycode([A-Z][A-Za-z0-9]*)/gu, "$1raspberrycode$2"],
  [/\bzcode([a-z][A-Za-z0-9]*)/gu, "raspberrycode$1"],
];

function* walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
      yield* walk(join(p, e.name));
    }
  } else if (TEXT_EXT.has(extname(p))) {
    yield p;
  }
}

let files = 0;
let changedFiles = 0;
let changedLines = 0;

for (const target of targets) {
  for (const file of walk(target)) {
    files += 1;
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    let localChanged = 0;
    const out = lines.map((line) => {
      if (PROTECTED_LINE.test(line)) return line;
      let next = line;
      for (const [re, to] of RULES) next = next.replace(re, to);
      if (next !== line) localChanged += 1;
      return next;
    });
    if (localChanged > 0) {
      changedFiles += 1;
      changedLines += localChanged;
      if (apply) writeFileSync(file, out.join("\n"));
    }
  }
}

console.log(`# 品牌规范化${apply ? "（已写入）" : "（仅报告）"}`);
console.log(`扫描文件: ${files}`);
console.log(`命中文件: ${changedFiles}`);
console.log(`改动行数: ${changedLines}`);
