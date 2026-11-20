/**
 * 把已生成的 Linux remote-asset tar.gz 收集到 mock-cdn/releases/<version>/ 并写 descriptor。
 *
 * ## 为什么单独写这一步
 *
 * `pnpm --filter @raspberrycode/server-cli run stage:remote-assets --linux` 在
 * 本环境失败：它内部用 `spawn(..., { shell: true, stdio: "inherit" })` 调
 * `build-desktop-agent-cli.mjs`，那一步在这里返回码 1；而**同一条命令手工执行是成功的**。
 * 属于外层包装的环境差异，不是打包逻辑问题。
 *
 * 底层 `stageCli.ts --target linux-*` 两个目标都已成功产出 tar.gz，
 * 所以这里只补做「收集 + 写 descriptor」这一步，复用项目自己的
 * `collectSourceServerRemoteReleaseArchives`，保证 sha256/文件名/结构与其他版本一致。
 *
 * ## 安全约束
 *
 * **只收集本次生成的平台**。dist-release 里还躺着 11-06 的 darwin 旧包，
 * 若一并收集会把过期产物挂到 0.2.6 上——那正是「远程资产与版本不匹配」这类
 * 事故的来源。这里显式限定 targets。
 *
 * 用法：node scripts/collect-remote-assets.mjs
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repoRoot, "packages", "raspberrycode-server-cli");

const { version } = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
console.log(`[collect] version=${version}`);

// 只收集本次实际生成的平台。macOS 按用户指示本轮不考虑。
const targets = ["linux-x64", "linux-arm64"];

const mod = await import(
  pathToFileURL(join(packageRoot, "src", "packaging", "remoteAssetRelease.ts")).href
);
const collect = mod.collectSourceServerRemoteReleaseArchives;
if (typeof collect !== "function") {
  console.error("[collect] 找不到 collectSourceServerRemoteReleaseArchives，检查导出名");
  process.exit(1);
}

const versionReleaseDir = join(repoRoot, "packages", "desktop", "mock-cdn", "releases", version);
const collected = await collect({
  distReleaseDir: join(packageRoot, "dist-release"),
  versionReleaseDir,
  version,
  targets,
});

for (const path of collected) console.log(`[collect] ${path}`);
console.log(`[collect] 输出目录: ${versionReleaseDir}`);
