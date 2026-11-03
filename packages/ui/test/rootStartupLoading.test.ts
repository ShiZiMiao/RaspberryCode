import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RootStartupLoading, RaspberryCodeStartupLogoBadge } from "@/root/RootStartupLoading.js";

describe("RootStartupLoading", () => {
  it("静态品牌图标不渲染呼吸动画", () => {
    const html = renderToStaticMarkup(createElement(RaspberryCodeStartupLogoBadge, { animated: false }));
    // 品牌中立化后启动 Logo 是外置 SVG 文件（<img> 载体），动画语义由 animate-pulse 表达。
    expect(html).toContain("brand-mark-white.svg");
    expect(html).not.toContain("animate-pulse");
  });
  it("启动阻塞态使用整体呼吸的 RaspberryCode 品牌图标而不是可见 loading 文案", () => {
    const html = renderToStaticMarkup(createElement(RootStartupLoading, { label: "加载中..." }));

    expect(html).toContain('data-testid="root-startup-loading"');
    expect(html).toContain('aria-label="加载中..."');
    expect(html).toContain("brand-mark-white.svg");
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain(">加载中...<");
  });
});
