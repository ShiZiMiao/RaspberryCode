// Modified for RaspberryCode: logo 钩子值随产品名同步
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DevicePlatformIcon, getDevicePlatformLabel } from "@raspberrycode/ui/device-platform-icon";
import { RaspberryCodeAppLogo } from "@raspberrycode/ui/app-logo";
import { BottomSheet, BottomSheetTrigger } from "@raspberrycode/ui/bottom-sheet";

describe("mobile presentation package boundary", () => {
  it.each(["darwin", "win32", "linux", "unknown"])(
    "renders platform %s without browser services",
    (platform) => {
      expect(renderToStaticMarkup(createElement(DevicePlatformIcon, { platform }))).toContain(
        "svg",
      );
      expect(getDevicePlatformLabel(platform)).toBe(
        { darwin: "macOS", win32: "Windows", linux: "Linux" }[platform],
      );
    },
  );
  it("retains logo and accessible dialog trigger exports", () => {
    expect(renderToStaticMarkup(createElement(RaspberryCodeAppLogo))).toContain('data-app-logo="raspberrycode"');
    expect(
      renderToStaticMarkup(
        createElement(BottomSheet, {}, createElement(BottomSheetTrigger, {}, "Choose")),
      ),
    ).toContain('aria-haspopup="dialog"');
  });
});
