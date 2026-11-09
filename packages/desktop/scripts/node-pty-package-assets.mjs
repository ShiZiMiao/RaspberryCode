import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);

export function restoreTargetNodePtyPrebuild({ desktopPackageRoot, targetPlatform }) {
  if (targetPlatform.os !== "linux") {
    console.log(`[beforePack] node-pty prebuild restore skipped for ${targetPlatform.key}`);
    return;
  }

  const platformKey = targetPlatform.key;
  const sourcePackageName = `@lydell/node-pty-${platformKey}`;
  let sourceBinaryPath;

  try {
    sourceBinaryPath = resolveSourceNodePtyPrebuildPath({ sourcePackageName, platformKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`缺少 ${sourcePackageName}，无法为 ${platformKey} 打包 node-pty: ${message}`);
  }

  const nodePtyPackageRoot = dirname(
    require.resolve("node-pty/package.json", { paths: [desktopPackageRoot] }),
  );
  const targetPrebuildDir = resolve(nodePtyPackageRoot, "prebuilds", platformKey);
  const targetBinaryPath = resolve(targetPrebuildDir, "pty.node");

  // Linux 包中 node-pty 本体只会查自己的 prebuilds/linux-*/pty.node，
  // 但 Linux 预编译文件实际来自 @lydell/node-pty-linux-* 平台包；若排除该平台包，
  // 而 node-pty 自身目录没有 linux prebuild，最终安装包里会缺 pty.node，终端启动失败。
  // 这里在 beforePack 阶段恢复依赖资产，让后续 asarUnpack 按标准链路处理 native addon。
  mkdirSync(targetPrebuildDir, { recursive: true });
  cpSync(sourceBinaryPath, targetBinaryPath);

  if (!existsSync(targetBinaryPath))
    throw new Error(`node-pty 预编译产物恢复失败: ${targetBinaryPath}`);

  console.log(`[beforePack] node-pty prebuild restored: ${targetBinaryPath}`);
}

export function resolveSourceNodePtyPrebuildPath({ sourcePackageName, platformKey }) {
  const sourcePackageEntry = require.resolve(sourcePackageName);
  let currentDir = dirname(sourcePackageEntry);

  while (currentDir !== dirname(currentDir)) {
    const candidatePath = resolve(currentDir, "prebuilds", platformKey, "pty.node");
    if (existsSync(candidatePath)) return candidatePath;

    currentDir = dirname(currentDir);
  }

  // @lydell/node-pty-linux-* 通过 package exports 只暴露 lib/index.js，
  // 不能再解析 package.json。这里从公开入口向上寻找 prebuilds，兼容 exports 限制。
  throw new Error(
    `缺少 node-pty 预编译产物: ${sourcePackageName}/prebuilds/${platformKey}/pty.node`,
  );
}

export function resolvePackagedNodePtyPrebuildPath({ resourcesDir, platformKey }) {
  return resolve(
    resourcesDir,
    "app.asar.unpacked",
    "node_modules",
    "node-pty",
    "prebuilds",
    platformKey,
    "pty.node",
  );
}

/**
 * 注入 staging 的 node-pty 拷贝按目标平台裁剪（对齐 desktop-native-package-policy 的
 * files 规则：仅保留目标 prebuilds，删除 build/bin/其他平台 prebuilds/pdb），
 * 避免闭包注入绕过 files 裁剪后把跨平台 native 与调试符号带进安装包（包体曾膨胀数百 MiB）。
 */
export function pruneStagedNodePtyPayload({ stagedModuleRoot, targetPlatformKey }) {
  const prebuildsRoot = resolve(stagedModuleRoot, "prebuilds");
  for (const dir of ["build", "bin"]) {
    rmSync(resolve(stagedModuleRoot, dir), { force: true, recursive: true });
  }
  if (!existsSync(prebuildsRoot)) {
    return;
  }
  for (const entry of readdirSync(prebuildsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== targetPlatformKey) {
      rmSync(resolve(prebuildsRoot, entry.name), { force: true, recursive: true });
    }
  }
  const targetPrebuildsDir = resolve(prebuildsRoot, targetPlatformKey);
  if (existsSync(targetPrebuildsDir)) {
    for (const entry of readdirSync(targetPrebuildsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdb")) {
        rmSync(resolve(targetPrebuildsDir, entry.name), { force: true });
      }
    }
  }
}
