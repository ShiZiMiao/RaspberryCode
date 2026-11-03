// Modified for RaspberryCode: 断言随产品名同步
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN } from "@raspberrycode/shared";
import { setDataBaseDir } from "../src/paths.js";
import { createNodeApiClient } from "../src/providers/api/nodeApiClient.js";
import { buildRaspberryCodeSourceHeaders, RASPBERRYCODE_SOURCE_HEADERS } from "../src/providers/sourceHeaders.js";

describe("NodeApiClient endpoint rewriting", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    setDataBaseDir(null);
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rewrites only the configured raspberrycode endpoint origin", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = createNodeApiClient({
      fetchImpl: fetchImpl as typeof fetch,
      resolveRaspberryCodeEndpointOrigin: async () => "http://localhost:3030",
    });

    await client.request(`${DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN}/api/v1/event/report?x=1`);
    await client.request("https://example.com/static/config.json");
    await client.request("https://feedback.example.invalid/api/v1/tickets");
    await client.request("https://api.z.ai/v1/models");

    expect(fetchImpl.mock.calls.map(([input]) => String(input))).toEqual([
      "http://localhost:3030/api/v1/event/report?x=1",
      "https://example.com/static/config.json",
      "https://feedback.example.invalid/api/v1/tickets",
      "https://api.z.ai/v1/models",
    ]);
  });

  it("只给当前 raspberrycode endpoint 请求统一补来源 headers", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = createNodeApiClient({
      fetchImpl: fetchImpl as typeof fetch,
      resolveRaspberryCodeEndpointOrigin: async () => "https://raspberrycode.example.com",
    });

    await client.request(`${DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN}/api/v1/client/configs`);
    await client.request("https://api.z.ai/v1/models");

    const raspberrycodeHeaders = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(raspberrycodeHeaders.get("User-Agent")).toMatch(/^RaspberryCode\//);
    expect(raspberrycodeHeaders.get("X-Title")).toBe(RASPBERRYCODE_SOURCE_HEADERS["X-Title"]);
    expect(raspberrycodeHeaders.get("X-OpenRouter-Title")).toBeNull();
    expect(raspberrycodeHeaders.get("X-OpenRouter-Categories")).toBeNull();
    expect(raspberrycodeHeaders.get("HTTP-Referer")).toBe("https://raspberrycode.example.com");
    expect(raspberrycodeHeaders.get("X-App-Version")).toBeNull();
    expect(raspberrycodeHeaders.get("X-RaspberryCode-App-Version")).toBeTruthy();
    expect(raspberrycodeHeaders.get("X-Platform")).toBe(`${process.platform}-${process.arch}`);
    expect(raspberrycodeHeaders.get("X-Release-Channel")).toBeTruthy();
    expect(raspberrycodeHeaders.get("X-Client-Language")).toBeTruthy();
    expect(raspberrycodeHeaders.get("X-Client-Timezone")).toBeTruthy();
    expect(raspberrycodeHeaders.get("X-Os-Category")).toBeTruthy();
    expect(raspberrycodeHeaders.get("X-Os-Version")).toBeTruthy();
    expect(raspberrycodeHeaders.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const externalHeaders = new Headers(fetchImpl.mock.calls[1]?.[1]?.headers);
    expect(externalHeaders.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(externalHeaders.get("User-Agent")).toBeNull();
  });

  it("保留调用方显式传入的 raspberrycode endpoint headers", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = createNodeApiClient({
      fetchImpl: fetchImpl as typeof fetch,
      resolveRaspberryCodeEndpointOrigin: async () => "https://raspberrycode.example.com",
    });

    await client.request(`${DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN}/api/v1/oauth/token`, {
      headers: {
        "User-Agent": "CustomAgent/1.0",
        "X-Device-Mid": "caller-device-mid",
        "X-Title": "Custom Title",
        Authorization: "Bearer token",
      },
    });

    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("User-Agent")).toBe("CustomAgent/1.0");
    expect(headers.get("X-Title")).toBe("Custom Title");
    expect(headers.get("X-OpenRouter-Title")).toBeNull();
    expect(headers.get("X-OpenRouter-Categories")).toBeNull();
    expect(headers.get("Authorization")).toBe("Bearer token");
    expect(headers.get("X-Device-Mid")).toBe("caller-device-mid");
    expect(headers.get("HTTP-Referer")).toBe("https://raspberrycode.example.com");
    expect(headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("X-Client-Language 跟随注入的界面语言，而不是进程 Intl locale", async () => {
    // 从 Dock 启动时进程无 LANG，Intl 回退 en-US；界面语言才是唯一数据源。
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    const intlSpy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...resolvedOptions.call(this), locale: "en-US" };
      });
    let uiLocale = "zh-CN";
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = createNodeApiClient({
      fetchImpl: fetchImpl as typeof fetch,
      resolveRaspberryCodeEndpointOrigin: async () => "https://raspberrycode.example.com",
      resolveClientLanguage: () => uiLocale,
    });

    try {
      await client.request(`${DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN}/api/v1/raspberrycode-plan/billing/balance`);
      uiLocale = "en-US";
      await client.request(`${DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN}/api/v1/client/configs`);
      uiLocale = "zh-CN";
      await client.request(`${DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN}/api/v1/client/scenes`, {
        headers: { "X-Client-Language": "en-US" },
      });
    } finally {
      intlSpy.mockRestore();
    }

    const languages = fetchImpl.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("X-Client-Language"),
    );
    // 切换语言后下一次请求立即生效；调用方显式传入的值仍然优先。
    expect(languages).toEqual(["zh-CN", "en-US", "en-US"]);
  });

  it("尚未收到界面语言时回退 Intl locale", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = createNodeApiClient({
      fetchImpl: fetchImpl as typeof fetch,
      resolveRaspberryCodeEndpointOrigin: async () => "https://raspberrycode.example.com",
      resolveClientLanguage: () => undefined,
    });

    await client.request(`${DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN}/api/v1/client/configs`);

    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("X-Client-Language")).toBe(buildRaspberryCodeSourceHeaders()["X-Client-Language"]);
  });

  it("给当前 raspberrycode endpoint 请求补既有 deviceMid header", async () => {
    const dataBaseDir = mkdtempSync(join(tmpdir(), "raspberrycode-device-mid-"));
    tempDirs.push(dataBaseDir);
    setDataBaseDir(dataBaseDir);
    const configDir = join(dataBaseDir, ".raspberrycode", "v2");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "telemetry-state.json"),
      JSON.stringify({ deviceMid: "device-mid-1" }),
      "utf-8",
    );

    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = createNodeApiClient({
      fetchImpl: fetchImpl as typeof fetch,
      resolveRaspberryCodeEndpointOrigin: async () => "https://raspberrycode.example.com",
    });

    await client.request(`${DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN}/api/v1/client/configs`);

    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("X-Device-Mid")).toBe("device-mid-1");
  });

  it.each([
    { name: "state 文件缺失", content: null },
    { name: "state JSON 损坏", content: "{" },
    { name: "deviceMid 为空字符串", content: JSON.stringify({ deviceMid: "" }) },
    { name: "deviceMid 含不可打印字符", content: JSON.stringify({ deviceMid: "mid\n1" }) },
  ])("$name 时不注入 deviceMid header", async ({ content }) => {
    const dataBaseDir = mkdtempSync(join(tmpdir(), "raspberrycode-device-mid-invalid-"));
    tempDirs.push(dataBaseDir);
    setDataBaseDir(dataBaseDir);
    const configDir = join(dataBaseDir, ".raspberrycode", "v2");
    mkdirSync(configDir, { recursive: true });
    if (content !== null) {
      writeFileSync(join(configDir, "telemetry-state.json"), content, "utf-8");
    }

    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = createNodeApiClient({
      fetchImpl: fetchImpl as typeof fetch,
      resolveRaspberryCodeEndpointOrigin: async () => "https://raspberrycode.example.com",
    });

    await client.request(`${DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN}/api/v1/client/configs`);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("X-Device-Mid")).toBeNull();
  });

  it("统一来源 headers 支持可控的客户端上下文字段", () => {
    expect(
      buildRaspberryCodeSourceHeaders({
        appVersion: "2.14.0",
        arch: "arm64",
        clientLanguage: "zh-CN",
        clientTimezone: "Asia/Shanghai",
        osVersion: "Darwin 25.0.0",
        platform: "darwin",
        releaseChannel: "production",
      }),
    ).toMatchObject({
      "X-Platform": "darwin-arm64",
      "X-Release-Channel": "production",
      "X-Client-Language": "zh-CN",
      "X-Client-Timezone": "Asia/Shanghai",
      "X-Os-Category": "macos",
      "X-Os-Version": "Darwin 25.0.0",
      "X-RaspberryCode-App-Version": "2.14.0",
    });
  });
});
