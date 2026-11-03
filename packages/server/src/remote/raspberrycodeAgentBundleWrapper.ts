// 远端 RaspberryCode Agent 以「独立 node + 编译产物 raspberrycode.cjs」的形态运行，而不是各平台内嵌 node 的原生二进制。
// 远端部署时本来就有一份独立 node（用于跑 raspberrycode-server.cjs），agent 复用它执行 raspberrycode.cjs 即可。
//
// 部署布局：把 raspberrycode.cjs 放到 agents/<provider>/raspberrycode.cjs，再写一个同名 wrapper —— 就是 resolver
// 期望找到的可执行入口（如 agents/agent/raspberrycode-agent）—— 由它用远端 node 执行 raspberrycode.cjs。
// 这样 provider runtime resolver 不需要区分原生/JS，照旧找 raspberrycode-agent 这个可执行文件即可。
// 开发态与生产态共用同一份 wrapper 语义。
//
// serverRoot 参数是部署侧解析出的远端 server 根（新装 ~/.raspberrycode/server，旧布局机器
// ~/.raspberrycode/server，见 deployShared.resolveRemoteServerBase）。wrapper 是持久文件，
// 必须写入该机器实际使用的根；旧布局机器上的旧 wrapper 也因此持续可用（保留旧名读取）。

export const REMOTE_AGENT_BUNDLE_NAME = "raspberrycode.cjs";

function toShellRoot(serverRoot: string): string {
  return serverRoot.replace(/^~\//u, "$HOME/");
}

export function buildRemoteAgentBundleWrapper(
  runtimeResourceDir: string,
  serverRoot: string,
): string {
  const root = toShellRoot(serverRoot);
  return [
    "#!/bin/sh",
    "set -eu",
    `runtime_root="\${RASPBERRYCODE_SERVER_RUNTIME_ROOT:-${root}}"`,
    `exec "$runtime_root/node" "${root}/agents/${runtimeResourceDir}/${REMOTE_AGENT_BUNDLE_NAME}" "$@"`,
    "",
  ].join("\n");
}

export function isRemoteAgentBundleWrapperCurrent(
  content: string,
  runtimeResourceDir: string,
  serverRoot: string,
): boolean {
  return (
    content.replace(/\r\n/g, "\n") === buildRemoteAgentBundleWrapper(runtimeResourceDir, serverRoot)
  );
}
