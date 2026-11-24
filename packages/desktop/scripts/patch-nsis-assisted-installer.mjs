/**
 * 让「更新」走的安装流程接近静默：跳过安装模式页与目录页，只留下进度与完成页。
 *
 * 用户要求（2026-11-23）：
 *   「退出后更新的 NSIS 界面我们只显示进度即可，不需要用户手动点击下一步之类的操作，
 *     只在最后点击完成即可」。
 *
 * 为什么不能直接用 electron-updater 的静默安装（`quitAndInstall(true)`）：
 *   那会传 `/S` 给安装器，NSIS 进入完全静默模式——**连进度条和完成页都不显示**，
 *   用户在应用退出后看不到任何反馈，会以为程序崩了。
 *   而我们要的是「有进度、能确认、不用点下一步」。
 *
 * 为什么上游代码也有同样配置却没这个多步向导：
 *   上游 `electron-builder.config.js` 同样是 `oneClick:false` +
 *   `allowToChangeInstallationDirectory:true`，理论上也会出向导。
 *   差异在 electron-builder 版本与 `skipPageIfUpdated` 宏的覆盖范围（见下）。
 *
 * 实际出问题的页面（读 `assistedInstaller.nsh` + `multiUserUi.nsh` 得出）：
 *   1. `PAGE_INSTALL_MODE`（「为所有用户 / 仅为我」）——**没有**包 skipPageIfUpdated，
 *      更新时照样弹出，这是用户看到的第一页「下一步」。
 *   2. `MUI_PAGE_DIRECTORY`（选择安装目录）——已包 `skipPageIfUpdated`，
 *      更新时会 Abort 跳过，本身没问题。
 *   3. `MUI_PAGE_INSTFILES`（进度）——保留。
 *   4. `MUI_PAGE_FINISH`（完成）——保留，用户点这里结束。
 *
 * 因此只需给 (1) 补上更新时跳过，即可达到「进度 + 完成」的效果。
 *
 * 实现方式：与 `patch-nsis-install-section.mjs` 同模式——打包时临时改 node_modules 里的
 * 上游模板，进程退出时恢复，避免把定制内容永久留在依赖里。
 *
 * 为什么 skipPageIfUpdated 对 PAGE_INSTALL_MODE 有效：
 *   该页是 `PageEx custom` + 显式 `PageCallbacks`，看着像会绕过 MUI 的 PRE 回调，
 *   但 `multiUserUi.nsh:92` 里显式调了 `!insertmacro MUI_PAGE_FUNCTION_CUSTOM PRE`，
 *   而这正是 `MUI_PAGE_CUSTOMFUNCTION_PRE` 的展开点。因此 `skipPageIfUpdated`
 *   定义的 PRE 回调会被执行，`${isUpdated}` 时 Abort 生效。
 *   这也是 `assistedInstaller.nsh` 对 DIRECTORY 页使用同一宏的前提。
 */
import { readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";

const PATCH_MARKER = "; raspberrycode-update-skips-install-mode-page-v1";

/**
 * 给 `PAGE_INSTALL_MODE` 的调用点包一层「更新时跳过」。
 *
 * 上游原文（assistedInstaller.nsh）：
 *   ```
 *   !ifndef INSTALL_MODE_PER_ALL_USERS
 *     !insertmacro PAGE_INSTALL_MODE
 *   !endif
 *   ```
 * 注意它在 `!ifndef INSTALL_MODE_PER_ALL_USERS` 里——若构建配置指定了按机器安装
 * （perMachine），这段根本不存在，也就不需要跳过。锚点缺失时只在那种配置下成立，
 * 因此这里返回 changed=false 而不是抛错（与 installSection 的严格锚点策略不同，
 * 那个脚本改的是必然存在的段）。
 */
export function patchAssistedInstallerSource(source) {
  if (source.includes(PATCH_MARKER)) {
    return { changed: false, patched: source };
  }

  // 上游原文（assistedInstaller.nsh，注意是 4 空格缩进且外层还有一层 BUILD_UNINSTALLER）：
  //   ```
  //   !ifndef BUILD_UNINSTALLER
  //     ...
  //     !ifndef INSTALL_MODE_PER_ALL_USERS
  //       !insertmacro PAGE_INSTALL_MODE
  //     !endif
  //   ```
  // 锚点必须带上真实缩进，否则匹配不到（最初按 2 空格写导致 changed=false）。
  const anchor = [
    "!ifndef INSTALL_MODE_PER_ALL_USERS",
    "  !insertmacro PAGE_INSTALL_MODE",
    "!endif",
  ].join("\n");
  const indentedAnchor = anchor.replace(/^/gm, "  ");
  const target = source.includes(indentedAnchor) ? indentedAnchor : anchor;
  if (!source.includes(target)) {
    // 已指定 INSTALL_MODE_PER_ALL_USERS，或上游模板结构变了。
    // 前者属正常配置（无需跳过安装模式页），后者会在打包日志里体现。
    return { changed: false, patched: source };
  }

  const sourceEol = source.includes("\r\n") ? "\r\n" : "\n";
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

  // skipPageIfUpdated 定义在 common.nsh（`!macro skipPageIfUpdated`），
  // 语义是「${isUpdated} 成立时给页面挂 PRE 回调并 Abort」。
  // 安装器主脚本已 include common.nsh，这里可直接复用，无需自带实现。
  const replacement = [
    PATCH_MARKER,
    "# 更新场景跳过「为谁安装」选择页：",
    "# electron-updater 拉起安装器时带 --updated，${isUpdated} 为真，",
    "# 此时安装位置沿用已有安装，不需要也不应该再问用户。",
    "# 用户只应看到进度页与完成页。",
    "!ifndef INSTALL_MODE_PER_ALL_USERS",
    "  !insertmacro skipPageIfUpdated",
    "  !insertmacro PAGE_INSTALL_MODE",
    "!endif",
  ]
    .map((line) => `  ${line}`)
    .join("\n");

  const patched = normalized.replace(target, replacement);
  if (patched === normalized) {
    return { changed: false, patched: source };
  }
  return {
    changed: true,
    patched: sourceEol === "\r\n" ? patched.replaceAll("\n", "\r\n") : patched,
  };
}

export async function patchAssistedInstallerFile(filePath) {
  const source = await readFile(filePath, "utf8");
  const { changed, patched } = patchAssistedInstallerSource(source);
  if (!changed) {
    return { changed: false, originalSource: null };
  }
  await writeFile(filePath, patched, "utf8");
  return { changed: true, originalSource: source };
}

export function restoreAssistedInstallerFileSync({ filePath, originalSource }) {
  if (originalSource !== null) {
    writeFileSync(filePath, originalSource, "utf8");
  }
}

export { PATCH_MARKER };
