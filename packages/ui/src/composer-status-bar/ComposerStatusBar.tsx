import { DatabaseIcon, GaugeIcon } from "lucide-react";
import { TID_CHAT_CONTEXT_USAGE_TRIGGER } from "@raspberrycode/shared/test-ids";
import type { SessionUsageState } from "@raspberrycode/shared/raspberrycode-protocol-v4";
import { cn } from "@/components/lib/utils.js";
import { useRaspberryCodeIntl } from "@/i18n/IntlProvider.js";
import {
  ContextUsagePanelBody,
  ContextUsageRingIcon,
  useContextUsageView,
} from "@/chat-input-toolbar/contextUsage.js";
import { formatCompactTokenNumber } from "@/lib/tokenNumberFormat.js";
import { ComposerStatusRow, ComposerStatusChip } from "./ComposerStatusChip.js";
import {
  buildRoundStepLabel,
  buildSessionStatLines,
  buildSessionStatSummary,
  buildTokenUsageLines,
  buildTokenUsageSummary,
  hasSessionStats,
  hasTokenUsage,
  type ComposerSessionUsageFacts,
} from "./contract.js";
import { useComposerSessionUsage } from "./useComposerSessionUsage.js";

export interface ComposerStatusBarProps {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string | null;
  /** 会话是否在产生新用量；决定用量快照的重查节拍。 */
  active: boolean;
  /** 会话投影的上下文容量事实（与工具条同一份，不另算）。 */
  usage: SessionUsageState | null;
  className?: string;
}

/**
 * 输入框下方的会话状态条（specs/composer-status-bar.md）。
 *
 * 三个 chip 从左到右：会话统计 / Token 用量 / 上下文容量。
 * 事实来源只有两处——`v4/conversation/usage`（token 与会话统计）与会话投影
 * `snapshot.usage`（上下文容量）；本组件不推算、不缓存第二份数字。
 *
 * 零数据态整条不渲染：新任务的空壳比没有更吵。
 */
