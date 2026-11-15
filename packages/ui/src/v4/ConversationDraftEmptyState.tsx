/**
 * 草稿态空态问候：时间问候语 + RaspberryCode Logo。
 * 自旧版 ChatView/ChatViewEmptyState.tsx 恢复（该组件随旧 ChatView 删除，
 * i18n key `chat.empty.greeting.*` 一直保留）；边界时刻自动换档逻辑保真。
 * 手机远控复用同一组件，但继续保留 20px 紧凑标题；桌面草稿首页才按标题自身宽度适配。
 */
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import brandMarkBlackUrl from "@/assets/brand-mark-black.svg";
import brandMarkWhiteUrl from "@/assets/brand-mark-white.svg";
import { cn } from "@/components/lib/utils.js";
import { useRaspberryCodeIntl } from "@/i18n/IntlProvider.js";
import { useIsOfficeMode } from "@/hooks/useInterfaceMode.js";
import { logger } from "@/logger.js";

const GREETING_BOUNDARY_HOURS = [5, 9, 12, 14, 18, 23] as const;
const GREETING_MIN_FONT_SIZE_PX = 20;
const GREETING_MAX_FONT_SIZE_PX = 30;

export type ChatEmptyGreetingMessageId =
  | "chat.empty.greeting.morningEarly"
  | "chat.empty.greeting.morning"
  | "chat.empty.greeting.noon"
  | "chat.empty.greeting.afternoon"
  | "chat.empty.greeting.evening"
  | "chat.empty.greeting.lateNight";

export function getChatEmptyGreetingMessageId(
  date: Date = new Date(),
): ChatEmptyGreetingMessageId {
  const hour = date.getHours();

  if (hour >= 5 && hour < 9) return "chat.empty.greeting.morningEarly";
  if (hour >= 9 && hour < 12) return "chat.empty.greeting.morning";
  if (hour >= 12 && hour < 14) return "chat.empty.greeting.noon";
  if (hour >= 14 && hour < 18) return "chat.empty.greeting.afternoon";
  if (hour >= 18 && hour < 23) return "chat.empty.greeting.evening";

  return "chat.empty.greeting.lateNight";
}

export function getNextChatEmptyGreetingDelayMs(date: Date = new Date()) {
  const candidates = GREETING_BOUNDARY_HOURS.map((hour) => {
    const boundary = new Date(date);
    boundary.setHours(hour, 0, 0, 0);
    return boundary;
  });
  const tomorrowFirstBoundary = new Date(date);
  tomorrowFirstBoundary.setDate(tomorrowFirstBoundary.getDate() + 1);
  tomorrowFirstBoundary.setHours(GREETING_BOUNDARY_HOURS[0], 0, 0, 0);

  const nextBoundary =
    candidates.find((candidate) => candidate.getTime() > date.getTime()) ??
    tomorrowFirstBoundary;

  return Math.max(1, nextBoundary.getTime() - date.getTime());
}

export function resolveGreetingFontSizePx({
  availableWidthPx,
  naturalTextWidthPx,
  compactForOverlay = false,
}: {
  availableWidthPx: number;
  naturalTextWidthPx: number;
  compactForOverlay?: boolean;
}) {
  if (compactForOverlay) {
    return GREETING_MIN_FONT_SIZE_PX;
  }
  if (
    !Number.isFinite(availableWidthPx) ||
    !Number.isFinite(naturalTextWidthPx) ||
    availableWidthPx <= 0 ||
    naturalTextWidthPx <= 0 ||
    availableWidthPx >= naturalTextWidthPx
  ) {
    return GREETING_MAX_FONT_SIZE_PX;
  }

  return Math.max(
    GREETING_MIN_FONT_SIZE_PX,
    Math.min(
      GREETING_MAX_FONT_SIZE_PX,
      Math.floor(
        GREETING_MAX_FONT_SIZE_PX * (availableWidthPx / naturalTextWidthPx),
      ),
    ),
  );
}

