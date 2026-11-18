import { DatabaseIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { ModelSelectionView } from "@raspberrycode/services";
import { isBuiltinModelProviderId } from "@raspberrycode/shared";
import { TID_V4_TURN_USAGE_CHIP, TID_V4_TURN_USAGE_PANEL } from "@raspberrycode/shared/test-ids";
import type { TurnHeaderRow } from "@raspberrycode/shared/raspberrycode-protocol-v4";
import { cn } from "@/components/lib/utils.js";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card.js";
import { useRaspberryCodeIntl } from "@/i18n/IntlProvider.js";
import { formatCompactTokenNumber } from "@/lib/tokenNumberFormat.js";

type TurnUsage = NonNullable<TurnHeaderRow["usage"]>;

interface TurnUsageView {
  /** chip 摘要：`用量 569K tok · 缓存命中 99.6%`。 */
  summary: string;
  /** 面板标题右侧的合计：`569,290 tok`。 */
  totalLabel: string;
  rows: Array<{ id: string; label: string; value: string }>;
}

/**
 * 用量事实 → 展示文本的纯折算（不持状态、不发起请求）。
 *
 * 与 composer 状态条的 `contract.ts` 同一条纪律：不可用值一律缺席而不是退化成 0。
 * 抽出来是因为 chip 摘要与面板正文必须用同一份口径——两处各算一遍，缓存命中率
 * 一旦对不上就是用户最直接能看到的不一致。
 */
export function useTurnUsageView(
  usage: TurnUsage,
  modelSelectionView?: ModelSelectionView | null,
): TurnUsageView {
  const { intl, locale } = useRaspberryCodeIntl();
  return useMemo(
    () => buildTurnUsageView(usage, intl, locale, modelSelectionView),
    [intl, locale, usage, modelSelectionView],
  );
}

function buildTurnUsageView(
  usage: TurnUsage,
  intl: ReturnType<typeof useRaspberryCodeIntl>["intl"],
  locale: string,
  modelSelectionView?: ModelSelectionView | null,
): TurnUsageView {
  const formatTokens = (value: number) => formatCompactTokenNumber(locale, value);
  const tokensUnit = intl.formatMessage({ id: "chat.statusBar.tokensUnit" });
  // 合计只取 input + output：缓存读写是 input 侧的拆分，再叠一次会让总数虚高，
  // 与 `snapshot.usage.cumulative` 的记账口径也不一致。
  const total = usage.inputTokens + usage.outputTokens;
  const hitRate = cacheHitRateOf(usage);
  const hitRateLabel =
    hitRate === null
      ? null
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 1, style: "percent" }).format(
          hitRate,
        );
  // chip 摘要只说「用了多少」：缓存命中率是判断「值不值」的次级信息，塞进一行会
  // 把动作行撑长、挤掉同排的图标按钮。它在悬浮面板里单独成行。
  const summary = intl.formatMessage(
    { id: "chat.message.usage.summary" },
    { tokens: formatTokens(total) },
  );

  const providerModel = formatTurnUsageProviderLabel(usage, modelSelectionView);
  const rows: TurnUsageView["rows"] = [];
  if (providerModel) {
    rows.push({
      id: "provider",
      label: intl.formatMessage({ id: "chat.message.usage.providerModel" }),
      // 提供方与模型合成一行：面板宽度有限，拆两行会把缓存明细挤到折线以下。
      value: providerModel,
    });
  }
  if (hitRateLabel) {
    rows.push({
      id: "cacheHit",
      label: intl.formatMessage({ id: "chat.message.usage.cacheHit" }),
      value: hitRateLabel,
    });
  }
  rows.push(
    {
      id: "uncachedInput",
      label: intl.formatMessage({ id: "chat.message.usage.uncachedInput" }),
      value: `${formatTokens(Math.max(0, usage.inputTokens - usage.cacheReadTokens))} ${tokensUnit}`,
    },
    {
      id: "cacheRead",
      label: intl.formatMessage({ id: "chat.message.usage.cacheRead" }),
      value: `${formatTokens(usage.cacheReadTokens)} ${tokensUnit}`,
    },
    {
      id: "output",
      label: intl.formatMessage({ id: "chat.message.usage.output" }),
      value: `${formatTokens(usage.outputTokens)} ${tokensUnit}`,
    },
  );

  return { summary, totalLabel: `${formatTokens(total)} ${tokensUnit}`, rows };
}

/**
 * 轮尾「本轮用量」chip（轮级 token 明细的展示位）。
 *
 * 事实只有一个来源：`turnHeaderRow.usage`（CLI 权威投影累加的主链路 ModelComplete）。
 * UI 不做第二次求和，也不拿 `snapshot.usage.cumulative`（会话级、跨轮累计）冒充本轮——
 * 两个口径混用会让用户对不上号。
 *
 * 交互沿用输入框状态条 chip 的语义：hover/focus 打开、触屏 pointerdown 打开。
 * 独立实现而不复用 `ComposerStatusChip`，因为那个外壳的尺寸/隐藏规则绑定在
 * composer 的窄容器上下文里（`@max-[1180px]/composer:hidden`），搬进消息行会永远隐身。
 */
