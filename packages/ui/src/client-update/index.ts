/**
 * client-update-ui 公共入口（architecture-governance managed 模块）。
 * 入口/弹窗/设置区块组件与更新日志工具；模型契约见 contract.ts 与 CONTRACT.md。
 */
export { UpdateStatusButton } from "./UpdateStatusButton.js";
export { UpdateStatusDialog } from "./UpdateStatusDialog.js";
export { UpdateStatusDialogController } from "./UpdateStatusDialogController.js";
export { UpdateSettingsSection } from "./UpdateSettingsSection.js";
export {
  formatUpdateReleaseDate,
  getLocalizedUpdateReleaseNotes,
  type LocalizedUpdateReleaseNotes,
} from "./updateReleaseNotes.js";
export {
  deriveUpdateStatusViewModel,
  getUpdateDownloadProgressLabel,
  isUpdateActionCompleted,
  type UpdateActionInFlight,
  type UpdateStatusDialogPhase,
  type UpdateStatusViewModel,
} from "./contract.js";