export function ConversationDraftEmptyState({
  className,
  compactForOverlay = false,
}: {
  className?: string;
  compactForOverlay?: boolean;
}) {
  const { intl } = useRaspberryCodeIntl();
  const isOfficeMode = useIsOfficeMode();
  const [greetingDate, setGreetingDate] = useState(() => new Date());
  const [greetingFontSizePx, setGreetingFontSizePx] = useState(
    GREETING_MAX_FONT_SIZE_PX,
  );
  const greetingContainerRef = useRef<HTMLParagraphElement | null>(null);
  const greetingMeasurementRef = useRef<HTMLSpanElement | null>(null);
  const greeting = intl.formatMessage({
    id: isOfficeMode
      ? "chat.empty.greeting.office"
      : getChatEmptyGreetingMessageId(greetingDate),
  });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setGreetingDate(new Date());
    }, getNextChatEmptyGreetingDelayMs(greetingDate));

    return () => {
      window.clearTimeout(timeout);
    };
  }, [greetingDate]);

  useLayoutEffect(() => {
    if (compactForOverlay) {
      setGreetingFontSizePx(GREETING_MIN_FONT_SIZE_PX);
      return;
    }
    const container = greetingContainerRef.current;
    const measurement = greetingMeasurementRef.current;
    if (!container || !measurement) {
      return;
    }

    let frameId: number | null = null;
    const measure = () => {
      frameId = null;
      const containerStyle = window.getComputedStyle(container);
      const horizontalPaddingPx =
        Number.parseFloat(containerStyle.paddingLeft) +
        Number.parseFloat(containerStyle.paddingRight);
      const availableWidthPx = Math.max(
        0,
        container.getBoundingClientRect().width - horizontalPaddingPx,
      );
      const naturalTextWidthPx = measurement.getBoundingClientRect().width;
      const nextFontSizePx = resolveGreetingFontSizePx({
        availableWidthPx,
        naturalTextWidthPx,
      });

      setGreetingFontSizePx((currentFontSizePx) => {
        if (currentFontSizePx === nextFontSizePx) {
          return currentFontSizePx;
        }
        logger.debug("[v4-draft-greeting] 标题自身可用宽度变化，更新字号", {
          availableWidthPx: Math.round(availableWidthPx),
          naturalTextWidthPx: Math.round(naturalTextWidthPx),
          previousFontSizePx: currentFontSizePx,
          nextFontSizePx,
        });
        return nextFontSizePx;
      });
    };
    const scheduleMeasure = () => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(measure);
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", scheduleMeasure);
      return () => {
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
        }
        window.removeEventListener("resize", scheduleMeasure);
      };
    }

    // 标题字号曾直接绑定整个视口宽度，最小窗口里文字两侧仍有大量空间却被
    // 强制缩到 20px。分别观察标题容器和 30px 原始文案，只在两者真实相撞时缩小。
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(container);
    observer.observe(measurement);
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      observer.disconnect();
    };
  }, [compactForOverlay, greeting]);

  return (
    <div
      className={cn(
        "relative mb-10 flex w-full max-w-2xl flex-col items-center justify-center gap-6 text-foreground sm:mb-8",
        // 品牌插画与问候语是纯展示装饰，设为不可选择，避免误拖选中。
        "select-none",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          // logo 参与布局（不是 absolute 装饰层），这样「logo + 问候语 + 输入卡」
          // 才是一个整体、能被真正垂直居中。
          //
          // 历史：它曾是 `absolute top-1/2 -translate-y-1/2 -mt-10`，向上溢出容器
          // 约 200px。居中只按「问候语 + 输入卡」计算，logo 的溢出部分不进布局，
          // 视觉重心因此偏上，用户反馈「不如把 logo 和输入框当一个整体居中」。
          //
          // 尺寸受宽度与高度双重约束：只取 `min(72vw,25rem)` 时矮窗口宽度不变而
          // 高度不够，插画会顶出滚动区被裁（实测 600px 高切掉叶尖）。`46vh` 上限
          // 让矮窗口自动缩小。
          //
          // 容器高度按「可见比例」给、图片保持 5/4 原比例绘制，底部那截由
          // `overflow-hidden` 裁掉，使**布局高度 == 可见高度**：
          // - 若整块 5/4 参与布局，插画自带的 `transparent 70%` 渐隐区会变成
          //   「logo 与问候语之间莫名一大段空白」；
          // - 若用负 margin 压掉它，布局比实际绘制矮、整组被算小后上移出界
          //   （实测 620 高窗口裁掉叶尖）。
          // 裁切是唯一让两者一致的做法。0.8 来自 5/4 比值，0.72 是可见比例。
          "pointer-events-none w-[min(72vw,46vh,25rem)] shrink-0 overflow-hidden text-foreground-subtlest",
          "h-[calc(min(72vw,46vh,25rem)*0.8*0.72)]",
        )}
      >
        <RaspberryCodeEmptyStateLogo className="block aspect-[5/4] w-full" />
      </div>
      <p
        ref={greetingContainerRef}
        data-v4-draft-greeting="true"
        style={
          {
            "--v4-draft-greeting-font-size": `${greetingFontSizePx}px`,
          } as CSSProperties
        }
        className={cn(
          "relative z-10 w-full px-4 text-center font-medium text-foreground",
          compactForOverlay
            ? "text-xl/[1.2]"
            : "text-[length:var(--v4-draft-greeting-font-size)]/[1.2]",
        )}
      >
        <span
          ref={greetingMeasurementRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute whitespace-nowrap text-3xl/[1.2]"
        >
          {greeting}
        </span>
        <span>{greeting}</span>
      </p>
    </div>
  );
}

function RaspberryCodeEmptyStateLogo({ className }: { className?: string }) {
  // Modified for RaspberryCode: 水印图形替换为 RaspberryCode 单色标记（原 RaspberryCode Z 形线框
  // 与夜间渐变资源），深浅主题各用一套单色资产，渐隐遮罩两套共用。
  const fadeMask = cn(
    "[-webkit-mask-image:linear-gradient(to_bottom,black_0%,transparent_70%,transparent_100%)]",
    "[-webkit-mask-repeat:no-repeat] [-webkit-mask-size:100%_100%]",
    "[mask-image:linear-gradient(to_bottom,black_0%,transparent_70%,transparent_100%)]",
    "[mask-repeat:no-repeat] [mask-size:100%_100%]",
  );
  return (
    <>
      <img
        aria-hidden="true"
        alt=""
        className={cn(className, fadeMask, "object-contain opacity-70 dark:hidden")}
        src={brandMarkBlackUrl}
      />
      {/* 主题类保证两套 Logo 互斥显示。 */}
      <img
        aria-hidden="true"
        alt=""
        className={cn(className, fadeMask, "hidden object-contain opacity-70 dark:block")}
        data-v4-draft-logo="dark"
        src={brandMarkWhiteUrl}
      />
    </>
  );
}
