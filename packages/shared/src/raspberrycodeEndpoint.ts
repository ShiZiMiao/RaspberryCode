import type { RaspberryCodeEnv } from "./env.js";

// 单机版无默认云服务：占位用 .example 保留域（RFC 2606），实际请求端点由用户在设置页配置。
export const DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN = "https://your-server.example";
export const TEST_RASPBERRYCODE_ENDPOINT_ORIGIN = "https://your-server.example";

export interface BuildRaspberryCodeEndpointUrlsOptions {
  appVersion?: string;
}


export interface RaspberryCodeEndpointUrls {
  origin: string;
  apiBaseUrl: string;
}

export interface RuntimeRaspberryCodeEndpointEnv {
  [key: string]: string | undefined;
  RASPBERRYCODE_ENV?: string;
  RASPBERRYCODE_BASE_URL?: string;
  RASPBERRYCODE_ENDPOINT_ORIGIN?: string;
  RASPBERRYCODE_TEST_BASE_URL?: string;
  RASPBERRYCODE_PRODUCTION_BASE_URL?: string;
}

function readRuntimeEnvValue(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function normalizeRaspberryCodeEndpointOrigin(value: string): string {
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

export function resolveRaspberryCodeEndpointOrigin(options?: {
  env?: RaspberryCodeEnv;
  envBaseOrigin?: string | null;
  overrideOrigin?: string | null;
}): string {
  const env = options?.env ?? "test";
  const envBaseOrigin = options?.envBaseOrigin?.trim();
  if (env === "production") {
    return envBaseOrigin
      ? normalizeRaspberryCodeEndpointOrigin(envBaseOrigin)
      : DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN;
  }

  const overrideOrigin = options?.overrideOrigin?.trim();
  if (overrideOrigin) {
    return normalizeRaspberryCodeEndpointOrigin(overrideOrigin);
  }

  return envBaseOrigin ? normalizeRaspberryCodeEndpointOrigin(envBaseOrigin) : TEST_RASPBERRYCODE_ENDPOINT_ORIGIN;
}

export function resolveRuntimeRaspberryCodeEnv(env: RuntimeRaspberryCodeEndpointEnv = {}): RaspberryCodeEnv {
  // 独立 CLI / 服务测试未注入 RASPBERRYCODE_ENV 时默认生产域；桌面测试包会显式下发 RASPBERRYCODE_ENV=test。
  return env.RASPBERRYCODE_ENV?.trim().toLowerCase() === "test" ? "test" : "production";
}

export function resolveRuntimeRaspberryCodeEndpointOrigin(
  env: RuntimeRaspberryCodeEndpointEnv = {},
  options?: { overrideOrigin?: string | null },
): string {
  const raspberrycodeEnv = resolveRuntimeRaspberryCodeEnv(env);
  const scopedBaseOrigin =
    raspberrycodeEnv === "production"
      ? readRuntimeEnvValue(env, "RASPBERRYCODE_PRODUCTION_BASE_URL")
      : readRuntimeEnvValue(env, "RASPBERRYCODE_TEST_BASE_URL");

  return resolveRaspberryCodeEndpointOrigin({
    env: raspberrycodeEnv,
    envBaseOrigin:
      readRuntimeEnvValue(env, "RASPBERRYCODE_BASE_URL") ??
      readRuntimeEnvValue(env, "RASPBERRYCODE_ENDPOINT_ORIGIN") ??
      scopedBaseOrigin,
    overrideOrigin: options?.overrideOrigin,
  });
}

export function buildRuntimeRaspberryCodeEndpointUrls(
  env: RuntimeRaspberryCodeEndpointEnv = {},
): RaspberryCodeEndpointUrls {
  return buildRaspberryCodeEndpointUrls(resolveRuntimeRaspberryCodeEndpointOrigin(env));
}

export function buildRuntimeRaspberryCodeApiUrl(env: RuntimeRaspberryCodeEndpointEnv = {}, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveRuntimeRaspberryCodeEndpointOrigin(env)}${normalizedPath}`;
}


export function buildRaspberryCodeEndpointUrls(
  origin: string,
  options: BuildRaspberryCodeEndpointUrlsOptions = {},
): RaspberryCodeEndpointUrls {
  const normalizedOrigin = normalizeRaspberryCodeEndpointOrigin(origin);
  const parsed = new URL(normalizedOrigin);

  return {
    origin: normalizedOrigin,
    apiBaseUrl: `${normalizedOrigin}/api/v1`,
  };
}

export function rewriteRaspberryCodeEndpointUrl(input: string | URL, endpointOrigin: string): string | URL {
  const originalUrl = typeof input === "string" ? input : input.toString();
  let parsed: URL;
  try {
    parsed = new URL(originalUrl);
  } catch {
    return input;
  }
  const sourceOrigin = DEFAULT_RASPBERRYCODE_ENDPOINT_ORIGIN;
  if (parsed.origin !== sourceOrigin) {
    return input;
  }

  const targetOrigin = normalizeRaspberryCodeEndpointOrigin(endpointOrigin);
  if (targetOrigin === sourceOrigin) {
    return input;
  }

  const target = new URL(targetOrigin);
  target.pathname = parsed.pathname;
  target.search = parsed.search;
  target.hash = parsed.hash;
  return target.toString();
}
