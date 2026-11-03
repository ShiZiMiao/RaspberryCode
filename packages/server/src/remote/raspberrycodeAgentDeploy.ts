import {
  RASPBERRYCODE_AGENT_RUNTIME,
  RASPBERRYCODE_AGENT_PROVIDER,
  type RemoteResourcePackageId,
} from "@raspberrycode/shared";
import type { IRemoteBackend, RemoteEnvironment } from "@raspberrycode/server/remote/backend.js";
import {
  resolveRemoteServerBase,
  type DeployLoggers,
  type RemoteAssetDeployOptions,
  waitForClose,
} from "@raspberrycode/server/remote/deployShared.js";
import type { RemoteAssetInstaller } from "@raspberrycode/server/remote/remoteAssetInstaller.js";
import { buildWriteLiteralFileCommand } from "@raspberrycode/server/remote/posixShell.js";
import { deployDevelopmentRaspberryCodeAgentRuntime } from "@raspberrycode/server/remote/raspberrycodeAgentDevDeploy.js";
import {
  buildRemoteAgentBundleWrapper,
  isRemoteAgentBundleWrapperCurrent,
  REMOTE_AGENT_BUNDLE_NAME,
} from "@raspberrycode/server/remote/raspberrycodeAgentBundleWrapper.js";
import {
  deployRemoteAgentWrapper,
  isWslBackend,
} from "@raspberrycode/server/remote/raspberrycodeAgentWrapperDeploy.js";
import {
  buildRemoteAgentOfficialPluginDir,
  buildRemoteAgentOfficialPluginRequiredPaths,
  buildRemoteAgentOfficialPluginSourceRelativePath,
  REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS,
} from "@raspberrycode/server/remote/raspberrycodeAgentOfficialPluginAssets.js";
import { repairLegacyRemoteOfficialPluginDirectoryPermissions } from "@raspberrycode/server/remote/raspberrycodeAgentOfficialPluginPermissionRepair.js";
import {
  checkRemoteAssetComponentIdentity,
  writeRemoteAssetComponentMeta,
} from "@raspberrycode/server/remote/remoteAssetLiveIdentity.js";

function remoteAgentRuntimeBase(serverBase: string): string {
  return `${serverBase}/agents`;
}

export interface DeployRaspberryCodeAgentRuntimeOptions extends RemoteAssetDeployOptions {
  platformArch: string;
  installer: RemoteAssetInstaller;
  selectedResourcePackageIds?: RemoteResourcePackageId[];
  force?: boolean;
}

function isSelectedRaspberryCodeAgentComponent(
  componentId: string,
  selectedResourcePackageIds: readonly RemoteResourcePackageId[] | undefined,
): boolean {
  return (
    !selectedResourcePackageIds ||
    selectedResourcePackageIds.includes(componentId as RemoteResourcePackageId)
  );
}