export function TurnUsageChip({
  usage,
  modelSelectionView,
  className,
}: {
  usage: TurnUsage;
  /** 会话的提供方目录：把 usage.provider（providerId）换成用户看得懂的显示名。 */
  modelSelectionView?: ModelSelectionView | null;
  className?: string;
}) {
  const view = useTurnUsageView(usage, modelSelectionView);
  const { intl } = useRaspberryCodeIntl();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <HoverCard open={open} onOpenChange={setOpen} closeDelay={80} openDelay={60}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={view.summary}
          aria-describedby={open ? panelId : undefined}
          data-testid={TID_V4_TURN_USAGE_CHIP}
          onPointerDown={(event) => {
            if (
              !event.defaultPrevented &&
              event.pointerType === "touch" &&
              typeof window !== "undefined" &&
              window.matchMedia?.("(hover: none)").matches
            ) {
              setOpen(true);
            }
          }}
          className={cn(
            "flex h-6 min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 text-ui-sm font-normal",
            "text-foreground-subtle transition-colors",
            "hover:bg-hover hover:text-foreground focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-input-border-focused",
            open && "bg-hover text-foreground",
            className,
          )}
        >
          <span aria-hidden="true" className="flex size-3.5 shrink-0 items-center justify-center">
            <DatabaseIcon className="size-3.5" />
          </span>
          <span className="min-w-0 truncate tabular-nums">{view.summary}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        side="top"
        sideOffset={8}
        // 面板比状态条 chip 宽一档：`sjfd/DeepSeek-V4.1-Flash-1017` 这类
        // 「提供方/模型」是完整身份串，w-64 会把模型名截成 `DeepSee...`，
        // 而识别「这轮用的哪个模型」正是这一行的唯一用途。
        className="w-80 overflow-hidden rounded-xl border border-border bg-menu p-0 shadow-md"
      >
        <TurnUsagePanelBody view={view} panelId={panelId} />
      </HoverCardContent>
    </HoverCard>
  );
}

/** 面板正文：标题 + 合计 + 明细行。独立导出以便静态渲染测试（HoverCard 内容是 Portal）。 */
export function TurnUsagePanelBody({ view, panelId }: { view: TurnUsageView; panelId?: string }) {
  const { intl } = useRaspberryCodeIntl();
  return (
    <div id={panelId} data-testid={TID_V4_TURN_USAGE_PANEL}>
      <div className="flex items-baseline gap-3 px-3 pt-2.5 pb-2">
        <span className="shrink-0 text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "chat.message.usage.title" })}
        </span>
        <span className="ml-auto shrink-0 font-mono text-ui-sm tabular-nums text-foreground-subtle">
          {view.totalLabel}
        </span>
      </div>
      <div className="mx-3 border-t border-border" />
      <div className="px-3 py-2">
        {view.rows.map((row) => (
          <div key={row.id} className="flex min-w-0 items-center gap-3 py-1 text-ui-sm">
            <span className="shrink-0 text-foreground-subtle">{row.label}</span>
            {/* 身份串（提供方/模型）允许换行、不截断：截成 `DeepSee…` 会让这一行失去
                全部意义。token 数值是纯数字、天然短，保持截断兜底更稳妥。 */}
            <span
              className={cn(
                "ml-auto min-w-0 text-right font-mono tabular-nums text-foreground",
                row.id === "provider" ? "break-all" : "shrink-0 max-w-[9rem] truncate",
              )}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 把 `usage.provider`（磁盘上的 providerId）折算成用户能认出的显示名。
 *
 * 为什么必须在这一层转：CLI 只知道 providerId。用户自建连接时 id 是自动生成的
 * （`new-provider`），他给这条连接起的名字（`SJFD`）存在 provider_config 的
 * `providerName`，只有渲染侧拿得到。直接显示 id 会把「SJFD」变成一串机器标识，
 * 用户会以为选错了地方。
 *
 * 与时间线的模型切换标记共用 `resolveProviderLabel`：同一条连接在轮尾、分隔线、
 * 输入框触发器里必须叫同一个名字，各写一份解析必然漂移。
 *
 * 目录里查不到（历史会话的连接已被删、跨机器开启的会话）时退回 providerId，但
 * 不拼成 `id/model`——原始 id 和模型名放一起只会更像乱码。
 */
function formatTurnUsageProviderLabel(
  usage: TurnUsage,
  modelSelectionView?: ModelSelectionView | null,
): string | undefined {
  const providerId = usage.provider?.trim();
  const modelName = usage.model?.trim();
  if (!providerId && !modelName) return undefined;

  // 必须显式判断「是否命中目录」：`resolveProviderLabel` 在查不到时会回落成 id
  // 本身，用它的返回值真假分不清「命中了但没名字」和「压根没这条连接」。
  const registered = providerId
    ? modelSelectionView?.providers.find((provider) => provider.providerId === providerId)
    : undefined;
  const providerLabel = registered?.providerName?.trim() || (registered ? providerId : undefined);

  if (providerId && modelName) {
    // 内置预置供应商只显示模型名（与 composer 触发器同一口径）。
    if (isBuiltinModelProviderId(providerId)) return modelName;
    // 目录里没有这条连接（历史会话的连接已删、跨机器开启）：只留模型名，
    // 别把自动生成的 id 拼进标签——`deleted-provider/DeepSeek-…` 只会像乱码。
    if (!providerLabel) return modelName;
    return `${providerLabel}/${modelName}`;
  }
  return providerLabel || modelName;
}

/**
 * 缓存命中率：分母是本轮 input 侧总量，分子是其中的缓存读取。
 *
 * 返回 null 表示「无法计算」——inputTokens 为 0 时强行算 0% 会把「没有输入」显示成
 * 「缓存完全没命中」，与状态条 contract.ts 的 null 语义保持一致。
 */
function cacheHitRateOf(usage: TurnUsage): number | null {
  if (usage.inputTokens <= 0) return null;
  return Math.min(1, Math.max(0, usage.cacheReadTokens / usage.inputTokens));
}
