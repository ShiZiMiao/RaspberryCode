import { createHash } from "node:crypto";
import { join } from "node:path";

export function resolveRaspberryCodeBuiltinClientPlatform(): string {
  const target = process.platform === "win32" ? "windows" : process.platform;
  const arch =
    process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
  return `${target}-${arch}`;
}

export interface RaspberryCodeBuiltinCachePathOptions {
  readonly environmentConfigRoot: string;
  readonly platform: string;
  readonly appVersion: string;
  readonly raspberrycodeEndpointOrigin: string;
}

export interface RaspberryCodeBuiltinCachePaths {
  readonly activeFilePath: string;
  readonly controlFilePath: string;
}

/** 按平台与 App 版本隔离 Active/LKG；路径本身就是兼容范围。 */
export function resolveRaspberryCodeBuiltinCachePaths(
  options: RaspberryCodeBuiltinCachePathOptions,
): RaspberryCodeBuiltinCachePaths {
  const platform = normalizeSegment(options.platform, "platform");
  const appVersion = normalizeSegment(options.appVersion, "appVersion");
  const endpointKey = createRaspberryCodeBuiltinEndpointKey(options.raspberrycodeEndpointOrigin);
  const directory = join(
    options.environmentConfigRoot,
    "runtime",
    "provider",
    platform,
    appVersion,
    endpointKey,
  );
  return {
    activeFilePath: join(directory, "raspberrycode-builtin.json"),
    controlFilePath: join(directory, "raspberrycode-builtin-refresh.json"),
  };
}

/** 将 RaspberryCode 控制面 Origin 规范化后映射为安全、稳定且碰撞风险可忽略的缓存路径段。 */
export function createRaspberryCodeBuiltinEndpointKey(raspberrycodeEndpointOrigin: string): string {
  const normalized = normalizeRaspberryCodeBuiltinEndpointOrigin(raspberrycodeEndpointOrigin);
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 32);
  return `endpoint-${digest}`;
}

export function normalizeRaspberryCodeBuiltinEndpointOrigin(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("RaspberryCode Built-in Endpoint Origin 不能为空");
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("RaspberryCode Built-in Endpoint Origin 只支持 HTTP(S)");
  }
  return url.origin;
}

function normalizeSegment(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === "." || normalized === ".." || /[\\/]/u.test(normalized)) {
    throw new Error(`RaspberryCode Built-in ${name} 不是合法路径段`);
  }
  return normalized;
}
