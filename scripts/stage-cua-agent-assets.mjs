/**
 * 只补齐 CUA 相关的 agent 运行时资产（跳过会失败的 office 插件构建）。
 *
 * ## 为什么需要这个脚本
 *
 * `pnpm build` 在 `prepare:agent-bundle` 这一步会：
 *   1. stageAgentBundle      —— 清空并重建 bundled-agents/<平台>/agent
 *   2. buildOfficialPluginRuntimes —— 逐个构建插件
 *   3. stageOfficialPlugins  —— 纯拷贝
 *   4. stageKoffiForCuaPlugin —— 纯拷贝（CUA 的原生模块）
 *
 * 第 2 步里的 `pdf-plugin` / `documents-plugin` / `presentations-plugin` 走
 * `office-runtime/scripts/build.mjs`，它 `rm(dist, {recursive:true})` 一次删 300 个文件，
 * 触发当前环境的批量删除保护：
 *
 *   [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":336,"threshold":50}
 *
 * 这是**环境限制**，不是代码缺陷。但 desktop 打包并不依赖这些 office 插件
 * （已核实 packages/desktop 的依赖里没有它们），所以可以只补 CUA 相关部分。
 *
 * ## 这个脚本做什么
 *
 * 复用 prepare-agent-node-bundle.mjs 里已经定义好的 stage 逻辑，只跳过
 * 「构建插件 runtime」这一步。这样产物结构与完整构建一致，不是手工拼的。
 *
 * 用法：
 *   node scripts/stage-cua-agent-assets.mjs
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";

const repoRoot = resolve(import.meta.dirname, "..");
const platformKey = "win32-x64";
const agentDir = resolve(repoRoot, "packages", "desktop", "bundled-agents", platformKey, "agent");

console.log(`[stage-cua] repo=${repoRoot}`);
console.log(`[stage-cua] agentDir=${agentDir}`);

// 直接把 prepare-agent-node-bundle 当模块导入不可行：它在顶层就执行整套流程
// （含会失败的那一步）。所以这里复制它用到的两份逻辑，保持行为一致。
const { cpSync, mkdirSync, readdirSync, rmSync, statSync } = await import("node:fs");

/** 与 prepare-agent-node-bundle.mjs 的 includedOfficialPluginTopLevelPaths 保持一致。 */
const INCLUDED_TOP_LEVEL = [
  "package.json",
  "scripts",
  "skills",
  "docs",
  "assets",
  "dist",
  "README.md",
];

/** 与 shouldCopyOfficialPluginAsset 语义一致：跳过明显非运行时的东西。 */
function shouldCopy(source) {
  const base = source.replace(/\\/g, "/").split("/").pop() ?? "";
  if (base === "node_modules") return false;
  if (base === ".git") return false;
  if (base.endsWith(".map")) return false;
  if (base.endsWith(".ts") && !base.endsWith(".d.ts")) return false;
  if (base === "tsconfig.json") return false;
  if (base === ".turbo") return false;
  return true;
}

/**
 * 只 stage CUA 插件。它 `requiresRuntime: false`（纯 SDK/skill/docs，无构建产物），
 * 所以纯拷贝就等价于完整流程的结果。
 */
function stageCuaPlugin() {
  const sourceRoot = resolve(repoRoot, "apps", "raspberrycode-cli", "packages", "raspberrycode-cua-plugin");
  const manifest = resolve(sourceRoot, ".raspberrycode-plugin", "plugin.json");
  if (!existsSync(manifest)) {
    throw new Error(`[stage-cua] 缺少插件 manifest: ${manifest}`);
  }

  const targetRoot = resolve(agentDir, "packages", "raspberrycode-cua-plugin");
  mkdirSync(targetRoot, { recursive: true });
  for (const entry of INCLUDED_TOP_LEVEL) {
    const sourcePath = resolve(sourceRoot, entry);
    if (!existsSync(sourcePath)) continue;
    cpSync(sourcePath, resolve(targetRoot, entry), { recursive: true, filter: shouldCopy });
  }
  // .raspberrycode-plugin 也要带上，否则 agent 认不出这是插件
  const pluginMeta = resolve(sourceRoot, ".raspberrycode-plugin");
  if (existsSync(pluginMeta)) {
    cpSync(pluginMeta, resolve(targetRoot, ".raspberrycode-plugin"), { recursive: true });
  }

  const staged = resolve(targetRoot, "scripts", "computer-use-client.mjs");
  if (!existsSync(staged)) {
    throw new Error(`[stage-cua] stage 后仍缺少 ${staged}`);
  }
  console.log(`[stage-cua] staged plugin → ${targetRoot}`);
}

/**
 * 把 koffi 的目标平台 .node 拷到插件旁，并且**同时**拷一份到 node-repl-host 旁。
 *
 * 复用项目已有的 stageKoffiIntoBundledAgents —— 这是打包流程里同一个函数，
 * 所以路径与打包校验（verifyStagedKoffi）期望的完全一致。
 *
 * ⚠ 2026-11-20 修复（真实安装版才暴露的缺陷）：
 * host bundle `node-repl-host/dist/mcp/server.js` 里有**静态顶层** `import koffi from "koffi"`
 * （esbuild 把 koffi 标了 external，因为 .node 二进制无法内联）。Node 的 ESM 解析会从
 * `server.js` 所在目录**逐级向上**找 `node_modules`，而装机后的目录结构是：
 *
 *   resources/agent/packages/
 *     ├── node-repl-host/          ← server.js 在这里，没有 node_modules
 *     └── raspberrycode-cua-plugin/node_modules/koffi   ← koffi 只在这里
 *
 * 同级目录不会被搜索 → 直接 `ERR_MODULE_NOT_FOUND: Cannot find package 'koffi'`，
 * host 启动即退出，CUA 完全不可用。
 * 而 `verifyStagedKoffi` 的默认 pluginRelativePath 只查 cua-plugin 那一路，
 * 所以打包前的自检**是绿的**——这就是它能一路漏到安装包里的原因。
 *
 * 修法：给 node-repl-host 也放同一份 koffi（同函数、同平台键，幂等）。
 */
