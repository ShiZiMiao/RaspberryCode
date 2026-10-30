import { describe, expect, it } from "vitest";
import {
  buildZCodeSourceHeadersFromContext,
  ZCODE_SOURCE_HEADERS,
} from "../src/zcode-source-headers.js";

describe("buildZCodeSourceHeadersFromContext", () => {
  it("builds the shared RaspberryCode endpoint attribution headers", () => {
    expect(
      buildZCodeSourceHeadersFromContext({
        appVersion: " 2.14.0 ",
        arch: "arm64",
        clientLanguage: "zh-CN",
        clientTimezone: "Asia/Shanghai",
        deviceMid: "mid-1",
        endpointOrigin: "https://zcode.z.ai",
        osVersion: "Darwin 25.0.0",
        platform: "darwin",
        releaseChannel: "test",
        sourceTitle: "cli",
      }),
    ).toEqual({
      ...ZCODE_SOURCE_HEADERS,
      "HTTP-Referer": "https://zcode.z.ai",
      "User-Agent": "RaspberryCode/2.14.0",
      "X-RaspberryCode-App-Version": "2.14.0",
      "X-Title": "RaspberryCode@cli",
      "X-Platform": "darwin-arm64",
      "X-Release-Channel": "test",
      "X-Client-Language": "zh-CN",
      "X-Client-Timezone": "Asia/Shanghai",
      "X-Os-Category": "macos",
      "X-Os-Version": "Darwin 25.0.0",
      "X-Device-Mid": "mid-1",
    });
  });

  it("drops invalid optional values without emitting malformed headers", () => {
    const headers = buildZCodeSourceHeadersFromContext({
      appVersion: "bad\nversion",
      clientLanguage: "\n",
      clientTimezone: "",
      deviceMid: "bad\nmid",
      platform: "win32",
      sourceTitle: "electron",
    });

    expect(headers).toMatchObject({
      "User-Agent": "RaspberryCode/unknown",
      "X-Client-Language": "unknown",
      "X-Client-Timezone": "unknown",
      "X-Os-Category": "windows",
      "X-Title": "RaspberryCode@electron",
    });
    // HTTP-Referer 仅在用户配置了服务端点时发送，不向模型厂商泄漏占位域。
    expect(headers).not.toHaveProperty("HTTP-Referer");
    expect(headers).not.toHaveProperty("X-Device-Mid");
    expect(headers).not.toHaveProperty("X-RaspberryCode-App-Version");
  });
});
