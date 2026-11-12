#!/usr/bin/env node

// 品牌中立性审计（棘轮）：把 2026-11-03 终检的扫描口径固化为可复跑的机器判据。
// 动机：人工逐轮扫描反复漏掉变体（RaspberryCode 空格、ZCODE 全大写、z-code 连字符、codegeex 第二品牌），
// "每次检查都发现新遗漏"说明口径没有收敛；本脚本用穷举变体 + 显式豁免清单收敛到可验证状态。
//
// 三档判据：
//   P0 产品自名残留（raspberrycode 全变体）——运行时源码与构建产物必须为 0（豁免清单除外）
//   P1 厂商信息盘点（Z.ai/zhipu/智谱/codegeex/chatglm/bigmodel）——内置供应商接口/模板/
//      模型 ID/logo/用量数据属产品接入能力（2026-11-03 用户口径：中立=无特权无偏袒，
//      不是抹掉厂商信息），仅作盘点基线（防意外引入），不判负；白名单注记来源分类
//   P2 用户可见文案面（i18n、slash-help、TUI）——产品自称品牌必须为 0
//
// 判负口径：P0（产品自名）+ P2（文案自称）+ 产物 P0 硬边界。
//
// 用法：
//   node scripts/audit-neutrality.mjs           # 全量审计，硬违规则退出码 1
//   node scripts/audit-neutrality.mjs --report   # 打印豁免与白名单现状
//   node scripts/audit-neutrality.mjs --full     # 不截断输出

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import process from "node:process";

const repoRoot = resolve(import.meta.dirname, "..");
const reportMode = process.argv.includes("--report");

const textExtensions = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".jsonc", ".jsx", ".mjs",
  ".ps1", ".py", ".sh", ".sql", ".svg", ".toml", ".ts", ".tsx", ".yaml", ".yml",
]);

// P0：产品自名全变体。前边界排除误报子串（bizCode、TikZ code、tz code 等）；
// 字符类枚举 z[-_ ]?code，-i 覆盖 RaspberryCode/ZCODE/z_Code 等大小写组合。
// 历史教训：「RaspberryCode」带空格变体曾躲过所有 raspberrycode 词扫描（退出确认框残留）。
const productSelfName = /(?<![a-z0-9])z[-_ ]?code\b/iu;

// P1：品牌词。zai 用词边界避免误伤（raspberrycode 拼写天然不含，但仍防 czai 类子串）。
const brandTerms = /Z\.ai|\bzai\b|\bzhipu\b|智谱|codegeex|chatglm|bigmodel/iu;

const mode = reportMode ? "report" : "enforce";

// ---------- 豁免清单（有意保留，显式列出而非隐藏） ----------
// 法务：Apache-2.0 原始版权声明与第三方声明（删除即违法）。
// 历史文档：docs/** 与 apps/**/docs/** 为历史记录，不进发行产物。
// 工作记忆：.workbuddy/** 非产品内容。
const p0ExemptPaths = [
  /^LICENSE$/u,
  /^NOTICE\.md$/u, // 待拍板项：内容与现状脱节，见 docs/neutrality-final-audit-2026-11-03.md 第五节
  /^THIRD-PARTY-NOTICES\.md$/u,
  /^docs\//u,
  /^apps\/raspberrycode-cli\/docs\//u,
  /^apps\/dev-docs\//u,
  /^third-party\//u,
  /^\.workbuddy\//u,
  /^scripts\/audit-neutrality\.mjs$/u,
  /^scripts\/audit-raspberrycode-agent-remnants\.mjs$/u,
  // 上游同步工具族：内含品牌反向映射表（从 raspberrycode 还原旧路径以匹配祖先版本），
  // 是工具内部的机械映射，不进入产品运行时。
  /^scripts\/sync\//u,
  // wire：站点发布网关保留目录名 `.__zcode/`（外部服务端约定，改名即发布失败）
  /^apps\/raspberrycode-cli\/packages\/raspberrycode-site-plugin\//u,
  // wire：官方命令端点测试建模协议头（X-Zcode-Plan 为服务端读取的头名）
  /^apps\/raspberrycode-cli\/packages\/bootstrap\/tests\/official-command-endpoint\//u,
];

