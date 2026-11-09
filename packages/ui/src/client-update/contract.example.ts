import type { UpdateStatePayload } from "@raspberrycode/shared";
import { deriveUpdateStatusViewModel, type UpdateStatusViewModel } from "./contract.js";

/**
 * 契约用法示例：把 main 进程的状态快照折算成弹窗视图模型。
 * 仅作类型示范（contract.example.ts 参与类型检查，不进入运行时）。
 */
export function exampleDeriveDialogModel(
  updateState: UpdateStatePayload | null,
): UpdateStatusViewModel {
  return deriveUpdateStatusViewModel({ legacyReadyVersion: null, updateState });
}
