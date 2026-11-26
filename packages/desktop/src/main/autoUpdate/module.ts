/**
 * client-update-runtime 模块清单（architecture-governance managed 模块）。
 * 层：adapters（electron-updater / 设置持久化 IO）。修改 requires 时同步更新 architecture-policy.yaml。
 */
export const clientUpdateRuntimeModule = {
  id: "client-update-runtime",
  // client-update-contract：updateMirror.ts 从
  // `@raspberrycode/shared/client-update` 取默认镜像前缀（DEFAULT_UPDATE_MIRROR_PREFIX），
  // 这是 client-update-contract 的公共入口，不是 shared 的默认入口，必须显式声明。
  requires: ["desktop", "shared", "client-update-contract"],
  provides: ["client-update-runtime"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
