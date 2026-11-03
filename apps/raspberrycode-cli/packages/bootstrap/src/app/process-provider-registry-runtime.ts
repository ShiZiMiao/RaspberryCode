import {
  NodeModelSelectionConfigRepository,
  NodeProviderRegistryRuntime,
  resolveNodeProviderRuntimePaths,
  downloadRaspberryCodeBuiltinRelease,
  resolveRaspberryCodeBuiltinClientPlatform,
  RASPBERRYCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV,
  type RaspberryCodeBuiltinRefreshEvent,
} from "@raspberrycode/provider-node";
import { resolveRuntimeRaspberryCodeEndpointOrigin, RASPBERRYCODE_VERSION } from "@raspberrycode/shared";
import { dirname, join } from "node:path";
import { readLegacyCliPersonalProviderConfig } from "./legacy-cli-personal-provider-config-importer.js";

export interface ProcessProviderRegistryRuntimeOptions {
  /** Standalone Prompt CLI / TUI 自己拥有旧配置的一次性导入与 Built-in 刷新观测。 */
  readonly standalone?: {
    readonly legacyCliUserConfigFilePath?: string;
    readonly request?: typeof fetch;
    readonly onBuiltinRefreshError?: (error: unknown) => void;
    readonly onBuiltinRefreshResult?: (event: RaspberryCodeBuiltinRefreshEvent) => void;
  };
}

export async function startProcessProviderRegistryRuntime(
  env: Readonly<Record<string, string | undefined>>,
  options: ProcessProviderRegistryRuntimeOptions = {},
) {
  const paths = resolveNodeProviderRuntimePaths(env);
  if (!paths) {
    throw new Error("缺少进程 Provider Registry 的 RaspberryCode Built-in / Personal Config 路径");
  }

  const bundledFile = options.standalone
    ? env[RASPBERRYCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV]?.trim()
    : undefined;
  const runtime = new NodeProviderRegistryRuntime({
    ...paths,
    ...(bundledFile
      ? {
          raspberrycodeBuiltinFilePath: bundledFile,
          raspberrycodeBuiltinActiveFilePath: paths.raspberrycodeBuiltinFilePath,
          raspberrycodeBuiltinRemote: {
            controlFilePath: join(
              dirname(paths.raspberrycodeBuiltinFilePath),
              "raspberrycode-builtin-refresh.json",
            ),
            resolveEndpointKey: () => resolveRuntimeRaspberryCodeEndpointOrigin(env),
            fetchRelease: (endpointOrigin, signal) =>
              downloadRaspberryCodeBuiltinRelease({
                endpointOrigin,
                signal,
                appVersion: RASPBERRYCODE_VERSION,
                platform: resolveRaspberryCodeBuiltinClientPlatform(),
                request: options.standalone?.request ?? globalThis.fetch,
              }),
            onRefreshResult: options.standalone?.onBuiltinRefreshResult,
          },
        }
      : {}),
    onRaspberryCodeBuiltinRefreshError: options.standalone?.onBuiltinRefreshError,
    ...(options.standalone
      ? {
          importLegacy: () =>
            readLegacyCliPersonalProviderConfig({
              ...(options.standalone?.legacyCliUserConfigFilePath
                ? { filePath: options.standalone.legacyCliUserConfigFilePath }
                : {}),
            }),
        }
      : {}),
  });
  try {
    await runtime.start();
    const snapshot = runtime.registryService.getSnapshot()!;
    const modelSelectionConfigRepository = new NodeModelSelectionConfigRepository({
      personalRepository: runtime.personalRepository,
    });
    try {
      const configuredDefaultModelSelection = await modelSelectionConfigRepository.read();
      return Object.freeze({
        dispose() {
          modelSelectionConfigRepository.dispose();
          runtime.dispose();
        },
        runtime,
        snapshot,
        modelSelectionConfigRepository,
        configuredDefaultModelSelection,
      });
    } catch (error) {
      modelSelectionConfigRepository.dispose();
      throw error;
    }
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}
