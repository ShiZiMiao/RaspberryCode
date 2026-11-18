/**
 * 输入框工具条的「优化提示词」按钮（spec：docs/prompt-enhance.md）。
 *
 * 纯展示 + 一处编排：按钮自己不开请求，请求走调用方传入的 `onClick` / `onUndo`。
 * 这样草稿读写始终留在 composer，按钮不成为第二条草稿写入路径。
 *
 * 三态：
 * - `idle`：魔杖图标，点击发起优化。
 * - `pending`：spinner，点击取消（语义是「放弃这次结果」，见 spec）。
 * - `undo`：优化刚落地，按钮变成「撤销」。**这是撤销的唯一入口**——
 *   toast 的 `actionLabel` 在本仓库当前构建里不渲染（存量缺陷，见 docs/prompt-enhance.md
 *   「撤销入口」一节），所以不把可发现性押在它上面。
 *
 * 形态：**纯图标方钮**（同 `ChatPromptActionMenu` 的 `+`）。工具条的收起档位
 * （`data-composer-collapse-priority` 0~3）已被 Computer / mode / Plan / think 占满，
 * 再插一档要改收起裁决顺序；用图标钮把宽度成本降到 28px，不必挤进那套机制。
 */
import { Loader2, Undo2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useRaspberryCodeIntl } from "@/i18n/IntlProvider.js";

export interface PromptEnhanceButtonProps {
  /** 请求进行中：图标换成 spinner，点击语义变为取消。 */
  pending: boolean;
  /** 是否处于「可撤销」窗口：图标换成撤销，点击语义变为恢复原文。 */
  undoable: boolean;
  /** 是否可发起（有草稿 + 有可用模型）；false 时按钮禁用。 */
  disabled: boolean;
  /** 禁用原因：作为 tooltip 文案，避免按钮灰掉却不说为什么。 */
  disabledReason?: string;
  onClick: () => void;
  onUndo: () => void;
}

export function PromptEnhanceButton({
  pending,
  undoable,
  disabled,
  disabledReason,
  onClick,
  onUndo,
}: PromptEnhanceButtonProps) {
  const { intl } = useRaspberryCodeIntl();
  // 三态文案：进行中是「取消」，可撤销时是「撤销」，其余是「增强提示词」。
  // 用户必须能从按钮本身看出再点一次会发生什么。
  const label = pending
    ? intl.formatMessage({ id: "chat.promptEnhance.cancel" })
    : undoable
      ? intl.formatMessage({ id: "chat.promptEnhance.undo" })
      : intl.formatMessage({ id: "chat.promptEnhance.title" });
  const tooltip = pending
    ? intl.formatMessage({ id: "chat.promptEnhance.cancelDescription" })
    : undoable
      ? intl.formatMessage({ id: "chat.promptEnhance.undoDescription" })
      : (disabledReason ?? intl.formatMessage({ id: "chat.promptEnhance.description" }));

  // 进行中与可撤销都必须可点：它们本身就是「停止」和「回退」的唯一入口。
  const interactive = pending || undoable;
  const handleClick = pending ? onClick : undoable ? onUndo : onClick;

  return (
    <ControlHintTooltip title={tooltip}>
      <Button
        type="button"
        variant="ghost"
        size="icon-md"
        data-testid="chat-prompt-enhance-trigger"
        data-state={pending ? "pending" : undoable ? "undo" : "idle"}
        aria-label={label}
        aria-busy={pending || undefined}
        disabled={!interactive && disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleClick}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : undoable ? (
          <Undo2 className="size-4" />
        ) : (
          <WandSparkles className="size-4" />
        )}
        <span className="sr-only">{label}</span>
      </Button>
    </ControlHintTooltip>
  );
}
