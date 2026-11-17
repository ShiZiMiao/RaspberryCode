// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RootStartupLoading, RaspberryCodeStartupLogoBadge } from "@/root/RootStartupLoading.js";

describe("RootStartupLoading", () => {
  it("静态品牌图标不渲染呼吸动画", () => {
    const html = renderToStaticMarkup(
      createElement(RaspberryCodeStartupLogoBadge, { animated: false }),
    );
    // 默认分支（引导页）保留白色单色标记 + 深色底板。
    expect(html).toContain("brand-mark-white.svg");
    expect(html).not.toContain("animate-pulse");
  });
  it("启动阻塞态使用整体呼吸的 RaspberryCode 品牌图标而不是可见 loading 文案", () => {
    const html = renderToStaticMarkup(createElement(RootStartupLoading, { label: "加载中..." }));

    expect(html).toContain('data-testid="root-startup-loading"');
    expect(html).toContain('aria-label="加载中..."');
    // 启动动画走 bare 分支：透明粉彩标记（app-logo.svg），不再套深色底板。
    expect(html).toContain("app-logo.svg");
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain(">加载中...<");
  });
  it("启动动画不渲染深色底板", () => {
    const html = renderToStaticMarkup(createElement(RootStartupLoading, { label: "加载中..." }));
    expect(html).not.toContain("linear-gradient(180deg,#000000");
  });
  it("引导页仍保留深色底板", () => {
    const html = renderToStaticMarkup(
      createElement(RaspberryCodeStartupLogoBadge, { animated: false }),
    );
    expect(html).toContain("linear-gradient(180deg,#000000");
  });
});
