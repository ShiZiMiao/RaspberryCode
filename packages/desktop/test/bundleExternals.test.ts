import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectBundleExternalPackageNames } from "../scripts/runtime-dependency-closure.mjs";

// 修复回归（v0.1.0 Windows 实机）：手工维护的运行时模块清单互相漂移并漏掉 yaml，
// 安装包能生成但主进程启动即 Cannot find module。这里锁住扫描器行为，
// 保证「bundle 真实 external 全集」这一事实来源可靠。
const tempRoots: string[] = [];

function createFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "bundle-externals-"));
  tempRoots.push(root);
  for (const [relativePath, source] of Object.entries(files)) {
    const fullPath = resolve(root, relativePath);
    mkdirSync(resolve(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, source, "utf8");
  }
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("collectBundleExternalPackageNames", () => {
  it("收集 require/import/dynamic import 的裸包名，过滤内建、electron、相对路径与碎片", () => {
    const root = createFixture({
      "main/index.js": [
        `const yaml = require("yaml");`,
        `const path = require("node:path");`,
        `const fs = require("fs");`,
        `const elec = require("electron");`,
        `const rel = require("./local.js");`,
        `import ssh2 from "ssh2";`,
        `import pkg from "@larksuiteoapi/node-sdk/api";`,
        `const mod = await import("electron-updater");`,
        `const minified = ");if(n.kind===" + require("ws").WebSocket;`,
      ].join("\n"),
      "host/index.mjs": `import { parse } from "yaml/browser";`,
    });

    expect(collectBundleExternalPackageNames([resolve(root, "main"), resolve(root, "host")])).toEqual([
      "@larksuiteoapi/node-sdk",
      "electron-updater",
      "ssh2",
      "ws",
      "yaml",
    ]);
  });

  it("缺目录时静默跳过，输出去重排序", () => {
    const root = createFixture({
      "main/a.js": `require("yaml");`,
      "main/b.js": `require("yaml");require("node-pty");`,
    });
    expect(
      collectBundleExternalPackageNames([resolve(root, "main"), resolve(root, "missing")]),
    ).toEqual(["node-pty", "yaml"]);
  });
});
