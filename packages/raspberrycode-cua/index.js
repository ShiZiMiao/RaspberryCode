/**
 * 包主入口。
 *
 * 分派逻辑：
 * - 存在 `dist/runtime/index.js`（已构建）→ 用真实实现
 * - 否则 → fail-closed 占位，明确报告不可用
 *
 * 为什么保留占位回退：`dist/` 不入 git，直接从源码 checkout 的开发者可能没跑构建。
 * 此时静默失败是最糟的选择——模型会收到一堆无法解释的空结果。
 * 明确报「未构建」比报「功能不存在」更容易定位。
 */

const UNAVAILABLE_TEXT =
  "Computer Use is not available in this build. The self-hosted Windows backend requires a build step: run `pnpm build:cua`.";

/**
 * 顶层 await 加载构建产物。
 *
 * 本包是 ESM（package.json `type: module`），不能用 require；
 * 用顶层 await 可以在模块求值阶段完成加载，从而保持
 * `createComputerUseRuntime` 的同步签名（与上游一致，不改消费方）。
 */
let built;
try {
  built = await import("./dist/runtime/index.js");
} catch {
  built = undefined;
}

export function createComputerUseRuntime(options) {
  if (built && typeof built.createComputerUseRuntime === "function") {
    return built.createComputerUseRuntime(options);
  }
  return createPlaceholderRuntime();
}

function createPlaceholderRuntime() {
  return {
    async execute() {
      return {
        content: [{ type: "text", text: UNAVAILABLE_TEXT }],
        isError: true,
      };
    },
    async closeSession() {},
    async dispose() {},
  };
}
