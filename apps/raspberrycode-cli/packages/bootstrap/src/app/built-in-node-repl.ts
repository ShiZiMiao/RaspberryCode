import type { McpServerConfig, PluginLoadOutcome } from "@raspberrycode/contracts";
import { createBundledMcpRuntimeConfig } from "./official-plugin-runtime.js";
import {
  OFFICIAL_BROWSER_USE_PLUGIN_ID,
  OFFICIAL_CUA_PLUGIN_ID,
  OFFICIAL_NODE_REPL_HOST_PLUGIN_ID,
} from "./official-plugin-definitions.js";

export const BUILT_IN_NODE_REPL_SERVER_NAME = "node_repl";

/**
 * node_repl 是官方能力共用的宿主工具，不是任何插件 manifest 声明的 plugin MCP。产物由独立的
 * `node-repl-host` seed 单元携带（无 listing、不对用户露出）；Browser Use 与 Computer Use
 * 各自只贡献自己的 skill、docs 与 native 依赖 root。
 */
export function resolveBuiltInNodeReplMcpServers(input: {
  pluginOutcome: Pick<PluginLoadOutcome, "plugins">;
  workingDirectory: string;
  /**
   * 自研 Windows CUA Helper 入口绝对路径（来自 `RASPBERRYCODE_CUA_HELPER_ENTRY`）。
   * 缺省时不下发，runtime 回退到相对自身模块的 `../helper/`；插件缓存态该回退必然落空。
   */
  cuaHelperEntry?: string;
}): Record<string, McpServerConfig> {
  const browserUsePackage = input.pluginOutcome.plugins.find(
    (plugin) => plugin.id === OFFICIAL_BROWSER_USE_PLUGIN_ID && plugin.enabled,
  );
  const cuaPackage = input.pluginOutcome.plugins.find(
    (plugin) => plugin.id === OFFICIAL_CUA_PLUGIN_ID && plugin.enabled,
  );
  if (!browserUsePackage && !cuaPackage) return {};
  // 宿主自己不参与启用判断：它没有 skill、不对用户露出，缺失就意味着没有宿主可跑，
  // 必须安全地不注册，而不是回退到某个插件包里的旧产物。
  const hostPackage = input.pluginOutcome.plugins.find(
    (plugin) => plugin.id === OFFICIAL_NODE_REPL_HOST_PLUGIN_ID,
  );
  if (!hostPackage) return {};

  const nodeRepl = createBundledMcpRuntimeConfig({
    cwd: input.workingDirectory,
    env: {
      // 领域 root 各自注入，且只在对应能力启用时注入：宿主据此决定哪一半文档可用。
      ...(browserUsePackage ? { RASPBERRYCODE_PLUGIN_ROOT: browserUsePackage.rootPath } : {}),
      ...(cuaPackage ? { RASPBERRYCODE_CUA_PLUGIN_ROOT: cuaPackage.rootPath } : {}),
      // CUA Helper 入口必须显式下发（2026-11-20 真机修复）。
      //
      // Helper 是**独立子进程入口**，runtime 的解析顺序是
      // `RASPBERRYCODE_CUA_HELPER_ENTRY` → 回退 `../helper/windows-helper.js`
      // （相对自身模块，即 `dist/runtime/` 的兄弟目录）。
      //
      // 但 seed 到插件缓存的宿主只携带 `dist/mcp/server.js`，**没有 dist/helper/**，
      // 于是回退路径必然落空 → Helper `code=1` 退出 → 全方法不可用。
      // 而 Helper 的真实位置在安装目录 `resources/agent/packages/raspberrycode-cua/dist/helper/`，
      // 它不随官方插件 seed（那是 producer workspace 包，不是插件）。
      //
      // 所以只要能力启用且环境里有该路径，就必须传给 MCP 子进程 —— 这与 desktop 给
      // host 子进程注入的是同一个变量（见 desktopRuntimeEnv.ts 的
      // resolveBundledCuaHelperEntryPath）。
      ...(cuaPackage && input.cuaHelperEntry
        ? { RASPBERRYCODE_CUA_HELPER_ENTRY: input.cuaHelperEntry }
        : {}),
    },
    rootPath: hostPackage.rootPath,
    timeoutMs: 600_000,
  });
  if (!nodeRepl) return {};
  return {
    [BUILT_IN_NODE_REPL_SERVER_NAME]: {
      ...nodeRepl,
      isolation: "workspace",
      protocolVersion: "2026-07-28",
    },
  };
}
