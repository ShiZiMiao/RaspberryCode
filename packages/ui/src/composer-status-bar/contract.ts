/**
 * 输入框下方状态条的纯格式化契约（specs/composer-status-bar.md）。
 *
 * 这里只做「事实 → 展示文本」的折算，不持有状态、不发起请求：
 * - 数据事实来自两处权威源：会话投影 `snapshot.usage`（上下文容量）与
 *   `v4/conversation/usage`（token/轮次/用时）。折算规则集中在此，供 chip 摘要与
 *   明细弹窗共用同一份口径，避免两处各算一遍出现不一致。
 * - 不可用值一律返回 null（由调用方省略该行），绝不退化成 0 —— 0 是「用了一点」，
 *   null 是「不知道」，把后者显示成前者会让用户误读缓存收益与速度。
 */

/**
 * 状态 chip 的**唯一**外观声明，三个 chip 全部经 `ComposerStatusChip` 外壳引用它。
 *
 * 历史教训（2026-11-13）：第一版容量 chip 直接复用 `ChatContextUsage`，它内部是
 * `Button` 且写死 `size="icon-md"`（固定 28px 方形），圆环与百分比被挤在一起，
 * 与前两个自适应宽度的 chip 间距明显不齐。现在的做法是**三个 chip 共用同一外壳**，
 * 容量 chip 只从 `contextUsage` 取视图与面板正文，不再自带按钮与独立样式。
 *
 * 约束：高度固定 `h-6`、内边距 `px-1.5`、图标-文字间距 `gap-1.5`、字号 `text-ui-sm`；
 * 宽度自适应内容，窄容器下允许压缩（`min-w-0 shrink`）。
 */
export const COMPOSER_STATUS_CHIP_CLASS_NAME =
  "h-6 min-w-0 shrink gap-1.5 rounded-md px-1.5 text-ui-sm font-normal";

/** 状态 chip 的图标槽：与 `lucide` 图标默认 16px 对齐，不参与压缩。 */
export const COMPOSER_STATUS_CHIP_ICON_CLASS_NAME =
  "flex size-3.5 shrink-0 items-center justify-center";

/**
 * 摘要文字：数值等宽，窄容器下省略而不是撑开容器。
 *
 * 底排形态下容器很挤——左侧有分支/权限/模式，右侧有很长的模型名，
 * 中间留给状态条的宽度可能只有一两百 px。此时逐个 chip 各自 truncate 会得到
 * 「5 轮 7 步·4…」「2…」这种没有信息量的碎片，反而不如整块收起。
 * 因此窄容器下把摘要文字整个隐藏，只留图标（图标本身有语义：仪表=会话统计、
 * 数据库=Token、圆环=容量，圆环还带用量弧），完整数字进悬停面板。
 */
export const COMPOSER_STATUS_CHIP_LABEL_CLASS_NAME =
  "min-w-0 truncate tabular-nums @max-[1180px]/composer:hidden";

/** `v4/conversation/usage` 中状态条消费的部分（协议完整结果见 shared transport）。 */
export interface ComposerSessionUsageFacts {
  totalTokens: number;
  outputTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheHitRate: number | null;
  roundCount: number;
  stepCount: number;
  modelDurationMs: number;
  avgTimeToFirstTokenMs: number | null;
  outputTokensPerSecond: number | null;
}

export interface ComposerSessionStatLine {
  id: "modelDuration" | "ttft" | "tps";
  label: string;
  value: string;
}

export interface ComposerTokenUsageLine {
  id: "cacheHitRate" | "uncachedInput" | "cacheRead" | "output";
  label: string;
  value: string;
}

const SECONDS_PER_MS = 1 / 1000;

/** 秒级时长：不足 10 秒保留 1 位小数（`0.8 秒` / `1.1 秒`），更长取整。 */
export function formatDurationSeconds(
  durationMs: number | null | undefined,
  secondsSuffix: string,
): string | null {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs)) {
    return null;
  }
  const seconds = Math.max(0, durationMs) * SECONDS_PER_MS;
  const digits = seconds < 10 ? 1 : 0;
  const formatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  return `${formatter.format(seconds)} ${secondsSuffix}`;
}

/** 速度只保留整数；`tok/s` 是单位不属于本地化文案。 */
export function formatTokensPerSecond(
  tokensPerSecond: number | null | undefined,
): string | null {
  if (
    tokensPerSecond === null ||
    tokensPerSecond === undefined ||
    !Number.isFinite(tokensPerSecond) ||
    tokensPerSecond <= 0
  ) {
    return null;
  }
  return String(Math.round(tokensPerSecond));
}

