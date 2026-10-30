import { describe, expect, it } from "vitest";
import {
  DEFAULT_ZCODE_ENDPOINT_ORIGIN,
  TEST_ZCODE_ENDPOINT_ORIGIN,
  buildRuntimeZCodeApiUrl,
  buildRuntimeZCodeEndpointUrls,
  buildZCodeEndpointUrls,
  normalizeZCodeEndpointOrigin,
  resolveRuntimeZCodeEnv,
  resolveRuntimeZCodeEndpointOrigin,
  resolveZCodeEndpointOrigin,
} from "../src/zcodeEndpoint.js";
import { appSettingsPatchSchema, appSettingsSchema } from "../src/validationAppSettings.js";

describe("zcodeEndpoint", () => {
  it("defaults to the placeholder origin in every env without env base url", () => {
    // 单机版无默认云服务：占位域是 RFC 2606 保留域，实际请求端点由用户配置。
    expect(TEST_ZCODE_ENDPOINT_ORIGIN).toBe("https://your-server.example");
    expect(DEFAULT_ZCODE_ENDPOINT_ORIGIN).toBe("https://your-server.example");
    expect(resolveZCodeEndpointOrigin({ env: "test" })).toBe(TEST_ZCODE_ENDPOINT_ORIGIN);
    expect(resolveZCodeEndpointOrigin({ env: "production" })).toBe(DEFAULT_ZCODE_ENDPOINT_ORIGIN);
  });

  it("keeps the non-production settings override above env base url", () => {
    expect(
      resolveZCodeEndpointOrigin({
        env: "test",
        envBaseOrigin: "https://zcode.z.ai",
        overrideOrigin: "http://localhost:3030/api/v1",
      }),
    ).toBe("http://localhost:3030");
  });

  it("uses a non-production override after normalizing to origin", () => {
    expect(
      resolveZCodeEndpointOrigin({
        env: "test",
        overrideOrigin: "https://zcode.z.ai/api/v1/ignored?x=1",
      }),
    ).toBe("https://zcode.z.ai");
  });

  it("ignores overrides in production", () => {
    expect(
      resolveZCodeEndpointOrigin({
        env: "production",
        envBaseOrigin: "https://zcode.z.ai",
        overrideOrigin: "https://evil.example",
      }),
    ).toBe("https://zcode.z.ai");
    expect(
      resolveZCodeEndpointOrigin({
        env: "production",
        overrideOrigin: "https://evil.example",
      }),
    ).toBe(DEFAULT_ZCODE_ENDPOINT_ORIGIN);
  });

  it("derives origin and api base urls from the same origin", () => {
    expect(buildZCodeEndpointUrls("http://localhost:3030")).toEqual({
      origin: "http://localhost:3030",
      apiBaseUrl: "http://localhost:3030/api/v1",
    });
  });

  it("derives runtime endpoint urls from ZCODE_ENV", () => {
    expect(buildRuntimeZCodeEndpointUrls({ ZCODE_ENV: "test" })).toEqual({
      origin: "https://your-server.example",
      apiBaseUrl: "https://your-server.example/api/v1",
    });
    expect(buildRuntimeZCodeEndpointUrls({ ZCODE_ENV: "production" })).toEqual({
      origin: "https://your-server.example",
      apiBaseUrl: "https://your-server.example/api/v1",
    });
    expect(buildRuntimeZCodeEndpointUrls({})).toEqual({
      origin: "https://your-server.example",
      apiBaseUrl: "https://your-server.example/api/v1",
    });
    expect(
      buildRuntimeZCodeEndpointUrls({
        ZCODE_ENV: "test",
        ZCODE_BASE_URL: "https://zcode.z.ai/ignored/path",
      }).origin,
    ).toBe("https://zcode.z.ai");
    expect(resolveRuntimeZCodeEnv({ ZCODE_ENV: "test" })).toBe("test");
    expect(resolveRuntimeZCodeEnv({})).toBe("production");
    expect(resolveRuntimeZCodeEnv({ ZCODE_ENV: "staging" })).toBe("production");
  });

  it("reads the scoped base url only for the matching environment", () => {
    expect(
      resolveRuntimeZCodeEndpointOrigin({
        ZCODE_ENV: "test",
        ZCODE_TEST_BASE_URL: "https://test-zcode.example.com/path",
        ZCODE_PRODUCTION_BASE_URL: "https://prod-zcode.example.com",
      }),
    ).toBe("https://test-zcode.example.com");
    expect(
      resolveRuntimeZCodeEndpointOrigin({
        ZCODE_ENV: "production",
        ZCODE_TEST_BASE_URL: "https://test-zcode.example.com",
        ZCODE_PRODUCTION_BASE_URL: "https://prod-zcode.example.com/base",
      }),
    ).toBe("https://prod-zcode.example.com");
  });

  it("keeps unscoped endpoint overrides above scoped endpoint overrides", () => {
    expect(
      resolveRuntimeZCodeEndpointOrigin({
        ZCODE_ENV: "test",
        ZCODE_BASE_URL: "https://global.example.com",
        ZCODE_ENDPOINT_ORIGIN: "https://mid.example.com",
        ZCODE_TEST_BASE_URL: "https://scoped.example.com",
      }),
    ).toBe("https://global.example.com");
    expect(
      resolveRuntimeZCodeEndpointOrigin({
        ZCODE_ENV: "test",
        ZCODE_ENDPOINT_ORIGIN: "https://mid.example.com",
        ZCODE_TEST_BASE_URL: "https://scoped.example.com",
      }),
    ).toBe("https://mid.example.com");
  });

  it("ignores blank runtime endpoint overrides", () => {
    expect(
      resolveRuntimeZCodeEndpointOrigin({
        ZCODE_ENV: "test",
        ZCODE_BASE_URL: " ",
        ZCODE_ENDPOINT_ORIGIN: "\t",
        ZCODE_TEST_BASE_URL: "",
      }),
    ).toBe(TEST_ZCODE_ENDPOINT_ORIGIN);
    expect(buildRuntimeZCodeApiUrl({ ZCODE_ENV: "test" }, "/api/v1/oauth/token")).toBe(
      "https://your-server.example/api/v1/oauth/token",
    );
  });

  it("rejects non-http endpoint origins", () => {
    expect(() => normalizeZCodeEndpointOrigin("file:///tmp/zcode")).toThrow(/http or https/);
  });

  it("persists optional endpoint override in app settings", () => {
    expect(
      appSettingsSchema.parse({ zcodeEndpointOrigin: "https://zcode.z.ai/path" })
        .zcodeEndpointOrigin,
    ).toBe("https://zcode.z.ai");
    expect(
      appSettingsPatchSchema.parse({ zcodeEndpointOrigin: "http://localhost:3030/foo" })
        .zcodeEndpointOrigin,
    ).toBe("http://localhost:3030");
  });
});
