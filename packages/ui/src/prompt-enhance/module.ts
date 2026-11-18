/**
 * prompt-enhance 模块清单（architecture-governance managed 模块）。
 * 层：ui。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const promptEnhanceModule = {
  id: "prompt-enhance",
  // 只依赖 ui：按钮/提示/服务访问都走 ui 模块内的既有入口
  // （`@/components/ui/*`、`@/ControlHintTooltip`、`@/hooks/useServices`）。
  // 直接 import `@raspberrycode/services` 实现会违反深导入规则。
  requires: ["ui"],
  provides: ["prompt-enhance"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
