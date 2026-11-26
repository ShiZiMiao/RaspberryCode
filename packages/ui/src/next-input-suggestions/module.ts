/**
 * next-input-suggestions 模块清单（architecture-governance managed 模块）。
 * 层：ui。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const nextInputSuggestionsModule = {
  id: "next-input-suggestions",
  // 服务访问经 ui 模块内的 `@/hooks/useWorkspaceServices` 中转，因此只依赖 shared 与 ui；
  // 直接 import `@raspberrycode/services` 实现会违反深导入规则。
  requires: ["shared", "ui"],
  provides: ["next-input-suggestions"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
