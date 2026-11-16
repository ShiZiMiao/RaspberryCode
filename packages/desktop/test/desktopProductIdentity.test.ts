// Modified for RaspberryCode: 产品身份断言随品牌改名更新
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  desktopProductIdentities,
  resolveDesktopArtifactSuffix,
  resolveDesktopProductFlavor,
  resolveWindowsAppUserModelId,
  resolveWindowsAppUserModelIdForFlavor,
  resolveDesktopProductIdentity,
} from "../scripts/desktop-product-identity.mjs";

describe("desktop product identity", () => {
  it("根 package.json 版本与 desktop 包版本一致", () => {
    // 修复原因（2026-11-15）：本仓库用 pnpm，根锁文件是 pnpm-lock.yaml，它不记录根包
    // 自身版本（只有 lockfileVersion 与依赖快照）。原断言读 package-lock.json 是上游
    // npm 时代的遗留，在本仓必然 ENOENT。
    // 这里改查真正生效的一致性约束：electron-builder 取 desktop 包的 version 生成安装包名
    // 与 latest.yml，根 package.json 必须跟随，否则产物名与仓库版本错位。
    // 锁文件层的一致性由 scripts/release-gate.mjs 的「版本一致性」段负责。
    const readRootJson = (name: string) =>
      JSON.parse(readFileSync(resolve(import.meta.dirname, "../../..", name), "utf8"));
    const version = readRootJson("package.json").version;
    const desktopVersion = readRootJson("packages/desktop/package.json").version;
    expect(desktopVersion).toBe(version);
  });

  it("RASPBERRYCODE_ENV=test 使用可与生产版并排安装的 Preview 身份", () => {
    expect(resolveDesktopProductIdentity({ RASPBERRYCODE_ENV: "test" })).toEqual({
      flavor: "preview",
      appId: "dev.raspberrycode.app.preview",
      productName: "RaspberryCode Preview",
      linuxExecutableName: "raspberrycode-preview",
      linuxPackageName: "raspberrycode-preview",
      cuaHelperInstallVariant: "preview",
    });
  });

  it("RASPBERRYCODE_PREVIEW_IDENTITY=1 让生产后端的构建改用 Preview 身份", () => {
    // 身份与后端环境分轴：同一份 Preview 身份既可以连测试后端，也可以连生产后端。
    for (const flag of ["1", " 1 "]) {
      const env = { RASPBERRYCODE_ENV: "production", RASPBERRYCODE_PREVIEW_IDENTITY: flag };
      expect(resolveDesktopProductFlavor(env)).toBe("preview");
      expect(resolveDesktopProductIdentity(env)).toBe(desktopProductIdentities.preview);
    }
    for (const flag of ["", "0"]) {
      const env = { RASPBERRYCODE_ENV: "production", RASPBERRYCODE_PREVIEW_IDENTITY: flag };
      expect(resolveDesktopProductFlavor(env)).toBe("production");
    }
  });

  it("开关只认 1/0：其它拼写在构建期直接失败，不能在路由层漏匹配却在脚本层开启", () => {
    // CI workflow 规则与 release 门做 == "1" 精确比较；若脚本层再接受 true/yes/on，
    // `RASPBERRYCODE_PREVIEW_IDENTITY=true` 会落入 @electron/dev 生产验收目录却打出 Preview 身份包。
    for (const flag of ["true", "yes", "on", "false", "no", "off", "2"]) {
      expect(() =>
        resolveDesktopProductFlavor({ RASPBERRYCODE_ENV: "production", RASPBERRYCODE_PREVIEW_IDENTITY: flag }),
      ).toThrow(/expected 1 or 0/);
    }
  });

  it("测试后端永远是 Preview 身份，开关无法把它变成正式 RaspberryCode", () => {
    expect(resolveDesktopProductFlavor({ RASPBERRYCODE_ENV: "test", RASPBERRYCODE_PREVIEW_IDENTITY: "0" })).toBe(
      "preview",
    );
    expect(resolveDesktopProductFlavor({ RASPBERRYCODE_ENV: "test", RASPBERRYCODE_PREVIEW_IDENTITY: "1" })).toBe(
      "preview",
    );
  });

  it("产物后缀只标记后端环境，生产后端的 Preview 包靠 productName 区分", () => {
    expect(resolveDesktopArtifactSuffix({ RASPBERRYCODE_ENV: "test" })).toBe("_TEST");
    expect(resolveDesktopArtifactSuffix({ RASPBERRYCODE_ENV: "production" })).toBe("");
    expect(
      resolveDesktopArtifactSuffix({ RASPBERRYCODE_ENV: "production", RASPBERRYCODE_PREVIEW_IDENTITY: "1" }),
    ).toBe("");
    expect(resolveDesktopArtifactSuffix({})).toBe("_TEST");
  });

  it("RASPBERRYCODE_ENV=production 完整保留正式包身份", () => {
    expect(resolveDesktopProductIdentity({ RASPBERRYCODE_ENV: "production" })).toBe(
      desktopProductIdentities.production,
    );
    expect(desktopProductIdentities.production).toEqual({
      flavor: "production",
      appId: "dev.raspberrycode.app",
      productName: "RaspberryCode",
      linuxExecutableName: "raspberrycode",
      linuxPackageName: "raspberrycode",
      cuaHelperInstallVariant: null,
    });
  });

  it("未注入或未知环境时不应误生成正式安装身份", () => {
    expect(resolveDesktopProductIdentity({}).flavor).toBe("preview");
    expect(resolveDesktopProductIdentity({ RASPBERRYCODE_ENV: "staging" }).flavor).toBe("preview");
  });

  it("打包态 Windows AUMID 必须和 NSIS appId 保持一致", () => {
    expect(resolveWindowsAppUserModelId({ RASPBERRYCODE_ENV: "production" })).toBe(
      desktopProductIdentities.production.appId,
    );
    expect(resolveWindowsAppUserModelId({ RASPBERRYCODE_ENV: "test" })).toBe(
      desktopProductIdentities.preview.appId,
    );
    expect(
      resolveWindowsAppUserModelId({ RASPBERRYCODE_ENV: "production", RASPBERRYCODE_PREVIEW_IDENTITY: "1" }),
    ).toBe(desktopProductIdentities.preview.appId);
    // 主进程按编译期 flavor 取 AUMID，不依赖安装后机器上的环境变量。
    expect(resolveWindowsAppUserModelIdForFlavor("preview")).toBe(
      desktopProductIdentities.preview.appId,
    );
    expect(resolveWindowsAppUserModelIdForFlavor("production")).toBe(
      desktopProductIdentities.production.appId,
    );
  });

  it("开发态继续使用独立 AUMID，避免污染打包版 Shell 身份", () => {
    expect(resolveWindowsAppUserModelId({}, { isPackaged: false })).toBe("dev.raspberrycode.app.dev");
  });
});
