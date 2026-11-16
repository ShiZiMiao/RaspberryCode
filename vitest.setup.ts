import { afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

process.env.GIT_CONFIG_COUNT = "2";

// Bugfix: Git Bash 会把 /usr/bin（GNU tar 1.35）注入 PATH 最前，子进程 spawn "tar"
// 解析到 GNU tar 后会把归档参数里的 `C:` 当远程主机（"Cannot connect to C"），
// raspberrycode-server-cli 打包/发布与 native-search 归档类测试因此在 Windows 开发机整批失败。
// 真实 Windows 用户 PATH 中 System32 本就靠前、产品环境一直用 bsdtar；这里恢复同样顺序。
if (process.platform === "win32") {
  const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  if (existsSync(join(system32, "tar.exe"))) {
    const entries = (process.env.PATH ?? "").split(";");
    const rest = entries.filter((entry) => entry.toLowerCase() !== system32.toLowerCase());
    process.env.PATH = [system32, ...rest].join(";");
  }
}
process.env.GIT_CONFIG_KEY_0 = "core.autocrlf";
process.env.GIT_CONFIG_VALUE_0 = "false";
process.env.GIT_CONFIG_KEY_1 = "core.eol";
process.env.GIT_CONFIG_VALUE_1 = "lf";
process.env.RASPBERRYCODE_TEST_RELEASE_TARGET = process.env.RASPBERRYCODE_TEST_RELEASE_TARGET ?? "darwin";
process.env.RASPBERRYCODE_TEST_RELEASE_ARCH = process.env.RASPBERRYCODE_TEST_RELEASE_ARCH ?? "aarch64";
process.env.RASPBERRYCODE_TEST_CLIENT_CONFIG_PLATFORM = process.env.RASPBERRYCODE_TEST_CLIENT_CONFIG_PLATFORM ?? "darwin-aarch64";
// Bugfix: 桌面端会把自定义 dataBaseDir 通过环境变量注入到 host/git 子进程。
// 很多服务层单测只通过覆盖 HOME 来隔离临时目录；若保留该变量，路径解析会继续优先命中真实 dataBaseDir，
// 从而导致“终端本地跑通过，但应用内 git push 触发 pre-push 时大量用例误写到同一目录”。
// 这里在测试入口统一清理，保证单测默认只受各自显式设置的 HOME / setDataBaseDir 控制。
delete process.env.RASPBERRYCODE_DATA_BASE_DIR;

afterEach(() => {
  delete process.env.RASPBERRYCODE_DATA_BASE_DIR;
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();

  return {
    ...actual,
    homedir: () => {
      const envHome = process.env.HOME?.trim() || process.env.USERPROFILE?.trim();
      return envHome && envHome.length > 0 ? envHome : actual.homedir();
    },
  };
});

// jsdom 环境补齐：jsdom 不实现 window.matchMedia，而主题同步（store/index.ts
// syncSystemThemeListener、useTheme.ts getSystemTheme）在模块加载与订阅时就调用它。
// 修复原因（2026-11-15）：233 个 UI 测试因 @testing-library 缺失长期 `(0 test)` 加载失败，
// 补回依赖后才暴露此处——151 个 ui 测试文件从未真正执行过，各自零散 stub matchMedia。
// 在全局入口统一提供最小实现，避免每个用例重复桩；需要特定返回值的用例仍可自行覆盖。
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
