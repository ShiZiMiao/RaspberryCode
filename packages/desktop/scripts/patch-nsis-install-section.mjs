import { readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";

const PATCH_MARKER = "; raspberrycode-installer-details-v1";

function optionalMacro(name) {
  return [`!ifmacrodef ${name}`, `  !insertmacro ${name}`, "!endif"].join("\n");
}

function replaceRequired(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index === -1) {
    throw new Error(`electron-builder installSection.nsh 缺少预期锚点：${label}`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + needle.length)}`;
}

/**
 * 给 electron-builder 的安装段补上可见阶段，并开启 NSIS 内置逐文件详情。
 *
 * 这里不复制整份上游模板，避免 electron-builder 升级时静默带入旧模板；每次打包
 * 都必须命中下面的结构锚点，模板结构变化会立即失败并提醒维护者重新对齐。
 */
export function patchNsisInstallSectionSource(source) {
  const sourceEol = source.includes("\r\n") ? "\r\n" : "\n";
  let patched = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (patched.includes(PATCH_MARKER)) {
    return source;
  }

  const detailsAnchor = "${IfNot} ${Silent}\n  SetDetailsPrint none\n${endif}";
  patched = replaceRequired(
    patched,
    detailsAnchor,
    [
      PATCH_MARKER,
      "# 详情区需要同时显示 electron-builder 的 File 条目和项目阶段。",
      "${IfNot} ${Silent}",
      "  SetDetailsPrint listonly",
      "${endif}",
      optionalMacro("customInstallSectionStarted"),
    ].join("\n"),
    "SetDetailsPrint none",
  );

  const cleanupStartAnchor =
    "!insertmacro uninstallOldVersion SHELL_CONTEXT\n!insertmacro handleUninstallResult SHELL_CONTEXT";
  patched = replaceRequired(
    patched,
    cleanupStartAnchor,
    `${optionalMacro("customInstallCleanupStarted")}\n${cleanupStartAnchor}`,
    "SHELL_CONTEXT cleanup",
  );

  const cleanupEndAnchor =
    '${if} $installMode == "all"\n  !insertmacro uninstallOldVersion HKEY_CURRENT_USER\n  !insertmacro handleUninstallResult HKEY_CURRENT_USER\n${endIf}';
  patched = replaceRequired(
    patched,
    cleanupEndAnchor,
    `${cleanupEndAnchor}\n${optionalMacro("customInstallCleanupCompleted")}`,
    "HKEY_CURRENT_USER cleanup",
  );

  const extractAnchor = "!insertmacro installApplicationFiles";
  patched = replaceRequired(
    patched,
    extractAnchor,
    `${optionalMacro("customInstallExtractStarted")}\n${extractAnchor}\n${optionalMacro("customInstallExtractCompleted")}`,
    "application extraction",
  );

  const shortcutsAnchor =
    "!insertmacro addStartMenuLink $keepShortcuts\n!insertmacro addDesktopLink $keepShortcuts";
  patched = replaceRequired(
    patched,
    shortcutsAnchor,
    [
      // 强制重建快捷方式。
      //
      // 原因：安装段前面的逻辑会读注册表 KeepShortcuts，把它为 true 解释成
      // 「用户可能删过快捷方式，不要重建」，于是 $keepShortcuts 保持 "true"。
      // 但 addStartMenuLink 的 keepShortcuts 分支只做「旧路径 → 新路径」重命名，
      // 当 ShortcutName 不变（同版本重装、或跨版本升级未改短名）时
      // $oldStartMenuLink == $newStartMenuLink，既不重命名也不创建；
      // 而此处之前的 cleanupOldMenuDirectory 已经把原快捷方式删了 ——
      // 结果是每装一次就少一批快捷方式。
      //
      // 实测（2026-11-13，0.2.1 本机）：首次安装得到 1 个开始菜单项 + 1 个桌面项；
      // 紧接着重复安装同一个包，两者都被清空，与用户「装完没有快捷方式」一致。
      // createDesktopShortcut:"always" 只能救桌面（RECREATE_DESKTOP_SHORTCUT
      // 仅在 addDesktopLink 里被判断），开始菜单没有对应的 always 开关，
      // 因此在这里把 $keepShortcuts 直接压回 "false"，让两个宏都走「重建」分支。
      'StrCpy $keepShortcuts "false"',
      optionalMacro("customInstallShortcutsStarted"),
      shortcutsAnchor,
      optionalMacro("customInstallShortcutsCompleted"),
    ].join("\n"),
    "shortcut installation",
  );

  return sourceEol === "\r\n" ? patched.replaceAll("\n", "\r\n") : patched;
}

export async function patchNsisInstallSectionFile(filePath) {
  const source = await readFile(filePath, "utf8");
  const patched = patchNsisInstallSectionSource(source);
  if (patched === source) {
    return { changed: false, originalSource: null };
  }

  await writeFile(filePath, patched, "utf8");
  return { changed: true, originalSource: source };
}

export function restoreNsisInstallSectionFileSync({ filePath, originalSource }) {
  if (originalSource !== null) {
    writeFileSync(filePath, originalSource, "utf8");
  }
}

export { PATCH_MARKER };
