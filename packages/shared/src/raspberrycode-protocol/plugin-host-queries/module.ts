/**
 * plugin-host-queries 模块清单（architecture-governance managed 模块）。
 * 范围：扩展进程 P2 的插件宿主查询——敏感选项私有存储与 plugins/readUserOptions（扩展进程 §16.7）、
 * plugins/mentionItems（§16.6）；线格式在本目录，CLI 侧实现在 adapters/bootstrap，App 侧客户端在 services。
 * 规格：apps/raspberrycode-cli/docs/design/v2/plugin-compat.md「Sensitive Option Storage」「Composer Mention Items」。
 * 层：app。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const pluginHostQueriesModule = {
  id: "plugin-host-queries",
  requires: ["services", "shared", "raspberrycode-cli"],
  provides: ["plugin-host-queries"],
  publicEntrypoints: [
    "contract.ts",
    "../../../../../apps/raspberrycode-cli/packages/adapters/src/config/plugin-secrets.adapter.ts",
    "../../../../../apps/raspberrycode-cli/packages/bootstrap/src/plugin-secrets.ts",
    "../../../../../apps/raspberrycode-cli/packages/bootstrap/src/raspberrycode-protocol/plugin-user-options.ts",
    "../../../../../apps/raspberrycode-cli/packages/bootstrap/src/raspberrycode-protocol/plugin-mention-items.ts",
    "../../../../services/src/raspberrycode-agent/pluginHostQueriesClient.ts",
  ],
} as const;