export function formatUsagePercent(
  ratio: number | null | undefined,
  locale: string,
): string | null {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
    return null;
  }
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(Math.min(1, Math.max(0, ratio)));
}

export function hasSessionStats(usage: ComposerSessionUsageFacts): boolean {
  return usage.roundCount > 0 || usage.stepCount > 0;
}

export function hasTokenUsage(usage: ComposerSessionUsageFacts): boolean {
  return usage.totalTokens > 0;
}

/**
 * 会话统计摘要：`1 轮 1 步 · 434 tok/s`。
 * 轮与步都是 0 时返回 null（chip 不渲染）；
 * TPS 不可用时省略该段而不是显示 `0 tok/s`。
 */
export function buildSessionStatSummary(
  usage: ComposerSessionUsageFacts,
  labels: { rounds: string; steps: string },
  units: { tokensPerSecond: string },
): string | null {
  if (!hasSessionStats(usage)) return null;
  const head = `${usage.roundCount} ${labels.rounds} ${usage.stepCount} ${labels.steps}`;
  const tps = formatTokensPerSecond(usage.outputTokensPerSecond);
  return tps === null ? head : `${head} · ${tps} ${units.tokensPerSecond}`;
}

/** Token 用量摘要：`9.9K tok · 缓存命中 47.3%`。命中率不可用时省略该段。 */
export function buildTokenUsageSummary(
  usage: ComposerSessionUsageFacts,
  formatTokens: (value: number) => string,
  labels: { tokens: string; cacheHit: string },
  locale: string,
): string | null {
  if (!hasTokenUsage(usage)) return null;
  const hitRate = formatUsagePercent(usage.cacheHitRate, locale);
  const head = `${formatTokens(usage.totalTokens)} ${labels.tokens}`;
  return hitRate === null ? head : `${head} · ${labels.cacheHit} ${hitRate}`;
}

/** 明细行：null 值行整行省略（不可用不等于 0）。 */
export function buildSessionStatLines(
  usage: ComposerSessionUsageFacts,
  messages: {
    modelDuration: string;
    ttft: string;
    tps: string;
    seconds: string;
    tokensPerSecond: string;
  },
): ComposerSessionStatLine[] {
  const lines: ComposerSessionStatLine[] = [];
  const duration = formatDurationSeconds(usage.modelDurationMs, messages.seconds);
  if (duration !== null) {
    lines.push({ id: "modelDuration", label: messages.modelDuration, value: duration });
  }
  const ttft = formatDurationSeconds(usage.avgTimeToFirstTokenMs, messages.seconds);
  if (ttft !== null) {
    lines.push({ id: "ttft", label: messages.ttft, value: ttft });
  }
  const tps = formatTokensPerSecond(usage.outputTokensPerSecond);
  if (tps !== null) {
    lines.push({
      id: "tps",
      label: messages.tps,
      value: `${tps} ${messages.tokensPerSecond}`,
    });
  }
  return lines;
}

export function buildTokenUsageLines(
  usage: ComposerSessionUsageFacts,
  formatTokens: (value: number) => string,
  messages: {
    cacheHit: string;
    uncachedInput: string;
    cacheRead: string;
    output: string;
    tokens: string;
  },
  locale: string,
): ComposerTokenUsageLine[] {
  const lines: ComposerTokenUsageLine[] = [];
  const hitRate = formatUsagePercent(usage.cacheHitRate, locale);
  if (hitRate !== null) {
    lines.push({ id: "cacheHitRate", label: messages.cacheHit, value: hitRate });
  }
  lines.push({
    id: "uncachedInput",
    label: messages.uncachedInput,
    value: `${formatTokens(usage.uncachedInputTokens)} ${messages.tokens}`,
  });
  lines.push({
    id: "cacheRead",
    label: messages.cacheRead,
    value: `${formatTokens(usage.cacheReadTokens)} ${messages.tokens}`,
  });
  lines.push({
    id: "output",
    label: messages.output,
    value: `${formatTokens(usage.outputTokens)} ${messages.tokens}`,
  });
  return lines;
}

/** 摘要里的轮/步计数：`1 轮 1 步`（明细弹窗标题右侧）。 */
export function buildRoundStepLabel(
  usage: ComposerSessionUsageFacts,
  labels: { rounds: string; steps: string },
): string {
  return `${usage.roundCount} ${labels.rounds} ${usage.stepCount} ${labels.steps}`;
}
