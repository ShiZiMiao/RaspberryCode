import type { LaunchMarks } from "@raspberrycode/shared";

export function shouldReportLaunchToInput(state: {
  isStartupRenderBlocked: boolean;
  alreadyReported: boolean;
}): boolean {
  // 门禁清除 = RootStartupLoading 退场、输入框挂载。登录页已整体移除（specs/no-login-startup.md），
  // 启动后门禁清除即代表可输入。
  return !state.alreadyReported && !state.isStartupRenderBlocked;
}

export function readRendererLaunchTimings(): {
  marks: LaunchMarks | null;
  rendererStart: number;
  reactCommit: number;
} | null {
  const w = window as Window & {
    __RASPBERRYCODE_LAUNCH_MARKS__?: LaunchMarks | null;
    __RASPBERRYCODE_RENDERER_START__?: number;
    __RASPBERRYCODE_REACT_COMMIT_AT__?: number;
  };
  const rendererStart = w.__RASPBERRYCODE_RENDERER_START__;
  const reactCommit = w.__RASPBERRYCODE_REACT_COMMIT_AT__;
  if (typeof rendererStart !== "number" || typeof reactCommit !== "number") {
    return null;
  }
  return { marks: w.__RASPBERRYCODE_LAUNCH_MARKS__ ?? null, rendererStart, reactCommit };
}
