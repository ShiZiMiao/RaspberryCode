import type { McpServerStatus, RaspberryCodeMcpServer, RaspberryCodeMcpServerStatusSnapshot } from "@raspberrycode/shared";

type MappedMcpServerStatus = {
  authorization?: RaspberryCodeMcpServerStatusSnapshot["authorization"];
  error?: string;
  failureKind?: RaspberryCodeMcpServerStatusSnapshot["failureKind"];
  serverRequestId?: string;
  status: McpServerStatus;
};

function mapRuntimeStatusToUi(snapshot: RaspberryCodeMcpServerStatusSnapshot): MappedMcpServerStatus {
  switch (snapshot.status) {
    case "connected":
    case "connecting":
      return {
        authorization: snapshot.authorization,
        status: snapshot.status,
      };
    case "disconnected":
      return {
        authorization: snapshot.authorization,
        status: snapshot.status,
        error: snapshot.error,
        failureKind: snapshot.failureKind,
        serverRequestId: snapshot.serverRequestId,
      };
    case "failed":
      return {
        status: "error",
        error: snapshot.error,
        failureKind: snapshot.failureKind ?? "connection_failed",
        serverRequestId: snapshot.serverRequestId,
      };
    case "disabled":
      return { status: "unknown", error: snapshot.error };
    case "untrusted":
      // 未授权是明确状态，不能降为状态未知或提示用户重启 Agent。
      return { status: "untrusted" };
  }
}

export function mergeMcpServerStatusSnapshots(
  servers: RaspberryCodeMcpServer[],
  statuses: Record<string, RaspberryCodeMcpServerStatusSnapshot>,
  options: { markMissingConnectingAsError?: boolean } = {},
): RaspberryCodeMcpServer[] {
  const markMissingConnectingAsError = options.markMissingConnectingAsError ?? true;
  return servers.map((server) => {
    if (server.source !== "raspberrycodeagentmcp") {
      return server;
    }
    const snapshot = statuses[server.name];
    if (!snapshot) {
      if (markMissingConnectingAsError && server.enabled && server.status === "connecting") {
        return {
          ...server,
          // mcp/list 正常返回但缺少当前行时，继续保留 connecting 会让设置页无限转圈。
          status: "error",
          failureKind: "status_unavailable",
          toolCount: undefined,
        };
      }
      return server;
    }
    const mapped = mapRuntimeStatusToUi(snapshot);
    return {
      ...server,
      status: mapped.status,
      authorization: mapped.authorization,
      error: mapped.error,
      failureKind: mapped.failureKind,
      serverRequestId: mapped.serverRequestId,
      toolCount: snapshot.toolCount,
      workspaceTrust: server.scope === "workspace" ? snapshot.workspaceTrust : undefined,
      changed: false,
      lastConnected:
        mapped.status === "connected" ? new Date(snapshot.updatedAt) : server.lastConnected,
    };
  });
}
