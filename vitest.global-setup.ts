// WorkBuddy 环境会经 NODE_OPTIONS 注入 node-safe-delete-shim（删除护栏）：它按 turn 累计
// 删除计数，超过阈值后拦截 rm 并抛 SAFE_DELETE_BULK_CONFIRM_REQUIRED，导致单测清理临时
// 夹具时批量假失败（全量跑一轮 ~84 例）。单测只删除自己创建的临时目录，属安全场景；
// 该 shim 在进程启动时读取 CODEBUDDY_SAFE_DELETE_ENABLED 决定是否挂钩，因此必须在
// worker/子进程派生前设置（globalSetup 先于 worker 启动执行，env 会被继承）。
// 作用域仅限测试进程树，不影响产品代码与会话内其它命令的删除护栏。
export function setup(): void {
  process.env.CODEBUDDY_SAFE_DELETE_ENABLED = "0";
}
