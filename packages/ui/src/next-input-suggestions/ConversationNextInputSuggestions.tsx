/**
 * 下一步输入预测建议条（spec：specs/next-input-suggestions.md）。
 *
 * 点击建议条直接发送；悬浮出现「添加到对话框」，把文本追加到输入框。
 * 无候选时返回 null，不占位。
 */
import { ArrowRight, MessageSquarePlus } from "lucide-react";
import {
  TID_V4_NEXT_INPUT_SUGGESTION,
  TID_V4_NEXT_INPUT_SUGGESTION_ADD,
  TID_V4_NEXT_INPUT_SUGGESTIONS,
  testId,
} from "@raspberrycode/shared/test-ids";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { useRaspberryCodeIntl } from "@/i18n/IntlProvider.js";
import {
  useNextInputSuggestions,
  type UseNextInputSuggestionsParams,
} from "./useNextInputSuggestions.js";

export interface ConversationNextInputSuggestionsProps extends UseNextInputSuggestionsParams {
  onSend: (text: string) => void;
  onInsertToComposer: (text: string) => void;
}

export function ConversationNextInputSuggestions({
  onSend,
  onInsertToComposer,
  ...predictionParams
}: ConversationNextInputSuggestionsProps) {
  const { intl } = useRaspberryCodeIntl();
  const { candidates } = useNextInputSuggestions(predictionParams);
  if (candidates.length === 0) return null;
  const addToComposerLabel = intl.formatMessage({
    id: "chat.nextInputSuggestions.addToComposer",
  });
  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={0} disableHoverableContent>
      <div
        data-v4-next-input-suggestions="true"
        data-testid={TID_V4_NEXT_INPUT_SUGGESTIONS}
        className={cn(
          "flex gap-2",
          // 多条候选纵向排列，避免长文本横向挤压；单条保持行内。
          candidates.length > 1 ? "flex-col items-start" : "flex-row items-center",
        )}
      >
        {candidates.map((text, index) => (
          <div key={text} className="group/suggestion flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 max-w-[280px] gap-1.5 rounded-full px-3 text-ui-sm font-normal"
              data-testid={testId(TID_V4_NEXT_INPUT_SUGGESTION, String(index))}
              aria-label={intl.formatMessage({ id: "chat.nextInputSuggestions.send" })}
              onClick={() => onSend(text)}
            >
              <span className="min-w-0 truncate">{text}</span>
              <ArrowRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-foreground-subtle"
              />
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full opacity-0 transition-opacity group-hover/suggestion:opacity-100 focus-visible:opacity-100"
                  data-testid={testId(TID_V4_NEXT_INPUT_SUGGESTION_ADD, String(index))}
                  aria-label={addToComposerLabel}
                  onClick={() => onInsertToComposer(text)}
                >
                  <MessageSquarePlus aria-hidden="true" className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{addToComposerLabel}</TooltipContent>
            </Tooltip>
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}
