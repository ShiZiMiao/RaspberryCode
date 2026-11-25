import { app } from "electron";
import { getAppConfigDir } from "@raspberrycode/services/node";

export type ElectronAppPathName = "appData" | "userData";

export function isElectronAppPackaged(): boolean {
  // 修复原因：Electron 44 起 `app.isPackaged` 在 `electron .` 开发启动时也可能为 true
  // （官方文档 docs/electron/docs/api/process.md 明确说明 defaultApp 与 isPackaged 解耦）。
  // 仓库多处用 `!app.isPackaged` 判断开发态，若只看 isPackaged，dev 会走生产分支：
  // 主窗口加载不存在的 out/renderer/index.html、自动更新在开发态启动等。
  // `process.defaultApp` 是「由默认 Electron 可执行文件带应用路径启动」的可靠信号，
  // 打包后的应用该值为 undefined。
  if (process.defaultApp === true) return false;
  return (
    (app as unknown as { isPackaged?: boolean } | undefined)?.isPackaged === true
  );
}

export function getElectronAppPath(name: ElectronAppPathName): string {
  const electronApp = app as unknown as
    | { getPath?: (pathName: ElectronAppPathName) => string }
    | undefined;
  if (electronApp?.getPath) {
    return electronApp.getPath(name);
  }

  // 部分 main-process 单测只 mock 被测模块直接需要的 Electron API，
  // 间接导入 desktopRuntimeEnv 时可能拿不到 app。真实桌面运行仍走 app.getPath；
  // Node-only 测试用配置目录兜底，避免导入期常量把无关测试打断。
  return getAppConfigDir();
}
