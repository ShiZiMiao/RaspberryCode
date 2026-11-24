import { Loader2Icon, Undo2Icon } from "lucide-react";
import {
  TID_V4_EDIT_WORKSPACE_CONFLICT_CONVERSATION_ONLY,
  TID_V4_EDIT_WORKSPACE_CONFLICT_DIALOG,
  TID_V4_REVERT_CANCEL,
  TID_V4_REVERT_CONFIRM,
  TID_V4_REVERT_CONFIRM_DIALOG,
} from "@raspberrycode/shared/test-ids";
import type { V4ConversationFileRewindPreviewResult } from "@raspberrycode/shared/raspberrycode-protocol-v4";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useRaspberryCodeIntl } from "@/i18n/IntlProvider.js";

type FileRewindPreviewFile =
  | V4ConversationFileRewindPreviewResult["safeFiles"][number]
  | V4ConversationFileRewindPreviewResult["unsafeFiles"][number]
  | V4ConversationFileRewindPreviewResult["ignoredFiles"][number];

interface ConversationFileRewindDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: V4ConversationFileRewindPreviewResult | null;
  previewLoading: boolean;
  applying: boolean;
  error: string | null;
  onApply: () => void;
  variant?: "fileRewind" | "editConflict" | "conversationRevert";
  onConversationOnly?: () => void;
  /** conversationRevert：文案与文件区块的差异（见 chat.message.revert.dialog.*）。 */
  revertContents?: {
    /** 输入框已有草稿：回填会覆盖，需显式告知。 */
    discardsExistingDraft: boolean;
    /** 该轮没有文件改动 → 只回退对话，隐藏文件区块。 */
    noFileChanges: boolean;
  };
}

function formatReason(reason: string, intl: ReturnType<typeof useRaspberryCodeIntl>["intl"]) {
  const fallbackReasonKey = "chat.changeSummary.rewindDialog.reason.unsupportedCheckpoint";
  const keyByReason: Record<string, string> = {
    bash_ignored: "chat.changeSummary.rewindDialog.reason.bashIgnored",
    checkpoint_missing: "chat.changeSummary.rewindDialog.reason.checkpointMissing",
    checkpoint_unreadable: "chat.changeSummary.rewindDialog.reason.checkpointUnreadable",
    external_modified: "chat.changeSummary.rewindDialog.reason.externalModified",
    file_read_failed: "chat.changeSummary.rewindDialog.reason.fileReadFailed",
    unsupported_checkpoint: fallbackReasonKey,
  };
  return intl.formatMessage({ id: keyByReason[reason] ?? fallbackReasonKey });
}

