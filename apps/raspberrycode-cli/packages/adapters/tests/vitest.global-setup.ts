// WorkBuddy 环境会经 NODE_OPTIONS 注入 node-safe-delete-shim（删除护栏）：超过删除计数
// 阈值后拦截 rm 并抛 SAFE_DELETE_BULK_CONFIRM_REQUIRED，导致单测清理临时夹具时假失败。
// 单测只删除自己创建的临时目录，属安全场景；shim 在进程启动时读取开关，必须在
// worker/子进程派生前设置（globalSetup 先于 worker 启动执行，env 会被继承）。
// 作用域仅限测试进程树。与根仓库 vitest.global-setup.ts 同一语义。
export function setup(): void {
  process.env.CODEBUDDY_SAFE_DELETE_ENABLED = "0";
}
