import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const desktopPackageJsonPath = resolve(import.meta.dirname, "../package.json");
const desktopPackageJson = JSON.parse(readFileSync(desktopPackageJsonPath, "utf8")) as {
  scripts: Record<string, string | undefined>;
};

// 退出码契约见 docs/desktop/dev-session-exit-code.md：
// 应用正常退出后 Electron 会话先以 0 结束，tsup/vite watch 被 -k 杀掉并记为非 0；
// `--success first` 让第一个退出的命令决定整体退出码，托盘退出不再触发 ELIFECYCLE 噪声。
describe("desktop dev 会话退出码契约", () => {
  it("标准和 local-cli 开发入口都由第一个退出的命令决定整体退出码", () => {
    for (const scriptName of ["dev:runtime", "dev:local-cli"]) {
      const script = desktopPackageJson.scripts[scriptName];
      expect(script).toBeDefined();
      expect(script).toContain("-k ");
      expect(script).toContain("--success first");
    }
  });

  it("退出码汇总必须在 watch 进程组内部生效，不得吞掉 tsup/vite 先行失败", () => {
    for (const scriptName of ["dev:runtime", "dev:local-cli"]) {
      const script = desktopPackageJson.scripts[scriptName] ?? "";
      // 只允许 "first" 这一种汇总口径；不得改成 all/any 之外的兜底吞错写法
      //（如 `|| exit 0`、`--success all` 被移除后裸跑）。
      expect(script).not.toMatch(/--success (?!first\b)/u);
      expect(script).not.toMatch(/\|\|\s*exit 0/u);
    }
  });
});
