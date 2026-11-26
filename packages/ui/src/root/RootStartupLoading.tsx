import type { ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";
import { RaspberryCodeAboutLogo } from "@/components/ui/RaspberryCodeAboutLogo.js";
import titlebarMarkUrl from "@/assets/app-logo.svg";

interface RootStartupLoadingProps {
  label: string;
  children?: ReactNode;
  busy?: boolean;
}

export function RootStartupLoading({ label, children, busy = true }: RootStartupLoadingProps) {
  return (
    <div
      // Web 端全局 html/body/#root 为 Electron 透明背景让路，React 接管后会替换 HTML 启动壳。
      // 这里必须由阻塞态自身承接主题背景，否则远控链接会在 Root 恢复期间继续露出浏览器白底。
      className="flex h-full min-h-dvh flex-col items-center justify-center gap-6 bg-background text-foreground"
      role="status"
      aria-busy={busy}
      aria-label={label}
      data-testid="root-startup-loading"
    >
      <RaspberryCodeStartupLogoBadge bare />
      {children}
    </div>
  );
}

/**
 * 初始化与引导共用品牌图标，保持底色、描边、圆角和标志比例一致。
 *
 * Modified for RaspberryCode: 标题栏与启动动画改用透明标记，不再套深色底板——
 * 粉彩配色在纯黑底板上几乎不可辨，且产品要求这两处与系统图标风格统一为透明。
 * 引导页（onboarding）保留深色底板：那里叠在渐变背景上有光扫动画，深底是设计的一部分。
 */
export function RaspberryCodeStartupLogoBadge({
  animated = true,
  size = "default",
  bare = false,
}: {
  animated?: boolean;
  size?: "default" | "titlebar";
  /** 透明无背板：标题栏与启动动画使用；引导页保持默认（带深色底板）。 */
  bare?: boolean;
}) {
  // 标题栏：透明无背板，直接渲染粉彩标记。
  if (size === "titlebar") {
    return (
      <span
        data-desktop-logo-badge="true"
        className="relative flex size-5 items-center justify-center"
      >
        <RaspberryCodeTitlebarLogo className="size-auto w-3.25" animated={animated} />
      </span>
    );
  }

  // 启动动画：同样是透明粉彩，但保留 96px 容器尺寸与脉冲动画。
  if (bare) {
    return (
      <span
        data-desktop-logo-badge="true"
        className="relative flex size-24 items-center justify-center"
      >
        <RaspberryCodeTitlebarLogo className="h-auto w-14" animated={animated} />
      </span>
    );
  }

  return (
    <div
      className={cn(
        "relative flex items-center justify-center bg-[linear-gradient(180deg,#000000_0%,#151718_100%)] text-[#ffffff] before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border before:border-[rgba(255,255,255,0.1)] before:content-['']",
        "size-24 rounded-3xl shadow-xl/20",
      )}
    >
      {/* Button 会给 SVG 默认尺寸；紧凑 Logo 显式恢复自动高度，保持标志原始比例。 */}
      <RaspberryCodeStartupLogo className="h-auto w-14" animated={animated} />
    </div>
  );
}

export function RaspberryCodeStartupLogo({
  className,
  animated = true,
}: {
  className?: string;
  animated?: boolean;
}) {
  // Modified for RaspberryCode: 品牌标记改用 RaspberryCode 资产，复用 RaspberryCodeAboutLogo；
  // 呼吸动画由 SVG <animate> 改为 CSS 动画（animate-pulse），语义保持一致。
  return <RaspberryCodeAboutLogo className={cn(className, animated && "animate-pulse")} />;
}

/**
 * 标题栏专用的粉彩标记：透明无背板，直接用彩色原件（app-logo.svg 即设计源 mark-color.svg）。
 *
 * 不复用 RaspberryCodeAboutLogo：那个组件绑死了 brand-mark-white（单色白），
 * 而标题栏现在需要彩色。viewBox 与单色版同为 410x410（1:1），视觉尺寸与改造前基本一致。
 */
export function RaspberryCodeTitlebarLogo({
  className,
  animated = true,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    <img
      src={titlebarMarkUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className, animated && "animate-pulse")}
    />
  );
}
