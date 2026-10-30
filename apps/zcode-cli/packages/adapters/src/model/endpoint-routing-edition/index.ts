import type { ProviderEndpointRoutingPort } from "@zcode/contracts";
import type { ProviderEndpointRoutingFactoryOptions } from "../provider-endpoint-routing-options.js";

/**
 * Compliance (RaspberryCode)：官方 Coding Plan 网关自动转发已移除（不得把厂商 API 请求
 * 改道到订阅网关）。端点路由保留为扩展点，但默认对所有请求直通。
 */
export function createProviderEndpointRoutingPort(
  _options: ProviderEndpointRoutingFactoryOptions,
): ProviderEndpointRoutingPort {
  return {
    async resolve(requestUrl) {
      return { routed: false, url: requestUrl };
    },
  };
}
