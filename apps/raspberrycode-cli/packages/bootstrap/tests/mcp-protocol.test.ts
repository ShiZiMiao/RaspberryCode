import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpPort } from "@raspberrycode/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  raspberrycodeMcpListResultSchema,
  raspberrycodeMcpListParamsSchema,
  raspberrycodeProtocolMethods,
  raspberrycodeProtocolSessionMethodContracts,
} from "@raspberrycode/shared";
import { listMcpServers } from "../src/raspberrycode-protocol/mcp.js";
import type { RaspberryCodeProtocolAgentServerContext } from "../src/raspberrycode-protocol/server-types.js";

describe("mcp protocol contracts", () => {
  it("registers mcp/list", () => {
    expect(raspberrycodeProtocolMethods.mcpList).toBe("mcp/list");
    expect(raspberrycodeProtocolSessionMethodContracts[raspberrycodeProtocolMethods.mcpList]).toBeDefined();
  });

  it("parses an MCP status snapshot", () => {
    const parsed = raspberrycodeMcpListResultSchema.parse({
      statuses: {
        filesystem: {
          status: "disconnected",
          transport: "stdio",
          toolCount: 0,
          updatedAt: "2026-06-23T00:00:00.000Z",
        },
      },
    });

    expect(parsed.statuses.filesystem?.status).toBe("disconnected");
  });

  it("defaults mcp/list mode to connect and accepts status-only mode", () => {
    expect(
      raspberrycodeMcpListParamsSchema.parse({
        workspace: {
          workspaceKey: "/tmp/project",
          workspacePath: "/tmp/project",
        },
      }).mode,
    ).toBe("connect");

    expect(
      raspberrycodeMcpListParamsSchema.parse({
        workspace: {
          workspaceKey: "/tmp/project",
          workspacePath: "/tmp/project",
        },
        mode: "status",
      }).mode,
    ).toBe("status");
  });

  it("rejects invalid MCP status values", () => {
    expect(() =>
      raspberrycodeMcpListResultSchema.parse({
        statuses: {
          broken: {
            status: "unknown",
            transport: "stdio",
            toolCount: 0,
            updatedAt: "2026-06-23T00:00:00.000Z",
          },
        },
      }),
    ).toThrow();
  });

  it("parses HTTP MCP OAuth client credentials in protocol params", () => {
    const parsed = raspberrycodeMcpListParamsSchema.parse({
      workspace: {
        workspaceKey: "/tmp/project",
        workspacePath: "/tmp/project",
      },
      mcpServers: [
        {
          name: "protected",
          type: "http",
          url: "https://mcp.example.test/mcp",
          headers: [],
          oauth: {
            type: "client_credentials",
            clientId: "raspberrycode-client",
            clientSecret: "secret",
            scope: "mcp:tools",
          },
        },
      ],
    });

    expect(parsed.mcpServers?.[0]).toMatchObject({
      name: "protected",
      oauth: {
        type: "client_credentials",
        clientId: "raspberrycode-client",
      },
    });
  });

  it("parses HTTP MCP OAuth authorization code in protocol params", () => {
    const parsed = raspberrycodeMcpListParamsSchema.parse({
      workspace: {
        workspaceKey: "/tmp/project",
        workspacePath: "/tmp/project",
      },
      mcpServers: [
        {
          name: "figma",
          type: "http",
          url: "https://mcp.figma.com/mcp",
          headers: [],
          oauth: {
            type: "authorization_code",
            clientName: "RaspberryCode",
            redirectPath: "/oauth/callback/mcp/figma",
            scope: "mcp:connect",
          },
        },
      ],
    });

    expect(parsed.mcpServers?.[0]).toMatchObject({
      name: "figma",
      oauth: {
        type: "authorization_code",
        clientName: "RaspberryCode",
        redirectPath: "/oauth/callback/mcp/figma",
        scope: "mcp:connect",
      },
    });
  });
});

// Bugfix 回归：设置页刷新的 mcp/list 必须带 revalidate，否则进程级 `protocol-settings` lease
// 会命中连接池里的旧 entry 并回放陈旧快照（见 adapters/src/mcp/pool.ts revalidateEntry）。
describe("mcp/list connection revalidation", () => {
  it("asks the pool to revalidate on the default connect mode and skips it for status mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-mcp-list-revalidate-"));
    const previousStorageDir = process.env.RASPBERRYCODE_STORAGE_DIR;
    process.env.RASPBERRYCODE_STORAGE_DIR = join(root, "cli");
    const connectConfiguredServers = vi.fn(async () => ({ statuses: {}, tools: [] }));
    const status = vi.fn(async () => ({}));
    const mcpPort = {
      callTool: vi.fn(),
      close: vi.fn(async () => undefined),
      connectConfiguredServers,
      connectServer: vi.fn(),
      disconnectServer: vi.fn(),
      listTools: vi.fn(async () => []),
      status,
    } as unknown as McpPort;
    const context = {
      deps: { env: process.env, mcpPort },
    } as unknown as RaspberryCodeProtocolAgentServerContext;
    const params = {
      mcpServers: [],
      workspace: { workspaceKey: root, workspacePath: root },
    };

    try {
      await listMcpServers(context, params);
      expect(connectConfiguredServers).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ revalidate: true }),
      );

      connectConfiguredServers.mockClear();
      await listMcpServers(context, { ...params, mode: "status" });
      expect(connectConfiguredServers).not.toHaveBeenCalled();
    } finally {
      if (previousStorageDir === undefined) delete process.env.RASPBERRYCODE_STORAGE_DIR;
      else process.env.RASPBERRYCODE_STORAGE_DIR = previousStorageDir;
      await rm(root, { force: true, recursive: true });
    }
  });
});
