import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const desktopDir = resolve(import.meta.dirname, "..");

describe.skipIf(process.platform !== "win32")("Windows installer file ownership", () => {
  it("preserves files that are absent from the ownership manifest", () => {
    const output = execFileSync(
      process.execPath,
      [resolve(desktopDir, "scripts/test-installer-preserve-files.mjs")],
      { cwd: desktopDir, encoding: "utf-8" },
    );
    expect(output).toContain("[installer-preserve-files] passed");
    // 8 个恢复场景各自编译并运行真实 NSIS 安装器；Windows Defender 逐文件扫描时
    // 单轮实测可超过 120 秒，预算按场景数放宽，避免环境慢被误判为产品失败。
  }, 300_000);
});
