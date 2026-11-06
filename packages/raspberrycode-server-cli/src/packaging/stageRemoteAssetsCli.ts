import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOURCE_SERVER_REMOTE_RELEASE_TARGETS,
  beginSourceServerRemoteReleaseGeneration,
  collectSourceServerRemoteReleaseArchives,
} from "./remoteAssetRelease.js";

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    // Bugfix: Windows 只有 pnpm.cmd 而无裸 pnpm 可执行，spawn("pnpm") 直接 ENOENT；
    // 按仓库惯例（bootstrap.mjs/dev-desktop-env.mjs）平台化命令名并用 shell 拉起 .cmd。
    const isWindows = process.platform === "win32";
    const resolvedCommand = isWindows && command === "pnpm" ? "pnpm.cmd" : command;
    const child = spawn(resolvedCommand, [...args], {
      cwd,
      env,
      stdio: "inherit",
      ...(isWindows ? { shell: true } : {}),
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function main(): Promise<void> {
  const linuxOnly = process.argv.slice(2).includes("--linux");
  const targets = linuxOnly
    ? SOURCE_SERVER_REMOTE_RELEASE_TARGETS.filter((target) => target.startsWith("linux-"))
    : SOURCE_SERVER_REMOTE_RELEASE_TARGETS;
  const env = { ...process.env };
  if (linuxOnly) {
    // Linux 开发入口与 dev:desktop 共用 production 默认值，避免远端模型配置退回 test。
    // 原全平台入口继续沿用通用构建器的环境选择规则。
    const raspberrycodeEnv = env.RASPBERRYCODE_ENV?.trim().toLowerCase() || "production";
    if (raspberrycodeEnv !== "test" && raspberrycodeEnv !== "production") {
      throw new Error(`Invalid RASPBERRYCODE_ENV for prepare:remote-assets:linux: ${raspberrycodeEnv}`);
    }
    env.RASPBERRYCODE_ENV = raspberrycodeEnv;
  }
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const repoRoot = resolve(packageRoot, "../..");
  const { version } = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
    version: string;
  };
  const versionReleaseDir = join(repoRoot, "packages/desktop/mock-cdn/releases", version);
  await beginSourceServerRemoteReleaseGeneration({ versionReleaseDir });
  await run("pnpm", ["--filter", "@raspberrycode/server-cli", "build"], repoRoot, env);
  for (const [index, target] of targets.entries()) {
    await run(
      "pnpm",
      [
        "--filter",
        "@raspberrycode/server-cli",
        "exec",
        "tsx",
        "src/packaging/stageCli.ts",
        "--target",
        target,
        ...(linuxOnly ? ["--skip-component-archives"] : []),
        ...(index === 0 ? [] : ["--skip-agent-build"]),
      ],
      repoRoot,
      env,
    );
  }
  const collected = await collectSourceServerRemoteReleaseArchives({
    distReleaseDir: join(packageRoot, "dist-release"),
    versionReleaseDir,
    version,
    targets,
  });
  for (const path of collected) console.log(`[source-server-release] ${path}`);
}

await main();
