export type ZCodeAgentBinaryKind = "native-binary";

export interface ZCodeAgentRuntimeDescriptor {
  binaryKind: ZCodeAgentBinaryKind;
  binaryEnvVar: string;
  bundledResourceDir: string;
  version: string;
  spawnArgs: string[];
  nativeConfigDir: string;
  nativeConfigFileName: string;
  missingBinaryMessage: string;
  resolveEntrySegments(platform: string): string[];
  /**
   * 桌面端把 agent 的 JS bundle（zcode.cjs）打进 resources/glm，由 app 内置的 Electron Node runtime
   * （ELECTRON_RUN_AS_NODE）直接执行，避免再随包内置一份独立 Node 二进制。
   * 这里只放纯 JS 入口文件名，平台无关（与 resolveEntrySegments 的原生二进制路径平行）。
   */
  nodeBundleEntryFile: string;
  resolveNodeBundleSegments(): string[];
}

export function resolvePlatformBinaryName(binaryName: string, platform: string): string {
  return platform === "win32" ? `${binaryName}.exe` : binaryName;
}

export const ZCODE_AGENT_RUNTIME: ZCodeAgentRuntimeDescriptor = {
  binaryKind: "native-binary",
  // 中立命名（specs/provider-neutrality.md）：历史 GLM_BINARY_PATH 由桌面端做旧名读兼容。
  binaryEnvVar: "ZCODE_AGENT_BINARY_PATH",
  // TODO(C1b)：打包资源目录仍为历史名 "glm"，改名为 "agent" 需同步打包脚本、
  // 安装资源锁与 CLI 侧 resources/<dir>/packages/*-plugin 插件 seed 路径约定。
  bundledResourceDir: "glm",
  version: "0.13.3",
  spawnArgs: ["app-server", "--stdio"],
  nativeConfigDir: ".raspberrycode/cli",
  nativeConfigFileName: "config.json",
  missingBinaryMessage:
    "[RaspberryCode Agent] agent binary 未找到，请设置 ZCODE_AGENT_WORKDIR、ZCODE_AGENT_BINARY_PATH 或先准备 Agent 运行时资源",
  resolveEntrySegments: (platform) => [resolvePlatformBinaryName("zcode-agent", platform)],
  nodeBundleEntryFile: "zcode.cjs",
  resolveNodeBundleSegments() {
    return [this.nodeBundleEntryFile];
  },
};

export function getZCodeAgentRuntime(): ZCodeAgentRuntimeDescriptor {
  return ZCODE_AGENT_RUNTIME;
}
