import type {
  AutoUpdatePreferences,
  PostUpdateReleaseNotesPayload,
  UpdateCheckResultPayload,
  UpdateStatePayload,
} from "./contract.js";

/**
 * 契约用法示例：renderer 消费状态快照并把手动检查结果映射为 toast 文案。
 * 仅作类型示范（contract.example.ts 参与类型检查，不进入运行时）。
 */
export function exampleRenderUpdateSnapshot(
  state: UpdateStatePayload,
  checkResult: UpdateCheckResultPayload,
  preferences: AutoUpdatePreferences,
): PostUpdateReleaseNotesPayload | null {
  void checkResult;
  void preferences;
  return state.kind === "update-available" ? (state.releaseNotes ?? null) : null;
}
