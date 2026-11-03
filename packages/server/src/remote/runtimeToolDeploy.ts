import { getRemoteRuntimeToolsForPlatform, type RemoteResourcePackageId } from "@raspberrycode/shared";
import type { IRemoteBackend, RemoteEnvironment } from "@raspberrycode/server/remote/backend.js";
import {
  resolveRemoteServerBase,
  type DeployLoggers,
  type RemoteAssetDeployOptions,
  waitForClose,
} from "@raspberrycode/server/remote/deployShared.js";
import type { RemoteAssetInstaller } from "@raspberrycode/server/remote/remoteAssetInstaller.js";
import { buildWriteLiteralFileCommand } from "@raspberrycode/server/remote/posixShell.js";

function remoteToolsBase(serverBase: string): string {
  return `${serverBase}/tools`;
}

export interface DeployRuntimeToolOptions extends RemoteAssetDeployOptions {
  platformArch: string;
  installer: RemoteAssetInstaller;
  selectedResourcePackageIds?: RemoteResourcePackageId[];
}

export async function deployRuntimeTools(
  backend: IRemoteBackend,
  env: RemoteEnvironment,
  options: DeployRuntimeToolOptions,
  loggers: DeployLoggers,
): Promise<void> {
  const platformArch = options.platformArch;
  const serverBase = options.serverBase ?? (await resolveRemoteServerBase(backend));

  for (const { toolId, runtime, version } of getRemoteRuntimeToolsForPlatform(env.platform)) {
    const componentId = runtime.bundledResourceDir as RemoteResourcePackageId;
    if (
      options.selectedResourcePackageIds &&
      !options.selectedResourcePackageIds.includes(componentId)
    ) {
      loggers.log(`[tool-deploy] ${toolId}: 未选择资源包 ${componentId}，跳过检查和部署`);
      continue;
    }

    const entrySegments = runtime.resolveEntrySegments(env.platform);
    const binaryName = entrySegments[entrySegments.length - 1];
    if (!binaryName) {
      loggers.logWarn(`[tool-deploy] ${toolId}: 无法解析 binary 名称，跳过部署`);
      continue;
    }

    const remoteToolDir = `${remoteToolsBase(serverBase)}/${runtime.bundledResourceDir}`;
    const remoteVersionFile = `${remoteToolDir}/.version`;
    const remoteBinaryPath = `${remoteToolDir}/${binaryName}`;

    let remoteVersion = "";
    try {
      remoteVersion = (await backend.readFile(remoteVersionFile)).trim();
    } catch {
      remoteVersion = "";
    }

    if (remoteVersion === version) {
      const hasRemoteBinary = await backend.exists(remoteBinaryPath);
      if (hasRemoteBinary) {
        loggers.log(`[tool-deploy] ${toolId}: 远程版本 ${version} 已是最新，跳过`);
        continue;
      }
      loggers.logWarn(
        `[remote-assets] ${options.installer.mode === "remote-download" ? "download required" : "upload required"}: component=${runtime.bundledResourceDir} reason=remote binary missing path=${remoteBinaryPath}`,
      );
    }

    loggers.log(`[tool-deploy] ${toolId}: 开始部署 ${version}`);
    await options.installer.installFile({
      componentId,
      sourceRelativePath: `tools/${platformArch}/${runtime.bundledResourceDir}/${binaryName}`,
      remotePath: remoteBinaryPath,
      executable: true,
    });

    const versionStream = await backend.exec(
      buildWriteLiteralFileCommand(remoteVersionFile, version),
    );
    await waitForClose(versionStream);
    loggers.log(`[tool-deploy] ${toolId}: 部署完成 ${version}`);
  }
}
