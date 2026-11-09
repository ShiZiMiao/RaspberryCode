import { readdir, access, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export const ASAR_UNPACK_NATIVE_GLOB = "*.{node,dll,dylib,exe}";

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 修复：replaceAppAsarFromStaging 原先无条件要求 app.asar.next.unpacked 必产，
 * 但 repack 的 --unpack 只在 staging 命中 native 时才生成侧车。当缺失闭包全是纯 JS
 * （native 都在 resources/extraResources，不在 app.asar）时 staging 无任何可解包文件，
 * 侧车合法缺席，旧检查把这种合法缺席误判成失败（曾阻断 NSIS 出包）。
 * 防护语义保留：staging 含 native 却没产出侧车（CI TMPDIR 隐藏目录匹配失效场景）仍是硬错误。
 */
function stagingHasUnpackableFiles(sourceDir) {
  const stack = [sourceDir];
  return (async () => {
    while (stack.length > 0) {
      const dir = stack.pop();
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (/\.(node|dll|dylib|exe)$/i.test(entry.name)) {
          return true;
        }
      }
    }
    return false;
  })();
}

export function createAppAsarPackArgs({ sourceDir, destinationPath, targetPlatformKey }) {
  return [
    "pack",
    sourceDir,
    destinationPath,
    "--unpack",
    ASAR_UNPACK_NATIVE_GLOB,
    "--unpack-dir",
    `node_modules/node-pty/prebuilds/${targetPlatformKey}`,
  ];
}

export async function replaceAppAsarFromStaging({
  sourceDir,
  appAsarPath,
  targetPlatformKey,
  runAsarCommand,
}) {
  const candidateAsarPath = `${appAsarPath}.next`;
  const candidateUnpackedPath = `${candidateAsarPath}.unpacked`;
  const unpackedPath = `${appAsarPath}.unpacked`;

  console.log("[asar-repack] step:rm-candidates start");
  await Promise.all([
    rm(candidateAsarPath, { force: true, recursive: true }),
    rm(candidateUnpackedPath, { force: true, recursive: true }),
  ]);
  console.log("[asar-repack] step:rm-candidates done");

  try {
    console.log("[asar-repack] step:pack start");
    runAsarCommand(
      createAppAsarPackArgs({
        sourceDir,
        destinationPath: candidateAsarPath,
        targetPlatformKey,
      }),
    );
    console.log("[asar-repack] step:pack done");

    const hasCandidateUnpacked = await pathExists(candidateUnpackedPath);
    if (!(await pathExists(candidateAsarPath))) {
      throw new Error(`重打包结果缺少 app.asar: ${candidateAsarPath}`);
    }
    if (!hasCandidateUnpacked && (await stagingHasUnpackableFiles(sourceDir))) {
      // staging 含 native 却没解包出侧车：大概率是 unpack 匹配失效（如 CI TMPDIR 隐藏目录），
      // 继续替换会把 native 写回 asar 并丢侧车，必须中断。
      throw new Error(`重打包结果缺少 app.asar.unpacked（staging 含 native）: ${candidateAsarPath}`);
    }

    // 先完整生成候选文件，再替换旧 archive 和 sidecar；不会把上一次打包的跨平台 native 留在 unpacked。
    // 无候选侧车（staging 无可解包文件）时保留原侧车：JS 注入不改变 native，原侧车仍有效。
    if (hasCandidateUnpacked) {
      console.log("[asar-repack] step:rm-old-unpacked start");
      await rm(unpackedPath, { force: true, recursive: true });
      console.log("[asar-repack] step:rm-old-unpacked done");
      await rename(candidateUnpackedPath, unpackedPath);
    }
    await rm(appAsarPath, { force: true });
    await rename(candidateAsarPath, appAsarPath);
    console.log("[asar-repack] step:swap done");
  } finally {
    await Promise.all([
      rm(candidateAsarPath, { force: true, recursive: true }),
      rm(candidateUnpackedPath, { force: true, recursive: true }),
    ]);
    console.log("[asar-repack] step:rm-final done");
  }
}