// P1 白名单：wire 协议事实与平铺数据声明（specs/provider-neutrality.md 规则 1/6/7 的例外与数据面）。
// 每条都注明来源定性；新增条目必须附「协议事实或数据声明」依据。
const p1AllowedFiles = [
  // wire 事实：旧配置读兼容端点（用户存量配置必须打厂商地址）
  { path: /^packages\/services\/src\/model-provider\/legacyRaspberryCodeConfigProviderReader\.ts$/u, note: "wire: 旧配置读兼容厂商端点" },
  // wire 事实：metered-key 额度查询端点（BYOK 用户按量计费 Key 查额度）
  { path: /^packages\/services\/src\/usage-stats\/providers\/meteredUsageQuotaProvider\.ts$/u, note: "wire: metered 额度端点" },
  // wire 互操作：官方 Server MCP 身份头（协议边界，改名即协议破坏）
  { path: /^packages\/shared\/src\/official-mcp-auth\.ts$/u, note: "wire: X-Bigmodel-* 互操作头" },
  // 数据声明：provider 身份/模板/模型 ID 目录（平铺第三方标识，与 Anthropic/OpenAI 同级）
  { path: /^packages\/shared\/src\/official-glm-model-id\.ts$/u, note: "data: 模型 ID 目录" },
  { path: /^packages\/shared\/src\/legacy-model-provider-identity\.ts$/u, note: "data: 旧 provider 身份读兼容" },
  { path: /^packages\/shared\/src\/model-provider-types\.ts$/u, note: "data: provider 类型声明" },
  { path: /^packages\/shared\/src\/reasoning-signature-scope\.ts$/u, note: "data: 签名兼容域成员声明" },
  { path: /^packages\/shared\/src\/coding-plan-subscription\.ts$/u, note: "data: 订阅状态类型（额度横幅用）" },
  { path: /^packages\/shared\/src\/project-access-token(-client)?\.ts$/u, note: "wire: 鉴权头格式声明数据" },
  { path: /^packages\/shared\/src\/oauth\.ts$/u, note: "compat: OAuth 冻结兼容（登录已拆，Source 在用）" },
  { path: /^packages\/services\/src\/oauth\//u, note: "compat: OAuth 冻结兼容模块" },
  { path: /^packages\/provider(-node)?\/src\/config\//u, note: "data: provider 配置 schema/模板" },
  { path: /^packages\/provider(-node)?\/(src\/)?/u, note: "data: provider 解析/目录数据", loose: true },
  // 数据迁移史（SQL/legacy schema/迁移代码）：旧值只读兼容
  { path: /migrations?\//u, note: "compat: 迁移史旧值", loose: true },
  { path: /migration/iu, note: "compat: 迁移读兼容", loose: true },
  // 错误码语义表：按 provider 声明的数据表（非分支条件）
  { path: /^apps\/raspberrycode-cli\/packages\/adapters\/src\/model\/failure-/u, note: "data: 业务错误码表" },
  { path: /^apps\/raspberrycode-cli\/packages\/adapters\/src\/config\/schema\.ts$/u, note: "data: 配置 schema 旧值兼容" },
  // 测试 fixture：建模 legacy 数据契约 / wire 互通（验收口径豁免）
  { path: /\/tests?\//u, note: "test: legacy/wire 夹具", loose: true },
  // 内置供应商接口模板与厂商标识资产：给用户的 API 接入便利功能（2026-11-03 用户口径：
  // 中立=无特权/无偏袒，不是抹掉厂商信息；内置智谱/DeepSeek 等接口配置属产品能力）。
  // 中立判定标准是「平铺无特权」（无 default/recommended/置顶/禁删），不是零厂商词。
  { path: /^config\/provider\//u, note: "data: 内置供应商接口模板（接入便利，平铺无特权）" },
  { path: /^packages\/ui\/src\/assets\/provider-icons\//u, note: "data: 厂商 logo 资产库（平铺随包）" },
  { path: /^packages\/shared\/src\/channels\.ts$/u, note: "data: 平台渠道声明" },
  // wire：站点发布网关的保留目录名（外部服务端约定，改名即发布失败）
  { path: /^apps\/raspberrycode-cli\/packages\/raspberrycode-site-plugin\//u, note: "wire: .__zcode 网关保留目录" },
  // wire：官方命令端点测试建模协议头（X-Zcode-Plan 为服务端读取的头名）
  { path: /^apps\/raspberrycode-cli\/packages\/bootstrap\/tests\/official-command-endpoint\//u, note: "test: wire 头互通夹具" },
];

// ---------- 构建产物边界（P0 硬边界：用户可见面） ----------
const artifactRoots = [
  "packages/desktop/out",
  "packages/desktop/dist",
  "packages/services/dist",
  "packages/server/dist",
  "apps/raspberrycode-cli/packages/cli/dist",
  "dist",
];

// 二进制产物按 ASCII 子串扫（asar/cjs/map/tar.gz 内嵌文本）。
const binaryArtifactP0 = /(?<![a-z0-9])z[-_ ]?code/iu;
const binaryArtifactP1 = /Z\.ai|codegeex/iu;
// 法务声明文件（上游技能 LICENSE、自动生成的第三方许可证清单等）：Apache-2.0/MIT 版权行
// 与「第三方作品源码来源路径」都是许可证归属必需内容，产物中合法保留。
// THIRD-PARTY-NOTICES.md 由 scripts/licenses.mjs 生成，正文含 apps/zcode-cli/... 这类
// 原始来源路径记录（归属声明，不是品牌自称），必须与 LICENSE/NOTICE 同口径豁免。
const artifactLegalFiles =
  /(?:^|\/)(?:LICENSE|LICENSE\.txt|LICENSES\.[^/]*\.html|NOTICE[^/]*|THIRD-PARTY-NOTICES\.[^/]*)$/iu;
// 模型 ID 目录数据（编译产物中的平铺第三方标识，如 GLM 系模型 ID）。
const modelIdData = /charglm|codegeex-4|emohaa/iu;
// 厂商 logo 资产清单（平铺随包，与源码层 provider-icons 白名单同口径）。
const providerAssetData = /model-provider-logo-sources\.json$/iu;

// ---------- 遍历 ----------
function* walk(dir, relBase = "") {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if ([".git", "node_modules", ".turbo", "coverage", "mock-cdn", ".e2e-home"].includes(entry.name)) continue;
      yield* walk(join(dir, entry.name), rel);
    } else if (entry.isFile()) {
      yield rel;
    }
  }
}

const scanRoots = ["packages", "apps", "scripts", "config", "specs", ".agents", "third-party"];

const p0Hits = [];
const p1Hits = [];
const p2Hits = [];
const exemptShown = [];

const p2Paths = [
  /^packages\/ui\/src\/i18n\//u,
  /^packages\/shared\/src\/raspberrycode-slash-command-help\.ts$/u,
  /^apps\/raspberrycode-cli\/packages\/tui\/src\//u,
];

for (const root of scanRoots) {
  for (const rel of walk(join(repoRoot, root), root)) {
    if (!textExtensions.has(extname(rel))) continue;
    let text;
    try {
      const size = statSync(join(repoRoot, rel)).size;
      if (size > 2 * 1024 * 1024) continue;
      text = readFileSync(join(repoRoot, rel), "utf-8");
    } catch {
      continue;
    }

    const isP0Exempt = p0ExemptPaths.some((re) => re.test(rel));
    const p0Lines = [];
    const p1Lines = [];
    const p2Lines = [];
    text.split("\n").forEach((line, i) => {
      if (productSelfName.test(line)) p0Lines.push({ line: i + 1, text: line.trim().slice(0, 120) });
      if (brandTerms.test(line)) {
        // wire 事实行豁免：错误码 key（raspberrycode.error.*）、X-Bigmodel-* 头声明
        const isWireLine = /raspberrycode\.error\.|X-Bigmodel|Bigmodel-Organization/iu.test(line);
        if (!isWireLine) p1Lines.push({ line: i + 1, text: line.trim().slice(0, 120) });
        if (p2Paths.some((re) => re.test(rel)) && !isWireLine) p2Lines.push({ line: i + 1, text: line.trim().slice(0, 120) });
      }
    });

    if (p0Lines.length > 0) {
      // bundled-agents / dist / out 里是构建期复制进来的产物副本（如插件包整目录被拷进
      // packages/desktop/bundled-agents/<平台>/agent/）。它们的上游路径豁免在源码层已成立
      // （p0ExemptPaths 按 apps/... 前缀匹配），副本前缀变了会漏判，这里按产物同口径处理：
      // 命中原文件的 wire 豁免即视为合法副本，不再计为源码层 P0 违规。
      const isArtifactCopy = /(^|\/)(dist|out|win-unpacked|bundled-agents)(\/|$)/u.test(rel);
      // 还原副本对应的源码路径：bundled-agents/<平台>/agent/<包内相对路径>
      // → apps/raspberrycode-cli/<包内相对路径>，再套源码层豁免表判定。
      const artifactCopySourceRel = isArtifactCopy
        ? `apps/raspberrycode-cli/${rel.replace(/^.*?\/bundled-agents\/[^/]+\/agent\//u, "")}`
        : rel;
      const isArtifactCopyExempt =
        isArtifactCopy && p0ExemptPaths.some((re) => re.test(artifactCopySourceRel));
      if (isP0Exempt || isArtifactCopyExempt) {
        exemptShown.push({ rel, count: p0Lines.length, kind: isP0Exempt ? "P0-exempt" : "P0-exempt(产物副本)" });
      } else p0Hits.push({ rel, hits: p0Lines });
    }
    if (p1Lines.length > 0) {
      const allowed = p1AllowedFiles.find((r) => r.path.test(rel));
      if (allowed) exemptShown.push({ rel, count: p1Lines.length, kind: `P1-allow(${allowed.note})` });
      else if (!isP0Exempt) p1Hits.push({ rel, hits: p1Lines });
    }
    if (p2Lines.length > 0) p2Hits.push({ rel, hits: p2Lines });
  }
}

// 构建产物扫描（存在才扫；未构建时如实说明）
const artifactP0Hits = [];
const artifactP1Notes = [];
const artifactExempt = [];
for (const root of artifactRoots) {
  const abs = join(repoRoot, root);
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    continue;
  }
  const files = stat.isDirectory() ? [...walk(abs, root)] : [root];
  for (const rel of files) {
    if (rel.endsWith(".map")) continue;
    if (rel.split("/").includes("node_modules")) continue;
    const absFile = join(repoRoot, rel);
    try {
      const size = statSync(absFile).size;
      if (size > 200 * 1024 * 1024) continue;
      const buf = readFileSync(absFile);
      const asText = buf.toString("latin1");
      const legal = artifactLegalFiles.test(rel);
      const p0 = asText.match(binaryArtifactP0);
      const p1 = asText.match(binaryArtifactP1);
      if (p0) {
        if (legal) artifactExempt.push({ rel, note: "法务声明" });
        else {
          const idx = asText.indexOf(p0[0]);
          artifactP0Hits.push({ hits: [{ line: 0, text: p0[0] + " @ " + asText.slice(Math.max(0, idx - 30), idx + 50).replace(/[^\x20-\x7e]/g, ".") }], rel });
        }
      } else if (p1) {
        if (legal) artifactExempt.push({ rel, note: "法务声明" });
        else if (modelIdData.test(asText)) artifactExempt.push({ rel, note: "模型 ID 数据" });
        else if (providerAssetData.test(rel)) artifactExempt.push({ rel, note: "厂商 logo 资产" });
        else {
          const idx = asText.indexOf(p1[0]);
          artifactP1Notes.push({ hits: [{ line: 0, text: p1[0] + " @ " + asText.slice(Math.max(0, idx - 30), idx + 50).replace(/[^\x20-\x7e]/g, ".") }], rel });
        }
      }
    } catch {
      /* 跳过不可读文件 */
    }
  }
}

// ---------- 报告 ----------
function printHits(title, hits, limit = 20) {
  if (hits.length === 0) return;
  console.log(`\n[${title}] ${hits.length} 个文件`);
  for (const item of hits.slice(0, limit)) {
    const lines = item.hits ?? [{ line: 0, text: item.sample }];
    for (const h of lines.slice(0, 3)) {
      console.log(`  ${item.rel}:${h.line}  ${h.text}`);
    }
    if (lines.length > 3) console.log(`  ... 另 ${lines.length - 3} 行`);
  }
  if (hits.length > limit) console.log(`  ... 另 ${hits.length - limit} 个文件（用 --full 查看全部）`);
}

// P1 必须区分源码层与产物层：源码层违规要全量可见（教训：limit 截断曾让模板目录
// 藏在「另 N 个」里，误得出源码层为 0 的结论）。
function splitSrcArtifact(hits) {
  const isArtifact = (rel) =>
    /(^|\/)(dist|out|win-unpacked|bundled-agents)(\/|$)/u.test(rel) || rel.startsWith("dist/");
  return [hits.filter((h) => !isArtifact(h.rel)), hits.filter((h) => isArtifact(h.rel))];
}
const [p1Src, p1Artifact] = splitSrcArtifact(p1Hits);

console.log(`# 品牌中立性审计（${mode}）`);
console.log(`P0 产品自名违规: ${p0Hits.length} 文件`);
console.log(`P1 厂商信息盘点（合法能力，非违规） — 源码层: ${p1Src.length} 文件 / 产物层: ${p1Artifact.length} 文件`);
console.log(`P2 用户可见文案违规: ${p2Hits.length} 文件`);
console.log(`产物 P0 硬边界违规: ${artifactP0Hits.length} 文件`);
console.log(`产物 P1 报告项: ${artifactP1Notes.length} 文件`);
console.log(`豁免/白名单命中: ${exemptShown.length} 文件 + 产物豁免 ${artifactExempt.length} 文件（明细如下）`);

const fullMode = process.argv.includes("--full");
printHits("P0 产品自名违规", p0Hits, fullMode ? Infinity : 20);
printHits("P1 厂商信息盘点 — 源码层（内置供应商能力/兼容数据）", p1Src, fullMode ? Infinity : 100);
printHits("P1 厂商信息盘点 — 产物层（旧构建副本，重建可清）", p1Artifact, fullMode ? Infinity : 10);
printHits("P2 文案违规", p2Hits, fullMode ? Infinity : 20);
printHits("产物 P0 硬边界违规", artifactP0Hits, fullMode ? Infinity : 20);
printHits("产物 P1 报告项（重建后复核）", artifactP1Notes, fullMode ? Infinity : 10);

if (reportMode || exemptShown.length <= 40) {
  console.log("\n[豁免/白名单明细]");
  for (const item of exemptShown) {
    console.log(`  ${item.rel}  (${item.count} 行, ${item.kind})`);
  }
} else {
  console.log(`\n[豁免/白名单明细] 共 ${exemptShown.length} 文件，用 --report 查看`);
}
if (artifactExempt.length > 0) {
  console.log(`\n[产物豁免明细] ${artifactExempt.length} 文件`);
  for (const item of artifactExempt.slice(0, 15)) console.log(`  ${item.rel}  (${item.note})`);
}

// 判负口径（2026-11-03 用户口径后）：P0 产品自名、P2 文案自称、产物 P0 硬违规。
// P1 厂商信息是合法的产品接入能力（内置供应商模板/适配器/用量数据），仅作盘点基线。
const violations = p0Hits.length + p2Hits.length + artifactP0Hits.length;
if (mode === "enforce" && violations > 0) {
  console.log(`\nFAIL: ${violations} 个硬违规文件（P0 产品自名 / P2 文案自称 / 产物P0）`);
  process.exit(1);
}
console.log(`\n${violations === 0 ? "PASS" : "FAIL"}: 硬违规 ${violations}；P1 厂商信息盘点基线 ${p1Hits.length} 文件（合法存在）；产物层待重建项 ${p1Artifact.length + artifactP1Notes.length}`);
