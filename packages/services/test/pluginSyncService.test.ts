import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPluginSyncService } from "../src/plugin-sync/pluginSyncService.js";

function makeHome() {
  return mkdtempSync(join(tmpdir(), "raspberrycode-plugin-sync-home-"));
}

async function writeRaspberrycodeUserConfig(
  home: string,
  value: Record<string, unknown>,
): Promise<string> {
  const configPath = join(home, ".raspberrycode", "cli", "config.json");
  await mkdir(join(home, ".raspberrycode", "cli"), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  return configPath;
}

async function readRaspberrycodeUserConfig(home: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(home, ".raspberrycode", "cli", "config.json"), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function writeInlinePlugin(
  root: string,
  directoryName: string,
  manifest: Record<string, unknown> = {},
): Promise<string> {
  const pluginRoot = join(root, directoryName);
  await mkdir(join(pluginRoot, ".raspberrycode-plugin"), { recursive: true });
  await writeFile(
    join(pluginRoot, ".raspberrycode-plugin", "plugin.json"),
    `${JSON.stringify({
      name: directoryName,
      description: `${directoryName} description`,
      version: "1.0.0",
      ...manifest,
    }, null, 2)}\n`,
    "utf-8",
  );
  await mkdir(join(pluginRoot, "skills", "demo"), { recursive: true });
  await writeFile(join(pluginRoot, "skills", "demo", "SKILL.md"), "---\nname: demo\n---\n");
  return pluginRoot;
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
}

describe("plugin sync service", () => {
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("exports and imports a mirrored directory marketplace source", async () => {
    const localHome = makeHome();
    process.env.HOME = localHome;
    const marketplaceRoot = join(localHome, "team-market");
    await writeInlinePlugin(marketplaceRoot, "formatter", { name: "formatter" });
    await writeFile(
      join(marketplaceRoot, "marketplace.json"),
      `${JSON.stringify({
        name: "team-market",
        plugins: [
          {
            name: "formatter",
            version: "1.0.0",
            source: "./formatter",
          },
        ],
      }, null, 2)}\n`,
      "utf-8",
    );
    const localService = createPluginSyncService();

    const exported = await localService.exportMarketplaceSourceArchive({
      marketplaceId: "team-market",
      pluginNames: ["formatter"],
      source: { source: "directory", path: marketplaceRoot },
    });

    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    const remoteService = createPluginSyncService();
    const imported = await remoteService.importMarketplaceSourceArchive({
      archive: exported.archive,
      overwrite: false,
    });

    expect(imported).toMatchObject({
      marketplaceId: "team-market",
      status: "synced",
    });
    expect(imported.path.startsWith(join(remoteHome, ".raspberrycode", "plugins", "marketplace-sources"))).toBe(true);
    const mirroredManifest = await readJsonFile(join(imported.path, "marketplace.json"));
    expect(mirroredManifest).toMatchObject({
      name: "team-market",
      metadata: {
        pluginRoot: "plugins",
      },
      plugins: [
        {
          name: "formatter",
          source: "./formatter",
        },
      ],
    });
    expect(
      existsSync(join(imported.path, "plugins", "formatter", ".raspberrycode-plugin", "plugin.json")),
    ).toBe(true);
  });

  it("rejects absolute marketplace plugin source paths outside the marketplace root", async () => {
    const localHome = makeHome();
    process.env.HOME = localHome;
    const marketplaceRoot = join(localHome, "team-market");
    const externalPluginRoot = await writeInlinePlugin(join(localHome, "external"), "formatter", {
      name: "formatter",
    });
    await mkdir(marketplaceRoot, { recursive: true });
    await writeFile(
      join(marketplaceRoot, "marketplace.json"),
      `${JSON.stringify({
        name: "team-market",
        plugins: [
          {
            name: "formatter",
            source: externalPluginRoot,
          },
        ],
      }, null, 2)}\n`,
      "utf-8",
    );

    await expect(
      createPluginSyncService().exportMarketplaceSourceArchive({
        marketplaceId: "team-market",
        pluginNames: ["formatter"],
        source: { source: "directory", path: marketplaceRoot },
      }),
    ).rejects.toThrow("unsafe marketplace plugin source path");
  });

  it("rejects mirrored marketplace plugin source directories without a plugin manifest", async () => {
    const localHome = makeHome();
    process.env.HOME = localHome;
    const marketplaceRoot = join(localHome, "team-market");
    await mkdir(join(marketplaceRoot, "formatter"), { recursive: true });
    await writeFile(join(marketplaceRoot, "formatter", "README.md"), "not a plugin\n", "utf-8");
    await writeFile(
      join(marketplaceRoot, "marketplace.json"),
      `${JSON.stringify({
        name: "team-market",
        plugins: [
          {
            name: "formatter",
            source: "./formatter",
          },
        ],
      }, null, 2)}\n`,
      "utf-8",
    );

    await expect(
      createPluginSyncService().exportMarketplaceSourceArchive({
        marketplaceId: "team-market",
        pluginNames: ["formatter"],
        source: { source: "directory", path: marketplaceRoot },
      }),
    ).rejects.toThrow("local marketplace plugin source is missing plugin manifest");
  });

  it("changes mirrored marketplace source directory when local plugin contents change", async () => {
    const localHome = makeHome();
    process.env.HOME = localHome;
    const marketplaceRoot = join(localHome, "team-market");
    const pluginRoot = await writeInlinePlugin(marketplaceRoot, "formatter", {
      name: "formatter",
    });
    await writeFile(
      join(marketplaceRoot, "marketplace.json"),
      `${JSON.stringify({
        name: "team-market",
        plugins: [{ name: "formatter", source: "./formatter" }],
      }, null, 2)}\n`,
      "utf-8",
    );
    const service = createPluginSyncService();

    const before = await service.exportMarketplaceSourceArchive({
      marketplaceId: "team-market",
      pluginNames: ["formatter"],
      source: { source: "directory", path: marketplaceRoot },
    });
    await writeFile(join(pluginRoot, "skills", "demo", "SKILL.md"), "---\nname: demo\n---\nnew");
    const after = await service.exportMarketplaceSourceArchive({
      marketplaceId: "team-market",
      pluginNames: ["formatter"],
      source: { source: "directory", path: marketplaceRoot },
    });

    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    const remoteService = createPluginSyncService();
    const beforeImport = await remoteService.importMarketplaceSourceArchive({
      archive: before.archive,
      overwrite: false,
    });
    const afterImport = await remoteService.importMarketplaceSourceArchive({
      archive: after.archive,
      overwrite: false,
    });

    expect(afterImport.path).not.toBe(beforeImport.path);
  });

  it("mirrors same-marketplace dependencies with the selected marketplace plugin", async () => {
    const localHome = makeHome();
    process.env.HOME = localHome;
    const marketplaceRoot = join(localHome, "team-market");
    await writeInlinePlugin(marketplaceRoot, "formatter", { name: "formatter" });
    await writeInlinePlugin(marketplaceRoot, "helper", { name: "helper" });
    await writeFile(
      join(marketplaceRoot, "marketplace.json"),
      `${JSON.stringify({
        name: "team-market",
        plugins: [
          { name: "formatter", dependencies: ["helper"], source: "./formatter" },
          { name: "helper", source: "./helper" },
        ],
      }, null, 2)}\n`,
      "utf-8",
    );
    const exported = await createPluginSyncService().exportMarketplaceSourceArchive({
      marketplaceId: "team-market",
      pluginNames: ["formatter"],
      source: { source: "directory", path: marketplaceRoot },
    });

    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    const imported = await createPluginSyncService().importMarketplaceSourceArchive({
      archive: exported.archive,
      overwrite: false,
    });
    const mirroredManifest = await readJsonFile(join(imported.path, "marketplace.json"));

    expect(exported.pluginNames).toEqual(["formatter", "helper"]);
    expect(mirroredManifest.plugins).toMatchObject([
      { name: "formatter", dependencies: ["helper"], source: "./formatter" },
      { name: "helper", source: "./helper" },
    ]);
    expect(existsSync(join(imported.path, "plugins", "helper"))).toBe(true);
  });

  it("exports a file marketplace source with plugin paths relative to the marketplace file", async () => {
    const localHome = makeHome();
    process.env.HOME = localHome;
    const marketplaceRoot = join(localHome, "team-market");
    await writeInlinePlugin(marketplaceRoot, "formatter", { name: "formatter" });
    const marketplaceFile = join(marketplaceRoot, "marketplace.json");
    await writeFile(
      marketplaceFile,
      `${JSON.stringify({
        name: "team-market",
        plugins: [{ name: "formatter", source: "./formatter" }],
      }, null, 2)}\n`,
      "utf-8",
    );

    const exported = await createPluginSyncService().exportMarketplaceSourceArchive({
      marketplaceId: "team-market",
      pluginNames: ["formatter"],
      source: { source: "file", path: marketplaceFile },
    });
    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    const imported = await createPluginSyncService().importMarketplaceSourceArchive({
      archive: exported.archive,
      overwrite: false,
    });

    expect(existsSync(join(imported.path, "plugins", "formatter"))).toBe(true);
  });

  it("exports a settings marketplace source without local cache fallback when entries are remote", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const service = createPluginSyncService();

    const exported = await service.exportMarketplaceSourceArchive({
      marketplaceId: "team-market",
      pluginNames: ["formatter"],
      source: {
        source: "settings",
        marketplace: {
          name: "team-market",
          plugins: [
            {
              name: "formatter",
              version: "1.0.0",
              source: { source: "github", repo: "example/formatter-plugin" },
            },
          ],
        },
      },
    });

    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    const imported = await createPluginSyncService().importMarketplaceSourceArchive({
      archive: exported.archive,
      overwrite: false,
    });
    const mirroredManifest = await readJsonFile(join(imported.path, "marketplace.json"));

    expect(mirroredManifest).toMatchObject({
      name: "team-market",
      plugins: [
        {
          name: "formatter",
          source: { source: "github", repo: "example/formatter-plugin" },
        },
      ],
    });
    expect(existsSync(join(imported.path, "plugins"))).toBe(false);
  });

  it("rejects settings marketplace entries whose local source root cannot be reconstructed", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const service = createPluginSyncService();

    await expect(
      service.exportMarketplaceSourceArchive({
        marketplaceId: "team-market",
        pluginNames: ["formatter"],
        source: {
          source: "settings",
          marketplace: {
            name: "team-market",
            plugins: [
              {
                name: "formatter",
                source: "./formatter",
              },
            ],
          },
        },
      }),
    ).rejects.toThrow("cannot mirror local marketplace plugin source");
  });
});
