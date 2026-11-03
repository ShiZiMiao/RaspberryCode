// Modified for RaspberryCode: 断言随产品名同步
import { describe, expect, it } from "vitest";

describe("desktop deep link url helpers", () => {
  it("recognizes only the unified OAuth callback url", async () => {
    const { isOAuthCallbackUrl } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(isOAuthCallbackUrl(new URL("raspberrycode://oauth/callback?code=1&state=s"))).toBe(true);
    expect(isOAuthCallbackUrl(new URL("raspberrycode://bigmodel-auth/callback?authCode=1&state=s"))).toBe(
      false,
    );
    expect(isOAuthCallbackUrl(new URL("raspberrycode://zai-auth/callback?code=1&state=s"))).toBe(false);
    expect(isOAuthCallbackUrl(new URL("raspberrycode://oauth/other?code=1&state=s"))).toBe(false);
    expect(isOAuthCallbackUrl(new URL("https://oauth/callback?code=1&state=s"))).toBe(false);
  });

  it("accepts Linux one-slash callback urls", async () => {
    const { isOAuthCallbackUrl } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(isOAuthCallbackUrl(new URL("raspberrycode:/oauth/callback?code=1&state=s"))).toBe(true);
    expect(isOAuthCallbackUrl(new URL("raspberrycode:oauth/callback?code=1&state=s"))).toBe(true);
  });

  it("recognizes workspace open urls and extracts the encoded folder path", async () => {
    const { extractWorkspaceOpenPath, isWorkspaceOpenUrl } =
      await import("../src/main/desktopDeepLinkUrl.js");

    const workspaceUrl = new URL("raspberrycode://workspace/open?path=%2FUsers%2Fdemo%2FProject%20A%26B");
    expect(isWorkspaceOpenUrl(workspaceUrl)).toBe(true);
    expect(extractWorkspaceOpenPath(workspaceUrl)).toBe("/Users/demo/Project A&B");
    expect(isWorkspaceOpenUrl(new URL("raspberrycode://workspace/other?path=%2Ftmp"))).toBe(false);
    expect(extractWorkspaceOpenPath(new URL("raspberrycode://workspace/open"))).toBeNull();
  });

  it("extracts protocol urls from desktop argv variants", async () => {
    const { extractDeepLinkUrlFromArgs } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(
      extractDeepLinkUrlFromArgs(["/opt/RaspberryCode/raspberrycode", "raspberrycode://oauth/callback?code=1&state=s"]),
    ).toBe("raspberrycode://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs([
        "/opt/RaspberryCode/raspberrycode",
        "--open-url=raspberrycode://oauth/callback?code=1&state=s",
      ]),
    ).toBe("raspberrycode://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs([
        "/opt/RaspberryCode/raspberrycode",
        "raspberrycode%3A%2F%2Foauth%2Fcallback%3Fcode%3D1%26state%3Ds",
      ]),
    ).toBe("raspberrycode://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs([
        "/opt/RaspberryCode/raspberrycode",
        "raspberrycode%253A%252F%252Foauth%252Fcallback%253Fcode%253D1%2526state%253Ds",
      ]),
    ).toBe("raspberrycode://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs(["/opt/RaspberryCode/raspberrycode", "raspberrycode://oauth/callback?code=1", "&state=s"]),
    ).toBe("raspberrycode://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs(["/opt/RaspberryCode/raspberrycode", "raspberrycode://oauth/callback?code=1&amp;state=s"]),
    ).toBe("raspberrycode://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs([
        "/opt/RaspberryCode/raspberrycode",
        "raspberrycode://oauth/callback",
        "?code=1",
        "&state=s",
      ]),
    ).toBe("raspberrycode://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs([
        "/Applications/RaspberryCode.app/Contents/MacOS/RaspberryCode",
        "raspberrycode://workspace/open?path=%2FUsers%2Fdemo%2FProject%2520A",
      ]),
    ).toBe("raspberrycode://workspace/open?path=%2FUsers%2Fdemo%2FProject%2520A");
  });

  it("returns null when argv does not contain a deep link", async () => {
    const { extractDeepLinkUrlFromArgs } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(extractDeepLinkUrlFromArgs(["/opt/RaspberryCode/raspberrycode", "--no-sandbox"])).toBeNull();
  });

  it("extracts Windows open workspace argv without URL decoding", async () => {
    const { extractOpenWorkspacePathFromArgs } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(
      extractOpenWorkspacePathFromArgs([
        "C:\\Program Files\\RaspberryCode\\RaspberryCode.exe",
        "--open-workspace",
        "C:\\Users\\demo\\Project A&B#1",
      ]),
    ).toBe("C:\\Users\\demo\\Project A&B#1");
    expect(
      extractOpenWorkspacePathFromArgs([
        "C:\\Program Files\\RaspberryCode\\RaspberryCode.exe",
        "--open-workspace=C:\\Users\\demo\\Project%20A",
      ]),
    ).toBe("C:\\Users\\demo\\Project%20A");
    expect(extractOpenWorkspacePathFromArgs(["RaspberryCode.exe", "--open-workspace", 'C:"'])).toBe("C:\\");
    expect(extractOpenWorkspacePathFromArgs(["RaspberryCode.exe", "--open-workspace", 'C:\\repo"'])).toBe(
      "C:\\repo\\",
    );
    expect(extractOpenWorkspacePathFromArgs(["RaspberryCode.exe", "--open-workspace"])).toBeNull();
  });

  it("passes parsed deep links through single instance additionalData", async () => {
    const {
      createDeepLinkSingleInstanceData,
      extractDeepLinkUrlFromSingleInstanceData,
      extractOpenWorkspacePathFromSingleInstanceData,
    } = await import("../src/main/desktopDeepLinkUrl.js");

    const additionalData = createDeepLinkSingleInstanceData([
      "/opt/RaspberryCode/raspberrycode",
      "raspberrycode%253A%252F%252Foauth%252Fcallback%253Fcode%253D1%2526state%253Ds",
      "--open-workspace=C:\\Users\\demo\\Project A",
    ]);

    expect(extractDeepLinkUrlFromSingleInstanceData(additionalData)).toBe(
      "raspberrycode://oauth/callback?code=1&state=s",
    );
    expect(extractOpenWorkspacePathFromSingleInstanceData(additionalData)).toBe(
      "C:\\Users\\demo\\Project A",
    );
    expect(extractDeepLinkUrlFromSingleInstanceData({ deepLinkUrl: "https://example.com" })).toBe(
      null,
    );
  });

  it("builds Windows Explorer registry operations for folder context menu", async () => {
    const { buildWindowsOpenFolderCommand, buildWindowsOpenFolderRegistryOperations } =
      await import("../src/main/desktopWindowsOpenFolderContextMenu.js");

    expect(buildWindowsOpenFolderCommand("C:\\Program Files\\RaspberryCode\\RaspberryCode.exe")).toBe(
      '"C:\\Program Files\\RaspberryCode\\RaspberryCode.exe" --open-workspace "%1"',
    );
    expect(
      buildWindowsOpenFolderCommand("C:\\Electron\\electron.exe", ["C:\\repo\\desktop\\main.js"]),
    ).toBe('"C:\\Electron\\electron.exe" "C:\\repo\\desktop\\main.js" --open-workspace "%1"');

    const operations = buildWindowsOpenFolderRegistryOperations({
      executablePath: "C:\\Program Files\\RaspberryCode\\RaspberryCode.exe",
      locale: "en-US",
    });

    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\RaspberryCode.OpenInRaspberryCode\\command",
        "/ve",
        "/d",
        '"C:\\Program Files\\RaspberryCode\\RaspberryCode.exe" --open-workspace "%1"',
        "/f",
      ],
    });
    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Drive\\shell\\RaspberryCode.OpenInRaspberryCode\\command",
        "/ve",
        "/d",
        '"C:\\Program Files\\RaspberryCode\\RaspberryCode.exe" --open-workspace "%1"',
        "/f",
      ],
    });
  });

  it("builds localized Windows Explorer registry menu labels", async () => {
    const { buildWindowsOpenFolderRegistryOperations, getWindowsOpenFolderMenuName } =
      await import("../src/main/desktopWindowsOpenFolderContextMenu.js");

    expect(getWindowsOpenFolderMenuName("zh-CN")).toBe("在RaspberryCode中打开");
    expect(getWindowsOpenFolderMenuName("en-US")).toBe("Open in RaspberryCode");

    const operations = buildWindowsOpenFolderRegistryOperations({
      executablePath: "C:\\Program Files\\RaspberryCode\\RaspberryCode.exe",
      locale: "zh-CN",
    });

    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\RaspberryCode.OpenInRaspberryCode",
        "/ve",
        "/d",
        "在RaspberryCode中打开",
        "/f",
      ],
    });
    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\RaspberryCode.OpenInRaspberryCode",
        "/v",
        "MUIVerb",
        "/t",
        "REG_SZ",
        "/d",
        "在RaspberryCode中打开",
        "/f",
      ],
    });
  });
});
