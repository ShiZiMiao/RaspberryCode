#!/usr/bin/env node
/**
 * 发版准入检查（release gate）。
 *
 * 背景：2026-11-13 用户明确要求「以后没有经过全面测试时禁止发版」。
 * 此前 0.2.0/0.2.1 带着「更新功能实际不可用」、0.1.0/0.2.0 带着
 * 「装完没有快捷方式」发出去，两次都是用户先发现。仅靠记忆和自觉不够，
 * 因此把可自动判定的部分固化成脚本，让发版流程必须先过这一关。
 *
 * 用法：
 *   node scripts/release-gate.mjs            # 完整检查
 *   node scripts/release-gate.mjs --quick    # 只查产物与元数据一致性（不跑门禁）
 *
 * 退出码：0 = 允许发版；1 = 阻止发版（会列出未通过项）。
 *
 * 覆盖范围与边界：
 *   - 这里只判定「可自动验证」的部分（门禁、产物一致性、资产齐全）。
 *   - 真实安装/升级/功能点验属人工项，脚本无法替代，会在末尾列出待人工确认清单，
 *     需要人工逐项勾选确认后才发版。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const dist = join(repoRoot, "packages/desktop/dist");
const quick = process.argv.includes("--quick");

const failures = [];
const warnings = [];
const manual = [];

const ok = (msg) => console.log(`  OK    ${msg}`);
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL  ${msg}`);
};
const warn = (msg) => {
  warnings.push(msg);
  console.log(`  WARN  ${msg}`);
};
const need = (msg) => manual.push(msg);

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function section(title) {
  console.log(`\n== ${title} ==`);
}

// ---------------------------------------------------------------------------
// 1. 版本一致性：package.json / build-meta / 产物名 / latest.yml 必须同一个版本
// ---------------------------------------------------------------------------
section("版本一致性");

const desktopPkgPath = join(repoRoot, "packages/desktop/package.json");
const rootPkgPath = join(repoRoot, "package.json");
const metaPath = join(repoRoot, "packages/desktop/out/metadata/build-meta.json");

const desktopVersion = readJson(desktopPkgPath).version;
const rootVersion = readJson(rootPkgPath).version;
console.log(`  desktop=${desktopVersion} root=${rootVersion}`);

if (desktopVersion !== rootVersion) {
  fail(`根 package.json(${rootVersion}) 与 desktop(${desktopVersion}) 版本不一致`);
} else {
  ok("两个 package.json 版本一致");
}

if (!existsSync(metaPath)) {
  fail("缺少 build-meta.json —— 必须先跑 pnpm prepare:build-meta");
} else {
  const meta = readJson(metaPath);
  if (meta.appVersion !== desktopVersion) {
    // 这是 11-13 真实踩过的坑：改了 package.json 但没重建 meta，
    // electron-builder 的 extraMetadata.version 会继续用旧值，产物名与内容版本错位。
    fail(
      `build-meta.json 的 appVersion=${meta.appVersion} 与 package.json=${desktopVersion} 不一致；先跑 pnpm prepare:build-meta`,
    );
  } else {
    ok(`build-meta.json 版本一致（${meta.appVersion}，commit ${meta.buildCommitId}）`);
  }
}

const installer = join(dist, `RaspberryCode-${desktopVersion}-win-x64.exe`);
const blockmap = `${installer}.blockmap`;
const latestYml = join(dist, "latest.yml");

for (const [label, p] of [
  ["安装包", installer],
  ["blockmap", blockmap],
  ["latest.yml", latestYml],
]) {
  if (existsSync(p)) ok(`${label} 存在（${(statSync(p).size / 1048576).toFixed(2)}MB）`);
  else fail(`缺少 ${label}：${p}`);
}

if (existsSync(latestYml) && existsSync(installer)) {
  const yml = readFileSync(latestYml, "utf8");
  const ymlVersion = yml.match(/^version:\s*(\S+)/m)?.[1];
  const ymlSize = Number(yml.match(/^\s+size:\s*(\d+)/m)?.[1]);
  const realSize = statSync(installer).size;
  if (ymlVersion !== desktopVersion) {
    fail(`latest.yml version=${ymlVersion} 与 package.json=${desktopVersion} 不一致`);
  } else {
    ok(`latest.yml version=${ymlVersion}`);
  }
  if (ymlSize !== realSize) {
    fail(`latest.yml size=${ymlSize} 与实际文件 ${realSize} 不一致`);
  } else {
    ok(`latest.yml size 与实际文件一致（${realSize}）`);
  }
}

// ---------------------------------------------------------------------------
// 2. 产物核验：从 asar 里读回主进程代码，确认不是旧产物
// ---------------------------------------------------------------------------
section("产物核验");

const unpackedAsar = join(dist, "win-unpacked/resources/app.asar");
if (!existsSync(unpackedAsar)) {
  fail("缺少 win-unpacked/resources/app.asar，无法核验产物内容");
} else {
  try {
    const { default: asar } = await import("@electron/asar");
    const entries = asar.listPackage(unpackedAsar);
    const rel = entries.find((p) => /(^|[\\/])out[\\/]main[\\/]index\.js$/.test(p));
    if (!rel) {
      fail("asar 内找不到 out/main/index.js");
    } else {
      const main = asar.extractFile(unpackedAsar, rel.replace(/^[\\/]+/, "")).toString();
      const m = (s) => {
        const n = main.split(s).length - 1;
        return n > 0 ? n : 0;
      };
      console.log(`  产物大小 ${(main.length / 1048576).toFixed(2)} MB`);

      // 这些标记代表近期修复真的在包里。新增重要修复时在此登记，
      // 防止「改了源码但产物没重编」这类问题再次静默通过。
      const requiredMarkers = [
        ["镜像重定向装在 updater session", "mirror redirect installed"],
        ["按阶段切换代理", "update session proxy ->"],
        ["代理同步注册", "registerUpdateSessionProxySync"],
        ["下载降级重试", "retry via"],
        ["同一失败去重", "dup="],
      ];
      for (const [label, marker] of requiredMarkers) {
        if (m(marker) > 0) ok(`产物含「${label}」`);
        else fail(`产物缺少「${label}」—— 很可能用了旧 out/，请跑 pnpm build`);
      }

      const pkgEntry = entries.find((p) => p.replace(/\\/g, "/").match(/^\/?package\.json$/));
      if (pkgEntry) {
        const inAsarVersion = JSON.parse(
          asar.extractFile(unpackedAsar, pkgEntry.replace(/^[\\/]+/, "")).toString(),
        ).version;
        if (inAsarVersion === desktopVersion) ok(`asar 内 package.json 版本=${inAsarVersion}`);
        else fail(`asar 内 package.json 版本=${inAsarVersion}，与 ${desktopVersion} 不一致`);
      }
    }
  } catch (error) {
    fail(`读取 asar 失败：${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// 3. 自动门禁
// ---------------------------------------------------------------------------
if (quick) {
  console.log("\n== 自动门禁（--quick 跳过） ==");
  warn("已跳过 typecheck / lint / audit-neutrality，发版前必须无 --quick 跑一次");
} else {
  section("自动门禁");
  const run = (label, cmd, args) => {
    try {
      execFileSync(cmd, args, { cwd: repoRoot, stdio: "pipe" });
      ok(label);
      return true;
    } catch (error) {
      const out = `${error.stdout ?? ""}${error.stderr ?? ""}`.toString();
      fail(`${label} 未通过${out ? `：${out.split("\n").slice(0, 3).join(" / ")}` : ""}`);
      return false;
    }
  };
  run("typecheck", "npx", ["pnpm", "run", "typecheck"]);
  run("lint", "npx", ["pnpm", "run", "lint"]);
  run("audit-neutrality", "node", ["scripts/audit-neutrality.mjs"]);
}

// ---------------------------------------------------------------------------
// 4. 必须人工确认的项（脚本无法替代）
// ---------------------------------------------------------------------------
section("必须人工确认（脚本无法替代）");
need("卸载旧版 → 安装本产物 → 版本号显示为新版");
need("开始菜单 + 桌面快捷方式均已创建，且双击能启动");
need("升级路径实跑：旧版 → 检查更新 → 下载 → 安装 → 重启 → 版本号变新");
need("新建对话并收到模型回复（不是只看界面有没有回显）");
need("文件编辑 / 终端 / 设置页 / MCP·技能·插件入口 逐项点过");
need("涉及 UI 的改动已看真实界面截图确认");
for (const item of manual) console.log(`  [ ] ${item}`);

// ---------------------------------------------------------------------------
// 结论
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(64));
if (failures.length > 0) {
  console.log(`发版准入：拒绝（${failures.length} 项未通过）`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("发版准入：自动化项通过");
if (warnings.length > 0) {
  console.log(`警告 ${warnings.length} 项：`);
  for (const w of warnings) console.log(`  - ${w}`);
}
console.log("\n仍需人工逐项确认上面 6 项（真实安装 / 升级 / 功能点验），");
console.log("用户明确要求：未全面测试禁止发版。");
process.exit(0);
