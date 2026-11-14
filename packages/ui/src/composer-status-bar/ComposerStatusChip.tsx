import { useState, type ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card.js";
import {
  COMPOSER_STATUS_CHIP_CLASS_NAME,
  COMPOSER_STATUS_CHIP_ICON_CLASS_NAME,
  COMPOSER_STATUS_CHIP_LABEL_CLASS_NAME,
} from "./contract.js";

/**
 * 状态条胶囊 chip 外壳（specs/composer-status-bar.md）。
 *
 * 交互契约来自 composer 既有上下文容量入口（hover 打开、touch 端 pointerdown 打开）：
 * Radix HoverCard 会在 touchstart 里阻止后续 click，手机端点不开面板，因此触摸态在
 * pointerdown 阶段先打开；桌面端保持 hover/focus 语义。
 */
export function ComposerStatusChip({
  icon,
  label,
  ariaLabel,
  testId,
  panelTitle,
  panelSummary,
  children,
}: {
  icon: ReactNode;
  label: string;
  ariaLabel: string;
  testId: string;
  panelTitle: string;
  panelSummary?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <HoverCard open={open} onOpenChange={setOpen} closeDelay={80} openDelay={60}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          data-testid={testId}
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
            // 尺寸/间距/字号来自共享常量，与上下文容量 chip 同源（见 contract.ts）。
            "flex items-center",
            COMPOSER_STATUS_CHIP_CLASS_NAME,
            "text-foreground-subtle transition-colors",
            "hover:bg-hover hover:text-foreground focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-input-border-focused",
            open && "bg-hover text-foreground",
          )}
        >
          <span aria-hidden="true" className={COMPOSER_STATUS_CHIP_ICON_CLASS_NAME}>
            {icon}
          </span>
          <span className={COMPOSER_STATUS_CHIP_LABEL_CLASS_NAME}>{label}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        side="top"
        sideOffset={8}
        className={cn(
          "w-72 overflow-hidden rounded-xl border border-border bg-menu p-0 shadow-md",
        )}
      >
        <div className="flex items-baseline gap-3 px-3 pt-2.5 pb-2">
          <span className="shrink-0 text-ui-base font-medium text-foreground">{panelTitle}</span>
          {panelSummary ? (
            <span className="ml-auto shrink-0 text-right font-mono text-ui-sm text-foreground-subtle">
              {panelSummary}
            </span>
          ) : null}
        </div>
        <div className="mx-3 border-t border-border" />
        <div className="px-3 py-2">{children}</div>
      </HoverCardContent>
    </HoverCard>
  );
}

/** 明细行：左标签右数值，标签省略时数值右对齐。 */
export function ComposerStatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-1 text-ui-sm">
      <span className="min-w-0 truncate text-foreground-subtle">{label}</span>
      <span className="ml-auto shrink-0 font-mono tabular-nums text-foreground">{value}</span>
    </div>
  );
}
