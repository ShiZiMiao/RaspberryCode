import { describe, expect, it } from "vitest";
import {
  DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN,
  TEST_RASPBERRYCODE_ENDPOINT_ORIGIN,
  buildRuntimeRaspberryCodeApiUrl,
  buildRuntimeRaspberryCodeEndpointUrls,
  buildRaspberryCodeEndpointUrls,
  normalizeRaspberryCodeEndpointOrigin,
  resolveRuntimeRaspberryCodeEnv,
  resolveRuntimeRaspberryCodeEndpointOrigin,
  resolveRaspberryCodeEndpointOrigin,
} from "../src/raspberrycodeEndpoint.js";
import { appSettingsPatchSchema, appSettingsSchema } from "../src/validationAppSettings.js";

describe("raspberrycodeEndpoint", () => {
  it("defaults to the placeholder origin in every env without env base url", () => {
    // 单机版无默认云服务：占位域是 RFC 2606 保留域，实际请求端点由用户配置。
    expect(TEST_RASPBERRYCODE_ENDPOINT_ORIGIN).toBe("https://your-server.example");
    expect(DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN).toBe("https://your-server.example");
    expect(resolveRaspberryCodeEndpointOrigin({ env: "test" })).toBe(TEST_RASPBERRYCODE_ENDPOINT_ORIGIN);
    expect(resolveRaspberryCodeEndpointOrigin({ env: "production" })).toBe(DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN);
  });

  it("keeps the non-production settings override above env base url", () => {
    expect(
      resolveRaspberryCodeEndpointOrigin({
        env: "test",
        envBaseOrigin: "https://raspberrycode.example.com",
        overrideOrigin: "http://localhost:3030/api/v1",
      }),
    ).toBe("http://localhost:3030");
  });

  it("uses a non-production override after normalizing to origin", () => {
    expect(
      resolveRaspberryCodeEndpointOrigin({
        env: "test",
        overrideOrigin: "https://raspberrycode.example.com/api/v1/ignored?x=1",
      }),
    ).toBe("https://raspberrycode.example.com");
  });

  it("ignores overrides in production", () => {
    expect(
      resolveRaspberryCodeEndpointOrigin({
        env: "production",
        envBaseOrigin: "https://raspberrycode.example.com",
        overrideOrigin: "https://evil.example",
      }),
    ).toBe("https://raspberrycode.example.com");
    expect(
      resolveRaspberryCodeEndpointOrigin({
        env: "production",
        overrideOrigin: "https://evil.example",
      }),
    ).toBe(DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN);
  });

  it("derives origin and api base urls from the same origin", () => {
    expect(buildRaspberryCodeEndpointUrls("http://localhost:3030")).toEqual({
      origin: "http://localhost:3030",
      apiBaseUrl: "http://localhost:3030/api/v1",
    });
  });

  it("derives runtime endpoint urls from RASPBERRYCODE_ENV", () => {
    expect(buildRuntimeRaspberryCodeEndpointUrls({ RASPBERRYCODE_ENV: "test" })).toEqual({
      origin: "https://your-server.example",
      apiBaseUrl: "https://your-server.example/api/v1",
    });
    expect(buildRuntimeRaspberryCodeEndpointUrls({ RASPBERRYCODE_ENV: "production" })).toEqual({
      origin: "https://your-server.example",
      apiBaseUrl: "https://your-server.example/api/v1",
    });
    expect(buildRuntimeRaspberryCodeEndpointUrls({})).toEqual({
      origin: "https://your-server.example",
      apiBaseUrl: "https://your-server.example/api/v1",
    });
    expect(
      buildRuntimeRaspberryCodeEndpointUrls({
        RASPBERRYCODE_ENV: "test",
        RASPBERRYCODE_BASE_URL: "https://raspberrycode.example.com/ignored/path",
      }).origin,
    ).toBe("https://raspberrycode.example.com");
    expect(resolveRuntimeRaspberryCodeEnv({ RASPBERRYCODE_ENV: "test" })).toBe("test");
    expect(resolveRuntimeRaspberryCodeEnv({})).toBe("production");
    expect(resolveRuntimeRaspberryCodeEnv({ RASPBERRYCODE_ENV: "staging" })).toBe("production");
  });

  it("reads the scoped base url only for the matching environment", () => {
    expect(
      resolveRuntimeRaspberryCodeEndpointOrigin({
        RASPBERRYCODE_ENV: "test",
        RASPBERRYCODE_TEST_BASE_URL: "https://test-raspberrycode.example.com/path",
        RASPBERRYCODE_PRODUCTION_BASE_URL: "https://prod-raspberrycode.example.com",
      }),
    ).toBe("https://test-raspberrycode.example.com");
    expect(
      resolveRuntimeRaspberryCodeEndpointOrigin({
        RASPBERRYCODE_ENV: "production",
        RASPBERRYCODE_TEST_BASE_URL: "https://test-raspberrycode.example.com",
        RASPBERRYCODE_PRODUCTION_BASE_URL: "https://prod-raspberrycode.example.com/base",
      }),
    ).toBe("https://prod-raspberrycode.example.com");
  });

  it("keeps unscoped endpoint overrides above scoped endpoint overrides", () => {
    expect(
      resolveRuntimeRaspberryCodeEndpointOrigin({
        RASPBERRYCODE_ENV: "test",
        RASPBERRYCODE_BASE_URL: "https://global.example.com",
        RASPBERRYCODE_ENDPOINT_ORIGIN: "https://mid.example.com",
        RASPBERRYCODE_TEST_BASE_URL: "https://scoped.example.com",
      }),
    ).toBe("https://global.example.com");
    expect(
      resolveRuntimeRaspberryCodeEndpointOrigin({
        RASPBERRYCODE_ENV: "test",
        RASPBERRYCODE_ENDPOINT_ORIGIN: "https://mid.example.com",
        RASPBERRYCODE_TEST_BASE_URL: "https://scoped.example.com",
      }),
    ).toBe("https://mid.example.com");
  });

  it("ignores blank runtime endpoint overrides", () => {
    expect(
      resolveRuntimeRaspberryCodeEndpointOrigin({
        RASPBERRYCODE_ENV: "test",
        RASPBERRYCODE_BASE_URL: " ",
        RASPBERRYCODE_ENDPOINT_ORIGIN: "\t",
        RASPBERRYCODE_TEST_BASE_URL: "",
      }),
    ).toBe(TEST_RASPBERRYCODE_ENDPOINT_ORIGIN);
    expect(buildRuntimeRaspberryCodeApiUrl({ RASPBERRYCODE_ENV: "test" }, "/api/v1/oauth/token")).toBe(
      "https://your-server.example/api/v1/oauth/token",
    );
  });

  it("rejects non-http endpoint origins", () => {
    expect(() => normalizeRaspberryCodeEndpointOrigin("file:///tmp/raspberrycode")).toThrow(/http or https/);
  });

  it("persists optional endpoint override in app settings", () => {
    expect(
      appSettingsSchema.parse({ raspberrycodeEndpointOrigin: "https://raspberrycode.example.com/path" })
        .raspberrycodeEndpointOrigin,
    ).toBe("https://raspberrycode.example.com");
    expect(
      appSettingsPatchSchema.parse({ raspberrycodeEndpointOrigin: "http://localhost:3030/foo" })
        .raspberrycodeEndpointOrigin,
    ).toBe("http://localhost:3030");
  });
});