function PreviewFileList({
  files,
  type,
}: {
  files: readonly FileRewindPreviewFile[];
  type: "safe" | "unsafe" | "ignored";
}) {
  const { intl } = useRaspberryCodeIntl();
  if (files.length === 0) return null;
  return (
    <div className="grid gap-1">
      {files.map((file) => (
        <div
          key={`${type}:${file.path}`}
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-input/30 px-2 py-1.5"
        >
          <span className="min-w-0 truncate font-mono text-ui-xs text-foreground">{file.path}</span>
          <span className="shrink-0 text-ui-xs text-foreground-subtle">
            {"reason" in file
              ? formatReason(file.reason, intl)
              : intl.formatMessage(
                  { id: "chat.changeSummary.rewindDialog.operationCount" },
                  { count: String(file.operationCount) },
                )}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ConversationFileRewindDialog({
  open,
  onOpenChange,
  preview,
  previewLoading,
  applying,
  error,
  onApply,
  variant = "fileRewind",
  onConversationOnly,
  revertContents,
}: ConversationFileRewindDialogProps) {
  const { intl } = useRaspberryCodeIntl();
  const isConversationRevert = variant === "conversationRevert";
  const safeCount = preview?.safeFiles.length ?? 0;
  const unsafeCount = preview?.unsafeFiles.length ?? 0;
  const ignoredCount = preview?.ignoredFiles.length ?? 0;
  const titleId = isConversationRevert
    ? "chat.message.revert.dialog.title"
    : variant === "editConflict"
      ? "chat.edit.workspaceConflict.title"
      : "chat.changeSummary.rewindDialog.title";
  const descriptionId = isConversationRevert
    ? revertContents?.noFileChanges === true
      ? "chat.message.revert.dialog.description.noFiles"
      : "chat.message.revert.dialog.description"
    : variant === "editConflict"
      ? "chat.edit.workspaceConflict.description"
      : "chat.changeSummary.rewindDialog.description";
  // 回退的阻断条件只看**已知的**不安全证据（unsafe / ignored）：
  // - 「本轮没有文件改动」不是阻断，那是只回退对话的正常路径；
  // - 预览未就绪 / 预览失败也不是阻断 —— 预览是只读告知，命令层提交前会重新预检并
  //   fail closed。把预览做成硬前置会让一个只读查询的延迟直接锁死回退入口
  //   （实测：无文件改动场景按钮长期 disabled，回退无法完成）。
  const revertBlocked =
    isConversationRevert && (unsafeCount > 0 || ignoredCount > 0);
  const confirmDisabled = isConversationRevert
    ? applying || revertBlocked
    : !preview?.canApply || applying || previewLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        data-testid={
          isConversationRevert
            ? TID_V4_REVERT_CONFIRM_DIALOG
            : variant === "editConflict"
              ? TID_V4_EDIT_WORKSPACE_CONFLICT_DIALOG
              : undefined
        }
      >
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: titleId })}</DialogTitle>
          <DialogDescription>{intl.formatMessage({ id: descriptionId })}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[50vh] gap-3 overflow-y-auto pr-1">
          {revertContents?.discardsExistingDraft ? (
            <p className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "chat.message.revert.dialog.discardDraft" })}
            </p>
          ) : null}
          {previewLoading ? (
            <div className="flex items-center gap-2 text-ui-base text-foreground-subtle">
              <Loader2Icon className="size-3.5 animate-spin" />
              {intl.formatMessage({ id: "chat.changeSummary.rewindDialog.loading" })}
            </div>
          ) : revertContents?.noFileChanges === true ? (
            <p className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "chat.message.revert.dialog.filesEmpty" })}
            </p>
          ) : preview ? (
            <>
              {isConversationRevert ? (
                <section className="grid gap-1">
                  <h3 className="text-ui-base font-medium">
                    {intl.formatMessage(
                      { id: "chat.message.revert.dialog.filesTitle" },
                      { count: String(safeCount) },
                    )}
                  </h3>
                  <PreviewFileList files={preview.safeFiles} type="safe" />
                </section>
              ) : variant === "fileRewind" ? (
                <section className="grid gap-1">
                  <h3 className="text-ui-base font-medium">
                    {intl.formatMessage(
                      { id: "chat.changeSummary.rewindDialog.safeTitle" },
                      { count: String(safeCount) },
                    )}
                  </h3>
                  <PreviewFileList files={preview.safeFiles} type="safe" />
                </section>
              ) : null}
              <section className="grid gap-1">
                <h3 className="text-ui-base font-medium">
                  {intl.formatMessage(
                    { id: "chat.changeSummary.rewindDialog.unsafeTitle" },
                    { count: String(unsafeCount) },
                  )}
                </h3>
                <PreviewFileList files={preview.unsafeFiles} type="unsafe" />
              </section>
              {ignoredCount > 0 ? (
                <section className="grid gap-1">
                  <h3 className="text-ui-base font-medium">
                    {intl.formatMessage(
                      { id: "chat.changeSummary.rewindDialog.ignoredTitle" },
                      { count: String(ignoredCount) },
                    )}
                  </h3>
                  <PreviewFileList files={preview.ignoredFiles} type="ignored" />
                </section>
              ) : null}
            </>
          ) : (
            <p className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "chat.changeSummary.rewindDialog.noPreview" })}
            </p>
          )}
          {error ? <p className="text-ui-base text-danger">{error}</p> : null}
          {revertBlocked && !error ? (
            <p className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "chat.message.revert.dialog.blocked" })}
            </p>
          ) : null}
          {variant === "fileRewind" && preview && !preview.canApply ? (
            <p className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "chat.changeSummary.rewindDialog.cannotApply" })}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          {isConversationRevert ? (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={applying}
                data-testid={TID_V4_REVERT_CANCEL}
                onClick={() => onOpenChange(false)}
              >
                {intl.formatMessage({ id: "common.cancel" })}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={confirmDisabled}
                data-testid={TID_V4_REVERT_CONFIRM}
                onClick={onApply}
              >
                {applying ? <Loader2Icon className="animate-spin" /> : <Undo2Icon />}
                {intl.formatMessage({ id: "chat.message.revert.dialog.confirm" })}
              </Button>
            </>
          ) : variant === "editConflict" ? (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={applying}
                onClick={() => onOpenChange(false)}
              >
                {intl.formatMessage({ id: "common.cancel" })}
              </Button>
              <Button
                type="button"
                disabled={applying || previewLoading}
                data-testid={TID_V4_EDIT_WORKSPACE_CONFLICT_CONVERSATION_ONLY}
                onClick={onConversationOnly}
              >
                {applying ? <Loader2Icon className="animate-spin" /> : null}
                {intl.formatMessage({ id: "chat.edit.workspaceConflict.conversationOnly" })}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="destructive"
              disabled={!preview?.canApply || applying || previewLoading}
              onClick={onApply}
            >
              {applying ? <Loader2Icon className="animate-spin" /> : <Undo2Icon />}
              {intl.formatMessage({ id: "chat.changeSummary.rewindDialog.confirm" })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
