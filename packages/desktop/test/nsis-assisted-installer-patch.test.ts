import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PATCH_MARKER,
  patchAssistedInstallerFile,
  patchAssistedInstallerSource,
  restoreAssistedInstallerFileSync,
} from "../scripts/patch-nsis-assisted-installer.mjs";

/**
 * 构造与 electron-builder 26.x `assistedInstaller.nsh` 结构一致的片段。
 *
 * 关键细节（都是实读模板得出，写错会让锚点匹配不到）：
 *   - 页面注册在 4 空格缩进内（外层还有 `!ifndef BUILD_UNINSTALLER`）；
 *   - PAGE_INSTALL_MODE 外面裹着 `!ifndef INSTALL_MODE_PER_ALL_USERS`；
 *   - DIRECTORY 页已自带 skipPageIfUpdated（我们不动它）。
 */
function createAssistedInstallerFixture(eol = "\n") {
  const lines = [
    "!include UAC.nsh",
    "",
    "!ifndef BUILD_UNINSTALLER",
    "",
    "  !ifndef INSTALL_MODE_PER_ALL_USERS",
    "    !insertmacro PAGE_INSTALL_MODE",
    "  !endif",
    "",
    "  !ifdef allowToChangeInstallationDirectory",
    "    !include StrContains.nsh",
    "",
    "    !insertmacro skipPageIfUpdated",
    "    !insertmacro MUI_PAGE_DIRECTORY",
    "  !endif",
    "",
    "  !insertmacro MUI_PAGE_INSTFILES",
    "  !insertmacro MUI_PAGE_FINISH",
    "!else",
    "  !insertmacro MUI_UNPAGE_WELCOME",
    "!endif",
    "",
  ];
  return lines.join(eol);
}

describe("patchAssistedInstallerSource", () => {
  it("给 PAGE_INSTALL_MODE 补上更新时跳过（用户只应看到进度与完成）", () => {
    const { changed, patched } = patchAssistedInstallerSource(createAssistedInstallerFixture());
    expect(changed).toBe(true);
    expect(patched).toContain(PATCH_MARKER);
    // 关键断言：skipPageIfUpdated 必须紧邻 PAGE_INSTALL_MODE 之前，
    // 且两者都在 INSTALL_MODE_PER_ALL_USERS 的守卫内。
    const guardIndex = patched.indexOf("!ifndef INSTALL_MODE_PER_ALL_USERS");
    const skipIndex = patched.indexOf("!insertmacro skipPageIfUpdated");
    const pageIndex = patched.indexOf("!insertmacro PAGE_INSTALL_MODE");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(skipIndex).toBeGreaterThan(guardIndex);
    expect(pageIndex).toBeGreaterThan(skipIndex);
  });

  it("不破坏原有的目录页跳过（DIRECTORY 已自带 skipPageIfUpdated）", () => {
    const { patched } = patchAssistedInstallerSource(createAssistedInstallerFixture());
    // 两处 skipPageIfUpdated：新加的一处 + 目录页原有的一处
    expect(patched.match(/!insertmacro skipPageIfUpdated/g)?.length).toBe(2);
    expect(patched).toContain("!insertmacro MUI_PAGE_DIRECTORY");
    // 进度页与完成页必须保留——用户要能看到进度、最后点完成
    expect(patched).toContain("!insertmacro MUI_PAGE_INSTFILES");
    expect(patched).toContain("!insertmacro MUI_PAGE_FINISH");
  });

  it("幂等：重复 patch 不叠加补丁", () => {
    const once = patchAssistedInstallerSource(createAssistedInstallerFixture());
    const twice = patchAssistedInstallerSource(once.patched);
    expect(twice.changed).toBe(false);
    expect(twice.patched).toBe(once.patched);
    expect(twice.patched.match(/!insertmacro skipPageIfUpdated/g)?.length).toBe(2);
  });

  it("已指定 INSTALL_MODE_PER_ALL_USERS 时不打补丁（该页本就不存在）", () => {
    const source = createAssistedInstallerFixture().replace(
      ["  !ifndef INSTALL_MODE_PER_ALL_USERS", "    !insertmacro PAGE_INSTALL_MODE", "  !endif", ""].join(
        "\n",
      ),
      "",
    );
    const { changed, patched } = patchAssistedInstallerSource(source);
    expect(changed).toBe(false);
    expect(patched).toBe(source);
  });

  it("模板结构变化时安全失败（返回未改动，不抛错）", () => {
    // 模拟上游把 2 空格缩进改回 2 空格/改了缩进量：锚点匹配不到时不应破坏文件。
    const source = "!ifndef BUILD_UNINSTALLER\n\t!insertmacro MUI_PAGE_INSTFILES\n!endif\n";
    const { changed, patched } = patchAssistedInstallerSource(source);
    expect(changed).toBe(false);
    expect(patched).toBe(source);
  });

  it("保留 CRLF 换行（Windows 模板可能带 \\r\\n）", () => {
    const { patched } = patchAssistedInstallerSource(createAssistedInstallerFixture("\r\n"));
    expect(patched.includes("\r\n")).toBe(true);
    // 不能出现混合换行：'\n' 总数应等于 '\r\n' 总数
    const lf = (patched.match(/\n/g) ?? []).length;
    const crlf = (patched.match(/\r\n/g) ?? []).length;
    expect(lf).toBe(crlf);
  });
});

describe("patchAssistedInstallerFile / restore", () => {
  it("写盘与恢复保持原文一致", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nsis-assisted-"));
    const filePath = join(dir, "assistedInstaller.nsh");
    const original = createAssistedInstallerFixture();
    try {
      await writeFile(filePath, original, "utf8");
      const result = await patchAssistedInstallerFile(filePath);
      expect(result.changed).toBe(true);
      expect(await readFile(filePath, "utf8")).toContain(PATCH_MARKER);

      restoreAssistedInstallerFileSync({
        filePath,
        originalSource: result.originalSource,
      });
      expect(await readFile(filePath, "utf8")).toBe(original);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("已打过补丁时 changed=false 且不产生 originalSource", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nsis-assisted-"));
    const filePath = join(dir, "assistedInstaller.nsh");
    const { patched } = patchAssistedInstallerSource(createAssistedInstallerFixture());
    try {
      await writeFile(filePath, patched, "utf8");
      const result = await patchAssistedInstallerFile(filePath);
      expect(result.changed).toBe(false);
      // 不能记录 originalSource：否则恢复时会把「已打补丁的版本」当成原文写回，
      // 或者把真正的原文覆盖掉。
      expect(result.originalSource).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
