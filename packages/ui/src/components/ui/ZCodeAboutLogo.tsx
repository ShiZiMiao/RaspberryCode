import { cn } from "@/components/lib/utils.js";
import markWhiteUrl from "@/assets/brand-mark-white.svg";
import wordmarkUrl from "@/assets/brand-wordmark.svg";

// Modified for RaspberryCode: 品牌标识图形替换为 RaspberryCode 标记/字标
// （原 RaspberryCode Z 形标记与字标为内联 SVG，现改用品牌资产文件）。
// 所有使用点均为固定深色底座，白色单色标记与原 currentColor 白色渲染一致。

export function ZCodeAboutLogo({ className }: { className?: string }) {
  return (
    <img
      src={markWhiteUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
}

export function ZCodeWordmarkLogo({ className }: { className?: string }) {
  return (
    <img
      src={wordmarkUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
}
