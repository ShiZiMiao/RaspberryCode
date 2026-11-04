import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 仅挂全局前置（关闭 WorkBuddy 删除护栏，详见 ./vitest.global-setup.ts 注释）；其余测试行为
// 保持 vitest 默认。配置放在 tests/ 内（架构规则 unmanaged-new-file 的 test 目录豁免），
// 经 package.json test 脚本的 --config 显式引用。
export default defineConfig({
  test: {
    globalSetup: [fileURLToPath(new URL("./vitest.global-setup.ts", import.meta.url))],
  },
});