async function shouldSkipRaspberryCodeAgentDeploy(params: {
  backend: IRemoteBackend;
  remoteBinaryPath: string;
  remoteBundlePath: string;
  runtimeResourceDir: string;
  serverRoot: string;
  expectedArtifactSha256: string | null;
  componentId: string;
  platformArch: string;
  force: boolean;
  missingOfficialPluginAssetPaths: string[];
  installer: RemoteAssetInstaller;
  loggers: DeployLoggers;
}): Promise<boolean> {
  if (params.force) {
    return false;
  }

  if (!params.expectedArtifactSha256) {
    params.loggers.logWarn(
      `[remote-assets] ${params.installer.mode === "remote-download" ? "download required" : "upload required"}: component=${params.componentId} reason=manifest SHA unavailable`,
    );
    return false;
  }

  const identityDecision = await checkRemoteAssetComponentIdentity(params.backend, {
    componentId: params.componentId,
    platformArch: params.platformArch,
    expectedIdentity: { sha256: params.expectedArtifactSha256 },
  });
  if (identityDecision.shouldDeploy) {
    params.loggers.logWarn(
      `[remote-assets] ${params.installer.mode === "remote-download" ? "download required" : "upload required"}: component=${params.componentId} reason=${identityDecision.reason}`,
    );
    return false;
  }

  if (!(await params.backend.exists(params.remoteBinaryPath))) {
    params.loggers.logWarn(
      `[remote-assets] ${params.installer.mode === "remote-download" ? "download required" : "upload required"}: component=${params.componentId} reason=remote wrapper missing path=${params.remoteBinaryPath}`,
    );
    return false;
  }

  if (isWslBackend(params.backend)) {
    try {
      const remoteWrapper = await params.backend.readFile(params.remoteBinaryPath);
      if (
        !isRemoteAgentBundleWrapperCurrent(
          remoteWrapper,
          params.runtimeResourceDir,
          params.serverRoot,
        )
      ) {
        params.loggers.logWarn(
          `[remote-assets] ${params.installer.mode === "remote-download" ? "download required" : "upload required"}: component=${params.componentId} reason=wsl wrapper stale path=${params.remoteBinaryPath}`,
        );
        return false;
      }
    } catch {
      return false;
    }
  }

  // wrapper 在、但 raspberrycode.cjs 缺失（被清理 / 旧原生二进制部署残留）时也要重新部署。
  if (!(await params.backend.exists(params.remoteBundlePath))) {
    params.loggers.logWarn(
      `[remote-assets] ${params.installer.mode === "remote-download" ? "download required" : "upload required"}: component=${params.componentId} reason=remote bundle missing path=${params.remoteBundlePath}`,
    );
    return false;
  }

  if (params.missingOfficialPluginAssetPaths.length > 0) {
    params.loggers.logWarn(
      `[remote-assets] ${params.installer.mode === "remote-download" ? "download required" : "upload required"}: component=${params.componentId} reason=official plugin assets missing paths=${params.missingOfficialPluginAssetPaths.join(",")}`,
    );
    return false;
  }

  params.loggers.log(
    `[raspberrycode-agent-deploy] ${RASPBERRYCODE_AGENT_PROVIDER}: 制品 SHA ${params.expectedArtifactSha256} 已部署，跳过`,
  );
  return true;
}

async function findMissingRemoteOfficialPluginAssetPaths(
  backend: IRemoteBackend,
  remoteProviderDir: string,
): Promise<string[]> {
  const missingPaths: string[] = [];
  for (const remotePath of buildRemoteAgentOfficialPluginRequiredPaths(remoteProviderDir)) {
    if (!(await backend.exists(remotePath))) {
      missingPaths.push(remotePath);
    }
  }
  return missingPaths;
}

/**
 * 部署 RaspberryCode Agent runtime 到远程机器。
 *
 * 生产态只用 manifest SHA 判断制品是否变化；语义版本不参与跳过决策。
 */
