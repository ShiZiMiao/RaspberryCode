#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPolicy } from "./architecture/policy.mjs";
import { classifyLintDiagnostics, parseLintCommand } from "./cli-lint-admission.mjs";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "apps/raspberrycode-cli");
// 根配置排除了整个 CLI；包内 oxlint 必须改用显式配置，否则会 0 文件可 lint。
const cliConfig = resolve(root, ".oxlintrc.cli.json");

async function main() {
  await loadPolicy(root);
  // 全新独立发行后不再有「未改动的 upstream 原文」概念，全部文件都按现行 lint 规则计数。
  const pristine = new Set();
  let errors = 0,
    warnings = 0,
    accepted = 0;
  for (const parent of ["packages", "tools"]) {
    const entries = await readdir(resolve(cli, parent), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const cwd = resolve(cli, parent, entry.name);
      let manifest;
      try {
        manifest = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (!manifest.scripts?.lint) continue;
      // 包自带的 .oxlintrc.json（如 dynamic-workflow）承载语料/生成物豁免，必须保留就近发现；
      // 其余包继承根配置会带上「忽略整个 CLI」的 ignorePatterns，改用显式 CLI 配置。
      const configArgs = existsSync(resolve(cwd, ".oxlintrc.json")) ? [] : ["--config", cliConfig];
      const args = [...configArgs, ...parseLintCommand(manifest.scripts.lint), "--format", "json"];
      // 沿用各包解析出的 oxlint 版本、cwd 和原参数。
      // 修复原因：Windows（mise 安装）下 npm_execpath 指向原生 pnpm.exe，把它交给 node 执行
      // 会按 JS 解析 MZ 头并抛 SyntaxError。改为直接解析包内 oxlint 的 JS 入口，跨平台一致。
      let oxlintBin;
      try {
        oxlintBin = resolve(
          dirname(createRequire(import.meta.url).resolve("oxlint/package.json", { paths: [cwd] })),
          "bin/oxlint",
        );
      } catch {
        throw new Error(`${manifest.name}: 未解析到 oxlint，请确认依赖已安装`);
      }
      let result;
      try {
        result = await exec(process.execPath, [oxlintBin, ...args], {
          cwd,
          maxBuffer: 16 * 1024 * 1024,
        });
      } catch (error) {
        if (error.code !== 1 || !error.stdout) throw error;
        result = error;
      }
      const report = JSON.parse(result.stdout);
      if (!Array.isArray(report.diagnostics))
        throw new Error(`${manifest.name}: 无法解析 oxlint 结果`);
      const groups = classifyLintDiagnostics(report.diagnostics, {
        pristine,
        relativeDirectory: relative(root, cwd).replaceAll("\\", "/"),
      });
      // 非诊断性失败不能被“零错误”误判为成功。
      if (result.code === 1 && !report.diagnostics.some((item) => item.severity === "error"))
        throw new Error(`${manifest.name}: oxlint 异常退出：${result.stderr}`);
      for (const item of [...groups.errors, ...groups.warnings])
        console.log(
          `${manifest.name}: ${item.severity} ${item.filename} ${item.code}: ${item.message}`,
        );
      if (groups.accepted.length)
        console.log(`${manifest.name}: 接纳 ${groups.accepted.length} 项原样上游 max-lines 存量`);
      errors += groups.errors.length;
      warnings += groups.warnings.length;
      accepted += groups.accepted.length;
    }
  }
  console.log(
    `CLI lint: ${errors} errors, ${warnings} warnings, ${accepted} pristine upstream line-count diagnostics`,
  );
  return errors ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