export function ComposerStatusBar({
  workspacePath,
  workspaceIdentity,
  sessionId,
  active,
  usage,
  className,
}: ComposerStatusBarProps) {
  const { intl, locale } = useRaspberryCodeIntl();
  const sessionUsage = useComposerSessionUsage({
    workspacePath,
    workspaceIdentity,
    sessionId,
    active,
    enabled: sessionId !== null,
  });

  // Hooks 必须在任何提前 return 之前调用：容量视图内部是 useMemo。
  // 容量 chip 与工具条口径完全同源：同一份 useContextUsageView，不另算一份百分比。
  const contextView = useContextUsageView({
    taskUsage: usage?.contextWindow
      ? {
          used: usage.contextWindow.usedTokens,
          size: usage.contextWindow.maxTokens,
          ...(usage.contextWindow.cache ? { cache: usage.contextWindow.cache } : {}),
          ...(usage.contextWindow.breakdown
            ? { breakdown: usage.contextWindow.breakdown }
            : {}),
        }
      : null,
    intl,
    locale,
  });

  if (!sessionId) return null;

  const formatTokens = (value: number) => formatCompactTokenNumber(locale, value);
  const roundsLabel = intl.formatMessage({ id: "chat.statusBar.rounds" });
  const stepsLabel = intl.formatMessage({ id: "chat.statusBar.steps" });
  const tokensPerSecondUnit = intl.formatMessage({ id: "chat.statusBar.tokensPerSecondUnit" });
  const tokensUnit = intl.formatMessage({ id: "chat.statusBar.tokensUnit" });
  const secondsUnit = intl.formatMessage({ id: "chat.statusBar.secondsUnit" });

  const facts: ComposerSessionUsageFacts | null = sessionUsage;
  const sessionStatSummary = facts
    ? buildSessionStatSummary(facts, { rounds: roundsLabel, steps: stepsLabel }, {
        tokensPerSecond: tokensPerSecondUnit,
      })
    : null;
  const tokenUsageSummary = facts
    ? buildTokenUsageSummary(
        facts,
        formatTokens,
        {
          tokens: tokensUnit,
          cacheHit: intl.formatMessage({ id: "chat.statusBar.cacheHit" }),
        },
        locale,
      )
    : null;
  const sessionStatLines = facts
    ? buildSessionStatLines(facts, {
        modelDuration: intl.formatMessage({ id: "chat.statusBar.modelDuration" }),
        ttft: intl.formatMessage({ id: "chat.statusBar.ttft" }),
        tps: intl.formatMessage({ id: "chat.statusBar.tps" }),
        seconds: secondsUnit,
        tokensPerSecond: tokensPerSecondUnit,
      })
    : [];
  const tokenUsageLines = facts
    ? buildTokenUsageLines(
        facts,
        formatTokens,
        {
          cacheHit: intl.formatMessage({ id: "chat.statusBar.cacheHit" }),
          uncachedInput: intl.formatMessage({ id: "chat.statusBar.uncachedInput" }),
          cacheRead: intl.formatMessage({ id: "chat.statusBar.cacheRead" }),
          output: intl.formatMessage({ id: "chat.statusBar.output" }),
          tokens: tokensUnit,
        },
        locale,
      )
    : [];

  const showSessionStats = facts !== null && sessionStatSummary !== null;
  const showTokenUsage = facts !== null && tokenUsageSummary !== null;
  const showContextUsage = contextView !== null;

  // 零数据整行不渲染：草稿态与空会话不该在输入卡上方留一条空白带。
  if (!showSessionStats && !showTokenUsage && !showContextUsage) {
    return null;
  }

  return (
    <div
      data-testid="composer-status-bar"
      // 状态条是贴着输入卡右上角的悬浮块，自身宽度即内容宽度：
      // 右侧贴边由宿主容器的 `right-0` 决定，这里只负责排布三个 chip。
      // 不换行——换行会把悬浮块顶高、压住消息；窄宽度下由 chip 摘要省略承担压缩。
      // 占位行内的普通排布：宽度即内容宽度，由宿主容器决定靠右。不需要不透明底色——
      // 正文在它上方就停止，不会有内容从 chip 后面穿过。
      className={cn("flex min-w-0 items-center gap-x-1", className)}
    >
      {showSessionStats ? (
        <ComposerStatusChip
          testId="composer-status-chip-session"
          ariaLabel={intl.formatMessage({ id: "chat.statusBar.sessionStats" })}
          icon={<GaugeIcon className="size-3.5" />}
          label={sessionStatSummary}
          panelTitle={intl.formatMessage({ id: "chat.statusBar.sessionStats" })}
          panelSummary={buildRoundStepLabel(
            facts,
            { rounds: roundsLabel, steps: stepsLabel },
          )}
        >
          {sessionStatLines.length > 0 ? (
            sessionStatLines.map((line) => (
              <ComposerStatusRow key={line.id} label={line.label} value={line.value} />
            ))
          ) : (
            <div className="py-1 text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "chat.statusBar.noStats" })}
            </div>
          )}
        </ComposerStatusChip>
      ) : null}
      {showTokenUsage ? (
        <ComposerStatusChip
          testId="composer-status-chip-tokens"
          ariaLabel={intl.formatMessage({ id: "chat.statusBar.tokenUsage" })}
          icon={<DatabaseIcon className="size-3.5" />}
          label={tokenUsageSummary}
          panelTitle={intl.formatMessage({ id: "chat.statusBar.tokenUsage" })}
          panelSummary={`${formatTokens(facts.totalTokens)} ${tokensUnit}`}
        >
          {tokenUsageLines.map((line) => (
            <ComposerStatusRow key={line.id} label={line.label} value={line.value} />
          ))}
        </ComposerStatusChip>
      ) : null}
      {contextView ? (
        <ComposerStatusChip
          testId={TID_CHAT_CONTEXT_USAGE_TRIGGER}
          ariaLabel={contextView.contextUsageLabel}
          icon={
            <ContextUsageRingIcon
              usedTokens={contextView.usedTokens}
              maxTokens={contextView.maxTokens}
            />
          }
          label={contextView.percentageLabel}
          panelTitle={intl.formatMessage({ id: "chat.contextUsage.title" })}
          panelSummary={contextView.compactTokenUsageLabel}
        >
          {/* 标题区由 chip 外壳统一渲染，正文不再重复一份。 */}
          <ContextUsagePanelBody view={contextView} showHeader={false} />
        </ComposerStatusChip>
      ) : null}
    </div>
  );
}

/** 供会话容器判断是否需要占位；零数据时状态条不渲染，容器也不该留空白。 */
export function shouldShowComposerStatusBar(
  facts: ComposerSessionUsageFacts | null,
  hasContextWindow: boolean,
): boolean {
  return hasContextWindow || (facts !== null && (hasSessionStats(facts) || hasTokenUsage(facts)));
}