export async function deployRaspberryCodeAgentRuntime(
  backend: IRemoteBackend,
  env: RemoteEnvironment,
  options: DeployRaspberryCodeAgentRuntimeOptions,
  loggers: DeployLoggers,
): Promise<void> {
  const provider = RASPBERRYCODE_AGENT_PROVIDER;
  const runtime = RASPBERRYCODE_AGENT_RUNTIME;
  const componentId = provider;
  if (!isSelectedRaspberryCodeAgentComponent(componentId, options.selectedResourcePackageIds)) {
    loggers.log(`[raspberrycode-agent-deploy] ${provider}: 未选择资源包 ${componentId}，跳过检查和部署`);
    return;
  }

  // binaryName 指 wrapper 可执行文件名（如 raspberrycode-agent / raspberrycode-agent.exe）——
  // 一个调用远端 node 执行 raspberrycode.cjs 的壳脚本。
  const binaryName = runtime.resolveEntrySegments(env.platform).at(-1);
  if (!binaryName) {
    loggers.logWarn(`[raspberrycode-agent-deploy] ${provider}: 无法解析 agent 入口名称，跳过部署`);
    return;
  }

  const serverBase = options.serverBase ?? (await resolveRemoteServerBase(backend));
  const remoteProviderDir = `${remoteAgentRuntimeBase(serverBase)}/${runtime.bundledResourceDir}`;
  const remoteVersionFile = `${remoteProviderDir}/.version`;
  const remoteBinaryPath = `${remoteProviderDir}/${binaryName}`;
  const remoteBundlePath = `${remoteProviderDir}/${REMOTE_AGENT_BUNDLE_NAME}`;
  const remoteOfficialPluginDir = buildRemoteAgentOfficialPluginDir(remoteProviderDir);
  const missingOfficialPluginAssetPaths = await findMissingRemoteOfficialPluginAssetPaths(
    backend,
    remoteProviderDir,
  );

  if (
    await deployDevelopmentRaspberryCodeAgentRuntime(
      backend,
      {
        runtimeVersion: runtime.version,
        runtimeResourceDir: runtime.bundledResourceDir,
        serverRoot: serverBase,
        remoteProviderDir,
        remoteVersionFile,
        remoteBinaryPath,
        force: Boolean(options.force),
      },
      loggers,
    )
  ) {
    return;
  }

  let expectedArtifactSha256: string | null = null;
  try {
    expectedArtifactSha256 =
      (await options.installer.resolveComponentSha256?.(componentId)) ?? null;
  } catch (error) {
    loggers.logWarn(
      `[raspberrycode-agent-deploy] ${provider}: 读取 manifest SHA 失败，将重新部署: ${String(error)}`,
    );
  }

  if (
    await shouldSkipRaspberryCodeAgentDeploy({
      backend,
      remoteBinaryPath,
      remoteBundlePath,
      runtimeResourceDir: runtime.bundledResourceDir,
      serverRoot: serverBase,
      expectedArtifactSha256,
      componentId,
      platformArch: options.platformArch,
      force: Boolean(options.force),
      missingOfficialPluginAssetPaths,
      installer: options.installer,
      loggers,
    })
  ) {
    return;
  }

  loggers.log(`[raspberrycode-agent-deploy] ${provider}: 开始部署 v${runtime.version}...`);
  // 缺少远端 plugin 只表示安装不完整，不等于 App 版本变化。
  // 同 App 版本修复 plugin 时应复用已校验的组件 cache；只有强制部署边界才重新下载制品。
  const forceRefreshRuntimeAsset = Boolean(options.force);
  const permissionRepairSucceeded = await repairLegacyRemoteOfficialPluginDirectoryPermissions({
    backend,
    loggers,
    remoteOfficialPluginDir,
  });
  const installBundle = () =>
    options.installer.installFile({
      componentId,
      sourceRelativePath: `${runtime.bundledResourceDir}/${options.platformArch}/${REMOTE_AGENT_BUNDLE_NAME}`,
      remotePath: remoteBundlePath,
      executable: false,
      forceRefresh: forceRefreshRuntimeAsset,
    });
  const installOfficialPluginPackages = () =>
    options.installer.installDirectory({
      componentId,
      sourceRelativePath: buildRemoteAgentOfficialPluginSourceRelativePath({
        runtimeResourceDir: runtime.bundledResourceDir,
        platformArch: options.platformArch,
      }),
      remoteDir: remoteOfficialPluginDir,
      requiredRelativePaths: [...REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS],
      forceRefresh: forceRefreshRuntimeAsset,
    });

  if (permissionRepairSucceeded) {
    // 1) 正常路径保持原部署顺序，避免改变健康 SSH / Docker / WSL 的时序语义。
    await installBundle();
    // 2) 安装随 agent bundle 发布的官方插件源资源，供远端 agent bootstrap seed builtin plugin。
    await installOfficialPluginPackages();
  } else {
    // 1) chmod 失败时先验证 packages 可替换，避免 bundle 已更新但旧 packages 删除失败。
    await installOfficialPluginPackages();
    // 2) packages 替换成功后再安装编译产物 raspberrycode.cjs（跨平台同一份，agent 组件里就是它）。
    await installBundle();
  }
  // 3) 写入 wrapper（即 resolver 期望的 raspberrycode-agent），用远端已部署的 node 执行 raspberrycode.cjs。
  await deployRemoteAgentWrapper({
    backend,
    content: buildRemoteAgentBundleWrapper(runtime.bundledResourceDir, serverBase),
    remoteWrapperPath: remoteBinaryPath,
  });

  const versionStream = await backend.exec(
    buildWriteLiteralFileCommand(remoteVersionFile, runtime.version),
  );
  await waitForClose(versionStream);
  if (expectedArtifactSha256) {
    // Agent 的语义版本可能不变但制品内容已更新，必须把 manifest SHA
    // 写入远端 live marker，下一次连接才能按真实制品身份决定是否重部署。
    await writeRemoteAssetComponentMeta(backend, {
      id: componentId,
      version: runtime.version,
      sha256: expectedArtifactSha256,
      platformArch: options.platformArch,
    });
  }
  loggers.log(`[raspberrycode-agent-deploy] ${provider}: 部署完成 v${runtime.version}`);
}
