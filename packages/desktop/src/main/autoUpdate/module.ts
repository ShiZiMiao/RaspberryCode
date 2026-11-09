/**
 * client-update-runtime 模块清单（architecture-governance managed 模块）。
 * 层：adapters（electron-updater / 设置持久化 IO）。修改 requires 时同步更新 architecture-policy.yaml。
 */
export const clientUpdateRuntimeModule = {
  id: "client-update-runtime",
  requires: ["desktop", "shared"],
  provides: ["client-update-runtime"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
