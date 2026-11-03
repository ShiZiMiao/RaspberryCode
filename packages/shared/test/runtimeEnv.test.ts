import { describe, expect, it } from "vitest";
import {
  RASPBERRYCODE_TOOL_ENV_PASSTHROUGH_ENV_KEY,
  RASPBERRYCODE_REMOTE_HTTP_PROXY_ENV_KEY,
  RASPBERRYCODE_REMOTE_NO_PROXY_ENV_KEY,
  RASPBERRYCODE_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY,
  buildRaspberryCodeToolEnvPassthroughEnv,
  getCapturedRaspberryCodeCuaBrokerCredentials,
  isCuaDevModeRequested,
  isRaspberryCodeCuaInternalFeatureEnabled,
  readRaspberryCodeAgentTelemetryEnv,
  readRaspberryCodeToolEnvPassthroughEnv,
  resetCapturedRaspberryCodeCuaBrokerCredentialsForTest,
  sanitizeRaspberryCodeRuntimeEnv,
  getCapturedRaspberryCodeAgentTelemetryEnv,
  resetCapturedRaspberryCodeAgentTelemetryEnvForTest,
} from "../src/runtimeEnv.js";

describe("runtimeEnv", () => {
  it("enables internal CUA by default while honoring explicit false values", () => {
    expect(isRaspberryCodeCuaInternalFeatureEnabled({})).toBe(true);
    expect(isRaspberryCodeCuaInternalFeatureEnabled({ RASPBERRYCODE_CUA_PRODUCT_HELPER: "0" })).toBe(false);
    expect(isRaspberryCodeCuaInternalFeatureEnabled({ RASPBERRYCODE_CUA_PRODUCT_HELPER: "false" })).toBe(false);
    expect(isRaspberryCodeCuaInternalFeatureEnabled({ RASPBERRYCODE_CUA_PRODUCT_HELPER: "1" })).toBe(true);
    expect(isRaspberryCodeCuaInternalFeatureEnabled({ RASPBERRYCODE_CUA_PRODUCT_HELPER: " TRUE " })).toBe(true);
    expect(isRaspberryCodeCuaInternalFeatureEnabled({ RASPBERRYCODE_CUA_PRODUCT_HELPER: "on" })).toBe(true);
  });

  it("parses explicit truthy values for RASPBERRYCODE_CUA_DEV_MODE", () => {
    // isCuaDevModeRequested: only explicit truthy values (case-insensitive, trimmed).
    expect(isCuaDevModeRequested({})).toBe(false);
    expect(isCuaDevModeRequested({ RASPBERRYCODE_CUA_DEV_MODE: "0" })).toBe(false);
    expect(isCuaDevModeRequested({ RASPBERRYCODE_CUA_DEV_MODE: "false" })).toBe(false);
    expect(isCuaDevModeRequested({ RASPBERRYCODE_CUA_DEV_MODE: "1" })).toBe(true);
    expect(isCuaDevModeRequested({ RASPBERRYCODE_CUA_DEV_MODE: " ON " })).toBe(true);
    expect(isCuaDevModeRequested({ RASPBERRYCODE_CUA_DEV_MODE: "true" })).toBe(true);
  });

  it("sanitizes runtime env while sealing user network env for tools", () => {
    const sourceEnv = {
      HTTP_PROXY: "http://proxy.example:8080",
      NODE_ENV: "development",
      NODE_EXTRA_CA_CERTS: "/tmp/root-ca.pem",
      PATH: "/usr/bin:/bin",
      npm_config_proxy: "http://npm-proxy.example:8080",
    };

    const sanitized = sanitizeRaspberryCodeRuntimeEnv(sourceEnv);
    const passthroughEnv = buildRaspberryCodeToolEnvPassthroughEnv(sourceEnv);
    const captured = readRaspberryCodeToolEnvPassthroughEnv(passthroughEnv);

    expect(sanitized).toEqual({ PATH: "/usr/bin:/bin" });
    expect(captured).toEqual({
      HTTP_PROXY: "http://proxy.example:8080",
      NODE_EXTRA_CA_CERTS: "/tmp/root-ca.pem",
      npm_config_proxy: "http://npm-proxy.example:8080",
    });
  });

  it("ignores invalid passthrough JSON and non-network keys", () => {
    const captured = readRaspberryCodeToolEnvPassthroughEnv({
      [RASPBERRYCODE_TOOL_ENV_PASSTHROUGH_ENV_KEY]: JSON.stringify({
        HTTP_PROXY: "http://proxy.example:8080",
        NODE_ENV: "production",
        PATH: "/tmp/bin",
      }),
    });

    expect(captured).toEqual({
      HTTP_PROXY: "http://proxy.example:8080",
    });
    expect(
      readRaspberryCodeToolEnvPassthroughEnv({
        [RASPBERRYCODE_TOOL_ENV_PASSTHROUGH_ENV_KEY]: "not-json",
      }),
    ).toEqual({});
  });

  it("strips the CUA broker socket/authority/refresh marker from child env and tool passthrough", () => {
    // Confused-deputy 防护：broker bearer 凭据只该定向注入目标 raspberrycode-cua server，绝不能随全局 env
    // 泄漏给其它 MCP / Bash / tool 子进程，也不能经 tool-env-passthrough 恢复。
    const sourceEnv = {
      PATH: "/usr/bin:/bin",
      RASPBERRYCODE_CUA_PERMISSION_BROKER_SOCKET: "/tmp/raspberrycode-cua-me/broker-abc.sock",
      RASPBERRYCODE_CUA_PERMISSION_BROKER_REFRESH_MARKER:
        "/tmp/raspberrycode-cua-me/broker-abc.sock.permission-refresh.json",
    };
    const sanitized = sanitizeRaspberryCodeRuntimeEnv(sourceEnv);
    expect(sanitized).toEqual({ PATH: "/usr/bin:/bin" });

    const captured = readRaspberryCodeToolEnvPassthroughEnv(buildRaspberryCodeToolEnvPassthroughEnv(sourceEnv));
    expect(captured).not.toHaveProperty("RASPBERRYCODE_CUA_PERMISSION_BROKER_SOCKET");
    expect(captured).not.toHaveProperty("RASPBERRYCODE_CUA_PERMISSION_BROKER_REFRESH_MARKER");
  });

  it("strips desktop-to-remote network handoff values after stdio bootstrap", () => {
    const sourceEnv = {
      PATH: "/usr/bin:/bin",
      [RASPBERRYCODE_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY]: "1",
      [RASPBERRYCODE_REMOTE_HTTP_PROXY_ENV_KEY]: "http://172.21.240.1:7890",
      [RASPBERRYCODE_REMOTE_NO_PROXY_ENV_KEY]: "localhost,127.0.0.1",
    };

    expect(sanitizeRaspberryCodeRuntimeEnv(sourceEnv)).toEqual({ PATH: "/usr/bin:/bin" });
    expect(readRaspberryCodeToolEnvPassthroughEnv(buildRaspberryCodeToolEnvPassthroughEnv(sourceEnv))).toEqual({});
  });

  it("captures broker credentials as one atomic pair and clears stale state on partial rotation", () => {
    resetCapturedRaspberryCodeCuaBrokerCredentialsForTest();
    try {
      sanitizeRaspberryCodeRuntimeEnv({
        RASPBERRYCODE_CUA_PERMISSION_BROKER_SOCKET: "/tmp/broker-a.sock",
        RASPBERRYCODE_CUA_PLUGIN_AUTHORITY: "authority-a",
      });
      expect(getCapturedRaspberryCodeCuaBrokerCredentials()).toEqual({
        socket: "/tmp/broker-a.sock",
        pluginAuthority: "authority-a",
      });

      sanitizeRaspberryCodeRuntimeEnv({
        RASPBERRYCODE_CUA_PERMISSION_BROKER_SOCKET: "/tmp/broker-b.sock",
      });
      expect(getCapturedRaspberryCodeCuaBrokerCredentials()).toEqual({
        socket: undefined,
        pluginAuthority: undefined,
      });

      sanitizeRaspberryCodeRuntimeEnv({
        RASPBERRYCODE_CUA_PERMISSION_BROKER_SOCKET: "/tmp/broker-b.sock",
        RASPBERRYCODE_CUA_PLUGIN_AUTHORITY: "authority-b",
      });
      expect(getCapturedRaspberryCodeCuaBrokerCredentials()).toEqual({
        socket: "/tmp/broker-b.sock",
        pluginAuthority: "authority-b",
      });
    } finally {
      resetCapturedRaspberryCodeCuaBrokerCredentialsForTest();
    }
  });

  it("captures Agent OTLP config privately and never passes auth or identity through to tools", () => {
    resetCapturedRaspberryCodeAgentTelemetryEnvForTest();
    const sourceEnv = {
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://arms.example.com/v1/traces",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "Authorization=secret",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://arms.example.com/v1/metrics",
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: "Authorization=metric-secret",
      PATH: "/usr/bin:/bin",
      RASPBERRYCODE_TELEMETRY_USER_SUBJECT_ID: "opaque-user",
    };
    expect(sanitizeRaspberryCodeRuntimeEnv(sourceEnv)).toEqual({ PATH: "/usr/bin:/bin" });
    expect(getCapturedRaspberryCodeAgentTelemetryEnv()).toMatchObject({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://arms.example.com/v1/traces",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "Authorization=secret",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://arms.example.com/v1/metrics",
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: "Authorization=metric-secret",
      RASPBERRYCODE_TELEMETRY_USER_SUBJECT_ID: "opaque-user",
    });
    const toolEnv = readRaspberryCodeToolEnvPassthroughEnv(buildRaspberryCodeToolEnvPassthroughEnv(sourceEnv));
    expect(toolEnv).not.toHaveProperty("OTEL_EXPORTER_OTLP_TRACES_HEADERS");
    expect(toolEnv).not.toHaveProperty("OTEL_EXPORTER_OTLP_METRICS_HEADERS");
    expect(toolEnv).not.toHaveProperty("RASPBERRYCODE_TELEMETRY_USER_SUBJECT_ID");
  });

  it("extracts only the allowlisted Agent telemetry env", () => {
    expect(
      readRaspberryCodeAgentTelemetryEnv({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: " https://arms.example.com/v1/traces ",
        OTEL_UNKNOWN_SECRET: "must-not-pass",
        PATH: "/bin",
        RASPBERRYCODE_MODEL_TELEMETRY_ENABLED: "1",
        RASPBERRYCODE_TELEMETRY_RUNTIME_DISTRIBUTION: " packaged ",
      }),
    ).toEqual({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://arms.example.com/v1/traces",
      RASPBERRYCODE_MODEL_TELEMETRY_ENABLED: "1",
      RASPBERRYCODE_TELEMETRY_RUNTIME_DISTRIBUTION: "packaged",
    });
  });
});