async function stageKoffi() {
  const { pathToFileURL } = await import("node:url");
  const { stageKoffiIntoBundledAgents } = await import(
    pathToFileURL(resolve(repoRoot, "packages", "desktop", "scripts", "koffi-package-assets.mjs")).href
  );
  const koffiPackageRoot = resolve(repoRoot, "node_modules", "koffi");
  const targetPlatform = { os: "win32", arch: "x64" };

  const cuaPluginStagedDir = resolve(agentDir, "packages", "raspberrycode-cua-plugin");
  const staged = stageKoffiIntoBundledAgents({
    koffiPackageRoot,
    agentDir: cuaPluginStagedDir,
    targetPlatform,
  });
  console.log(`[stage-cua] staged koffi → ${staged}`);

  // 下面两个是「静态顶层 import "koffi"」的实际消费方，各自从自己的目录向上解析。
  // 装机后的 agent/packages/ 下没有 hoisted node_modules，所以每个消费方都要就近一份。
  for (const relPkg of ["node-repl-host", "raspberrycode-cua"]) {
    const pkgDir = resolve(agentDir, "packages", relPkg);
    if (!existsSync(pkgDir)) continue;
    const stagedFor = stageKoffiIntoBundledAgents({
      koffiPackageRoot,
      agentDir: pkgDir,
      targetPlatform,
    });
    console.log(`[stage-cua] staged koffi (for ${relPkg}) → ${stagedFor}`);
  }
}

stageCuaPlugin();
// 顺序要点：cua runtime 必须先落地，stageKoffi 才能把 koffi 放进
// `agent/packages/raspberrycode-cua/node_modules/`（否则目录不存在会被跳过）。
stageCuaRuntime();
await stageKoffi();

/**
 * 把 `packages/raspberrycode-cua/dist` 整个搬进 agent bundle。
 *
 * ⚠ 2026-11-20 修复（真实安装版才暴露，比 koffi 那条更致命）：
 * 自研 CUA 的 Helper 是**独立子进程入口** `windows-helper.js`，
 * 由 `resolveHelperEntry()` 从 `new URL("../helper/windows-helper.js", import.meta.url)` 解析，
 * 或由 `RASPBERRYCODE_CUA_HELPER_ENTRY` 覆盖。
 *
 * 但生产打包链路（prepare-agent-node-bundle / electron-builder / stage-cua-agent-assets）
 * **全都没有搬运 `packages/raspberrycode-cua/dist`**，而 tsup 又把该包 external 进 main bundle。
 * 结果：安装包里不存在 `windows-helper.js`（asar 与 app.asar.unpacked 都搜不到），
 * Helper 启动即 `code=1` 退出，CUA 全部方法不可用——而在源码树里跑一切正常，
 * 因为开发态直接读 `packages/raspberrycode-cua/dist/helper/windows-helper.js`。
 *
 * 落点选 `agent/packages/raspberrycode-cua/dist`（与 host bundle 同级的包目录），
 * 这样 `RASPBERRYCODE_CUA_HELPER_ENTRY` 可以稳定指向它，也不依赖 asar 解包规则。
 */
function stageCuaRuntime() {
  const sourceDist = resolve(repoRoot, "packages", "raspberrycode-cua", "dist");
  const helperEntry = resolve(sourceDist, "helper", "windows-helper.js");
  if (!existsSync(helperEntry)) {
    throw new Error(
      `[stage-cua] 缺少自研 CUA Helper 产物: ${helperEntry}\n` +
        "        先跑 pnpm --filter @raspberrycode/raspberrycode-cua build",
    );
  }
  const targetDist = resolve(agentDir, "packages", "raspberrycode-cua", "dist");
  rmSync(targetDist, { recursive: true, force: true });
  cpSync(sourceDist, targetDist, {
    recursive: true,
    filter: (src) => !src.endsWith(".map"),
  });
  console.log(`[stage-cua] staged cua runtime → ${targetDist}`);
  console.log(`[stage-cua]   helper entry = ${resolve(targetDist, "helper", "windows-helper.js")}`);
}

// 末尾自检：与打包时 assertPackagedCuaKoffi 的判据一致
const { pathToFileURL: toUrl } = await import("node:url");
const { verifyStagedKoffi } = await import(
  toUrl(resolve(repoRoot, "packages", "desktop", "scripts", "koffi-package-assets.mjs")).href
);
const problems = verifyStagedKoffi({
  // verifyStagedKoffi 期望的是 resources 根（含 agent/ 子目录）。
  // 这里 agent 本身就在 .../agent，所以传它的父目录。
  resourcesDir: resolve(agentDir, ".."),
  targetPlatform: { os: "win32", arch: "x64" },
});

// Helper 入口存在性自检。这条比 koffi 更容易漏：koffi 缺了有 verifyStagedKoffi 拦，
// 而 helper 缺了以前没有任何校验，症状只在装机后表现为「helper 启动前退出 code=1」。
const helperEntryStaged = resolve(
  agentDir,
  "packages",
  "raspberrycode-cua",
  "dist",
  "helper",
  "windows-helper.js",
);
if (!existsSync(helperEntryStaged)) {
  problems.push(`missing staged CUA helper entry: ${helperEntryStaged}`);
}

if (problems.length > 0) {
  console.error("[stage-cua] 自检失败：");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("[stage-cua] 自检通过：koffi 与 CUA helper 运行时就位");
