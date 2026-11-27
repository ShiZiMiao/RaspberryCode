import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Bug 根因：Windows 上轻量构建不产出预装入口 shim，E2E 只跑 build:no-runtime-assets，
// CI 上没有该 exe，全部 case 报 shim missing。本仓库不使用 runtime host，只保留 shim 预检。
describe("E2E Windows runtime host preflight", () => {
  it("预装入口 shim 也在复用构建前准备，构建失败不能进入 case", () => {
    const source = readFileSync(new URL("../wdio.conf.ts", import.meta.url), "utf8");
    const start = source.indexOf("\nfunction prepareDesktopAppBuild() {");
    const body = source.slice(start, source.indexOf("\n}\n", start));
    const ensureIndex = body.indexOf("ensureWindowsPreinstalledEntryShim();");
    expect(ensureIndex).toBeGreaterThan(body.indexOf("E2E_PACKAGED_APP_BINARY_PATH"));
    expect(body.indexOf("shouldReuseDesktopE2EBuild(")).toBeGreaterThan(ensureIndex);
    const helperStart = source.indexOf("function ensureWindowsPreinstalledEntryShim() {");
    const helper = source.slice(helperStart, source.indexOf("\n}\n", helperStart));
    expect(helper).toContain('"--ensure"');
    expect(helper).toContain('"--check"');
    expect(helper).toContain('"--stage-dir"');
    expect(helper).toContain("timeout:");
    expect(helper).toContain('killSignal: "SIGKILL"');
    expect(helper).toContain("E2E_RUN_CACHE_DIR");
  });

  it("Main 优先读取随运行目录隔离的 shim，而不是 cwd 的共享缓存", () => {
    const source = readFileSync(
      new URL("../src/main/desktopRuntimeEnv.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("export function resolvePreinstalledEntryShimPath()");
    const body = source.slice(
      source.indexOf("const candidates = [", start),
      source.indexOf("\n}\n", start),
    );
    expect(body.indexOf("process.resourcesPath")).toBeLessThan(body.indexOf("import.meta.dirname"));
    expect(body.indexOf("import.meta.dirname")).toBeLessThan(body.indexOf("process.cwd()"));
  });
});
