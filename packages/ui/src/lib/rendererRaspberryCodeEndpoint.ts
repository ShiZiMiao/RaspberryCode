import {
  buildRuntimeRaspberryCodeEndpointUrls,
  RASPBERRYCODE_ENV,
  type RuntimeRaspberryCodeEndpointEnv,
} from "@raspberrycode/shared";

interface RendererImportMetaEnv {
  VITE_RASPBERRYCODE_BASE_URL?: string;
  VITE_RASPBERRYCODE_ENDPOINT_ORIGIN?: string;
}

function readRendererImportMetaEnv(): RendererImportMetaEnv {
  return ((import.meta as ImportMeta & { env?: RendererImportMetaEnv }).env ??
    {}) as RendererImportMetaEnv;
}

export function createRendererRaspberryCodeEndpointEnv(
  env: RendererImportMetaEnv = readRendererImportMetaEnv(),
): RuntimeRaspberryCodeEndpointEnv {
  return {
    RASPBERRYCODE_ENV,
    // UI 侧的 raspberrycode-plan 占位 provider 以前只看 RASPBERRYCODE_ENV，
    // 没有消费 Vite 注入的 base url，导致自定义测试域名时 renderer 和 host/service 可能不一致。
    RASPBERRYCODE_BASE_URL: env.VITE_RASPBERRYCODE_BASE_URL,
    RASPBERRYCODE_ENDPOINT_ORIGIN: env.VITE_RASPBERRYCODE_ENDPOINT_ORIGIN,
  };
}

export const RENDERER_RASPBERRYCODE_ENDPOINT_URLS = buildRuntimeRaspberryCodeEndpointUrls(
  createRendererRaspberryCodeEndpointEnv(),
);
