/**
 * client-update-ui 模块清单（architecture-governance managed 模块）。
 * 层：ui。修改 requires 时同步更新 architecture-policy.yaml。
 */
export const clientUpdateUiModule = {
  id: "client-update-ui",
  requires: ["shared", "ui"],
  provides: ["client-update-ui"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
