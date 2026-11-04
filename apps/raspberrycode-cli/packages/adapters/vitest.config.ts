import { defineConfig } from "vitest/config";

// 仅挂全局前置（关闭 WorkBuddy 删除护栏，详见根仓库 vitest.global-setup.ts 注释）；
// 其余测试行为保持 vitest 默认，不改变 `vitest tests` 的过滤语义。
export default defineConfig({
  test: {
    globalSetup: ["./vitest.global-setup.ts"],
  },
});
