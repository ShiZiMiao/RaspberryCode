import type { ZCodeEnv } from "./env.js";

// 单机版无默认云服务：占位用 .example 保留域（RFC 2606），实际请求端点由用户在设置页配置。
export const DEFAULT_ZCODE_ENDPOINT_ORIGIN = "https://your-server.example";
export const TEST_ZCODE_ENDPOINT_ORIGIN = "https://your-server.example";

export interface BuildZCodeEndpointUrlsOptions {
  appVersion?: string;
}


export interface ZCodeEndpointUrls {
  origin: string;
  apiBaseUrl: string;
}

export interface RuntimeZCodeEndpointEnv {
  [key: string]: string | undefined;
  ZCODE_ENV?: string;
  ZCODE_BASE_URL?: string;
  ZCODE_ENDPOINT_ORIGIN?: string;
  ZCODE_TEST_BASE_URL?: string;
  ZCODE_PRODUCTION_BASE_URL?: string;
}

function readRuntimeEnvValue(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function normalizeZCodeEndpointOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("RaspberryCode endpoint origin is empty");
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("RaspberryCode endpoint origin must use http or https");
  }
  return parsed.origin;
}

export function resolveZCodeEndpointOrigin(options?: {
  env?: ZCodeEnv;
  envBaseOrigin?: string | null;
  overrideOrigin?: string | null;
}): string {
  const env = options?.env ?? "test";
  const envBaseOrigin = options?.envBaseOrigin?.trim();
  if (env === "production") {
    return envBaseOrigin
      ? normalizeZCodeEndpointOrigin(envBaseOrigin)
      : DEFAULT_ZCODE_ENDPOINT_ORIGIN;
  }

  const overrideOrigin = options?.overrideOrigin?.trim();
  if (overrideOrigin) {
    return normalizeZCodeEndpointOrigin(overrideOrigin);
  }

  return envBaseOrigin ? normalizeZCodeEndpointOrigin(envBaseOrigin) : TEST_ZCODE_ENDPOINT_ORIGIN;
}

export function resolveRuntimeZCodeEnv(env: RuntimeZCodeEndpointEnv = {}): ZCodeEnv {
  // 独立 CLI / 服务测试未注入 ZCODE_ENV 时默认生产域；桌面测试包会显式下发 ZCODE_ENV=test。
  return env.ZCODE_ENV?.trim().toLowerCase() === "test" ? "test" : "production";
}

export function resolveRuntimeZCodeEndpointOrigin(
  env: RuntimeZCodeEndpointEnv = {},
  options?: { overrideOrigin?: string | null },
): string {
  const zcodeEnv = resolveRuntimeZCodeEnv(env);
  const scopedBaseOrigin =
    zcodeEnv === "production"
      ? readRuntimeEnvValue(env, "ZCODE_PRODUCTION_BASE_URL")
      : readRuntimeEnvValue(env, "ZCODE_TEST_BASE_URL");

  return resolveZCodeEndpointOrigin({
    env: zcodeEnv,
    envBaseOrigin:
      readRuntimeEnvValue(env, "ZCODE_BASE_URL") ??
      readRuntimeEnvValue(env, "ZCODE_ENDPOINT_ORIGIN") ??
      scopedBaseOrigin,
    overrideOrigin: options?.overrideOrigin,
  });
}

export function buildRuntimeZCodeEndpointUrls(
  env: RuntimeZCodeEndpointEnv = {},
): ZCodeEndpointUrls {
  return buildZCodeEndpointUrls(resolveRuntimeZCodeEndpointOrigin(env));
}

export function buildRuntimeZCodeApiUrl(env: RuntimeZCodeEndpointEnv = {}, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveRuntimeZCodeEndpointOrigin(env)}${normalizedPath}`;
}


export function buildZCodeEndpointUrls(
  origin: string,
  options: BuildZCodeEndpointUrlsOptions = {},
): ZCodeEndpointUrls {
  const normalizedOrigin = normalizeZCodeEndpointOrigin(origin);
  const parsed = new URL(normalizedOrigin);

  return {
    origin: normalizedOrigin,
    apiBaseUrl: `${normalizedOrigin}/api/v1`,
  };
}

export function rewriteZCodeEndpointUrl(input: string | URL, endpointOrigin: string): string | URL {
  const originalUrl = typeof input === "string" ? input : input.toString();
  let parsed: URL;
  try {
    parsed = new URL(originalUrl);
  } catch {
    return input;
  }
  const sourceOrigin = DEFAULT_ZCODE_ENDPOINT_ORIGIN;
  if (parsed.origin !== sourceOrigin) {
    return input;
  }

  const targetOrigin = normalizeZCodeEndpointOrigin(endpointOrigin);
  if (targetOrigin === sourceOrigin) {
    return input;
  }

  const target = new URL(targetOrigin);
  target.pathname = parsed.pathname;
  target.search = parsed.search;
  target.hash = parsed.hash;
  return target.toString();
}
