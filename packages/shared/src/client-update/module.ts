/**
 * client-update-contract 模块清单（architecture-governance managed 模块）。
 * 层：domain（纯类型契约，无 IO）。修改 requires 时同步更新 architecture-policy.yaml。
 */
export const clientUpdateContractModule = {
  id: "client-update-contract",
  requires: [],
  provides: ["client-update-contract"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
