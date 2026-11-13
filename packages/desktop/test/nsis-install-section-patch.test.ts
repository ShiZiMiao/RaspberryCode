import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  PATCH_MARKER,
  patchNsisInstallSectionFile,
  patchNsisInstallSectionSource,
  restoreNsisInstallSectionFileSync,
} from "../scripts/patch-nsis-install-section.mjs";

function createInstallSectionFixture(eol = "\r\n") {
  return [
    "InitPluginsDir",
    "",
    "${IfNot} ${Silent}",
    "  SetDetailsPrint none",
    "${endif}",
    "",
    "!insertmacro uninstallOldVersion SHELL_CONTEXT",
    "!insertmacro handleUninstallResult SHELL_CONTEXT",
    "",
    '${if} $installMode == "all"',
    "  !insertmacro uninstallOldVersion HKEY_CURRENT_USER",
    "  !insertmacro handleUninstallResult HKEY_CURRENT_USER",
    "${endIf}",
    "",
    "SetOutPath $INSTDIR",
    "",
    "!insertmacro installApplicationFiles",
    "!insertmacro registryAddInstallInfo",
    "!insertmacro addStartMenuLink $keepShortcuts",
    "!insertmacro addDesktopLink $keepShortcuts",
  ].join(eol);
}

describe("NSIS installSection template patch", () => {
  it("当前真实模板可接入阶段，文件级重复调用幂等且可恢复原字节", async () => {
    const require = createRequire(import.meta.url);
    const source = await readFile(
      join(
        dirname(require.resolve("app-builder-lib/package.json")),
        "templates/nsis/installSection.nsh",
      ),
      "utf8",
    );
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-nsis-template-"));
    const path = join(root, "installSection.nsh");
    try {
      // 只修改隔离副本，不污染开发依赖；真实模板锚点变更不能被手写 fixture 掩盖。
      // node_modules 模板可能已被构建期补丁打点（构建中断未还原时残留幂等标记）；
      // 已补丁态下首次调用是幂等 no-op，两种状态的补丁产物与还原闭环断言一致。
      await writeFile(path, source);
      const prePatched = source.includes(PATCH_MARKER);
      const first = await patchNsisInstallSectionFile(path);
      expect(first.changed).toBe(!prePatched);
      if (prePatched) {
        // 已补丁态首次调用是幂等 no-op：无 originalSource，文件字节保持不变。
        expect(first.originalSource).toBeNull();
      } else {
        expect(first.originalSource).toBe(source);
      }
      const patched = await readFile(path, "utf8");
      const sequence = [
        "!insertmacro customInstallSectionStarted",
        "!insertmacro customInstallCleanupStarted",
        "!insertmacro uninstallOldVersion SHELL_CONTEXT",
        "!insertmacro uninstallOldVersion HKEY_CURRENT_USER",
        "!insertmacro customInstallCleanupCompleted",
        "!insertmacro customInstallExtractStarted",
        "!insertmacro installApplicationFiles",
        "!insertmacro customInstallExtractCompleted",
        "!insertmacro customInstallShortcutsStarted",
        "!insertmacro addStartMenuLink",
        "!insertmacro customInstallShortcutsCompleted",
      ].map((marker) => patched.indexOf(marker));
      expect(
        sequence.every((index, offset) => index >= 0 && (!offset || index > sequence[offset - 1]!)),
      ).toBe(true);
      expect(await patchNsisInstallSectionFile(path)).toEqual({
        changed: false,
        originalSource: null,
      });
      if (!prePatched) {
        restoreNsisInstallSectionFileSync({ filePath: path, originalSource: first.originalSource! });
      }
      expect(await readFile(path, "utf8")).toBe(source);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("opens file details and inserts the install phases without changing CRLF", () => {
    const source = createInstallSectionFixture();
    const patched = patchNsisInstallSectionSource(source);

    expect(patched).toContain(PATCH_MARKER.replaceAll("\n", "\r\n"));
    expect(patched).toContain("  SetDetailsPrint listonly\r\n");
    expect(patched).toContain("!insertmacro customInstallExtractStarted\r\n");
    expect(patched).toContain("!insertmacro customInstallExtractCompleted\r\n");
    expect(patched).toContain("!insertmacro customInstallShortcutsStarted\r\n");
    expect(patched).toContain("!insertmacro customInstallShortcutsCompleted\r\n");
    expect(patched).not.toContain("SetDetailsPrint none");
    expect(patchNsisInstallSectionSource(patched)).toBe(patched);
  });

  it("模板结构变化时应立即失败，而不是静默生成缺少诊断的安装器", () => {
    expect(() => patchNsisInstallSectionSource("InitPluginsDir\n")).toThrow(
      "electron-builder installSection.nsh 缺少预期锚点",
    );
  });
});

describe("快捷方式必须每次安装都重建", () => {
  // 需覆盖补丁依次要求的全部锚点，否则会在更早的 replaceRequired 处抛错，
  // 测不到快捷方式这一段。
  const template = [
    "${IfNot} ${Silent}",
    "  SetDetailsPrint none",
    "${endif}",
    "!insertmacro uninstallOldVersion SHELL_CONTEXT",
    "!insertmacro handleUninstallResult SHELL_CONTEXT",
    '${if} $installMode == "all"',
    "  !insertmacro uninstallOldVersion HKEY_CURRENT_USER",
    "  !insertmacro handleUninstallResult HKEY_CURRENT_USER",
    "${endIf}",
    "!insertmacro installApplicationFiles",
    "!insertmacro addStartMenuLink $keepShortcuts",
    "!insertmacro addDesktopLink $keepShortcuts",
    "",
  ].join("\n");

  it("在创建快捷方式前把 keepShortcuts 压回 false", () => {
    const patched = patchNsisInstallSectionSource(template);
    // keepShortcuts=true 时 addStartMenuLink 只做「旧路径→新路径」重命名，
    // 路径不变时什么都不做，而旧的已被 cleanupOldMenuDirectory 删除，
    // 结果就是每装一次少一批快捷方式（实测 0.2.1 重复安装后开始菜单与桌面全空）。
    const forceIndex = patched.indexOf('StrCpy $keepShortcuts "false"');
    const startMenuIndex = patched.indexOf("addStartMenuLink");
    expect(forceIndex).toBeGreaterThanOrEqual(0);
    expect(forceIndex).toBeLessThan(startMenuIndex);
  });

  it("强制重置位于两个宏之前，开始菜单与桌面都走重建分支", () => {
    const patched = patchNsisInstallSectionSource(template);
    const forceIndex = patched.indexOf('StrCpy $keepShortcuts "false"');
    expect(forceIndex).toBeLessThan(patched.indexOf("addStartMenuLink"));
    expect(forceIndex).toBeLessThan(patched.indexOf("addDesktopLink"));
  });

  it("重复打补丁保持幂等（不会叠加多条重置）", () => {
    const once = patchNsisInstallSectionSource(template);
    const twice = patchNsisInstallSectionSource(once);
    const count = twice.split('StrCpy $keepShortcuts "false"').length - 1;
    expect(count).toBe(1);
  });
});
