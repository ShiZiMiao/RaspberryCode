import { ChannelClient, ChannelServer, createQueuePair, ProxyChannel } from "@raspberrycode/rpc";
import { describe, expect, it } from "vitest";
import { IRaspberryCodeAgentService } from "#src/raspberrycode-agent/raspberrycodeAgent.js";
import {
  RASPBERRYCODE_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE,
  RaspberryCodeAgentMcpStatusModeUnsupportedError,
} from "#src/raspberrycode-agent/raspberrycodeAgentErrors.js";

describe("RaspberryCode Agent RPC errors", () => {
  it("preserves the MCP status-only unsupported code across ChannelClient RPC", async () => {
    const [serverProtocol, clientProtocol] = createQueuePair();
    const server = new ChannelServer(serverProtocol, "test");
    const client = new ChannelClient(clientProtocol);
    server.registerChannel(
      IRaspberryCodeAgentService.channelName,
      ProxyChannel.fromService({
        async listMcpServerStatuses() {
          throw new RaspberryCodeAgentMcpStatusModeUnsupportedError();
        },
      }),
    );
    const service = ProxyChannel.toService<IRaspberryCodeAgentService>(
      client.getChannel(IRaspberryCodeAgentService.channelName),
    );

    try {
      await expect(
        service.listMcpServerStatuses({
          mcpServers: [],
          mode: "status",
          workspacePath: "/tmp/workspace",
        }),
      ).rejects.toMatchObject({
        code: RASPBERRYCODE_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE,
        name: "RaspberryCodeAgentMcpStatusModeUnsupportedError",
      });
    } finally {
      client.dispose();
      server.dispose();
    }
  });
});
