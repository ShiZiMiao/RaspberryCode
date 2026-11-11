// 本文件覆盖 MCP 数据同步的服务层：用户 MCP 的启用态归一（legacy enable/enabled 兼容）
// 与用户 MCP 的来源优先级。旧的候选/状态/归档服务方法已随远端同步弹窗下线移除；
// 其等价能力由 IDataSyncCategoryService（data-sync/mcpDataSync.ts）承担，
// 端到端行为见 desktop E2E 的 remote-data-sync-mcp-push。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpSyncService } from "../src/mcp-sync/mcpSyncService.js";

function makeHome() {
  return mkdtempSync(join(tmpdir(), "raspberrycode-mcp-sync-home-"));
}

async function writeRaspberrycodeUserMcp(
  home: string,
  servers: Record<string, Record<string, unknown>>,
) {
  const configPath = join(home, ".raspberrycode", "cli", "config.json");
  await mkdir(join(home, ".raspberrycode", "cli"), { recursive: true });
  await writeFile(configPath, `${JSON.stringify({ mcp: { servers } }, null, 2)}\n`);
  return configPath;
}

async function writeAgentsUserMcp(
  home: string,
  servers: Record<string, Record<string, unknown>>,
) {
  const configPath = join(home, ".agents", "mcp.json");
  await mkdir(join(home, ".agents"), { recursive: true });
  await writeFile(configPath, `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
  return configPath;
}

describe("mcp data sync service", () => {
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("lists user raspberrycode MCP servers as sync items", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await writeRaspberrycodeUserMcp(home, {
      context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
      },
    });
    const service = createMcpSyncService();

    const result = await service.listSyncItems();

    expect(result.homeDir).toBe(home);
    expect(result.items).toMatchObject([{ key: "context7", name: "context7", enabled: true }]);
  });

  it("marks a sync item disabled when only enabled:false is present", async () => {
    const home = makeHome();
    process.env.HOME = home;
    // 外部工具/手工编辑写的是 enabled:false；同步侧不能把它当成启用状态。
    await writeRaspberrycodeUserMcp(home, {
      context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        enabled: false,
      },
    });
    const service = createMcpSyncService();

    const result = await service.listSyncItems();

    expect(result.items).toMatchObject([{ name: "context7", enabled: false }]);
  });

  it("migrates a legacy enable flag to enabled when listing sync items", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await writeRaspberrycodeUserMcp(home, {
      context7: {
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        enable: false,
      },
    });
    const service = createMcpSyncService();

    const result = await service.listSyncItems();

    expect(result.items).toMatchObject([{ name: "context7", enabled: false }]);
  });

  it("keeps a sync item disabled when legacy enable:false collides with enabled:true", async () => {
    const home = makeHome();
    process.env.HOME = home;
    // 两个字段并存且矛盾时，保守判定为禁用：宁可少推也不要误开远端服务。
    await writeRaspberrycodeUserMcp(home, {
      context7: {
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        enable: false,
        enabled: true,
      },
    });
    const service = createMcpSyncService();

    const result = await service.listSyncItems();

    expect(result.items).toMatchObject([{ name: "context7", enabled: false }]);
  });

  it("leaves the config file untouched when no legacy enable flag exists", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const configPath = await writeRaspberrycodeUserMcp(home, {
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
    });
    const before = await readFile(configPath, "utf-8");
    const service = createMcpSyncService();

    await service.listSyncItems();

    await expect(readFile(configPath, "utf-8")).resolves.toBe(before);
  });

  it("falls back to user agents MCP servers when raspberrycode user MCP is empty", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await writeAgentsUserMcp(home, {
      "agents-only": { command: "node", args: ["server.js"] },
    });
    const service = createMcpSyncService();

    const result = await service.listSyncItems();

    expect(result.items).toMatchObject([{ name: "agents-only" }]);
  });

  it("loads and saves user MCP through the service on the current host", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const service = createMcpSyncService();

    await service.saveMcpToUserDirectory({
      servers: { context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] } },
    });
    const loaded = await service.loadMcpFromUserDirectory();

    expect(loaded.servers).toBeDefined();
  });
});
