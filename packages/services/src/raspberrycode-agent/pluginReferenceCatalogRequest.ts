import {
  raspberrycodeProtocolMethods,
  raspberrycodePluginsReferenceCatalogResultSchema,
  type RaspberryCodePluginsReferenceCatalogParams,
} from "@raspberrycode/shared";
import type { RaspberryCodeProtocolClient } from "#src/raspberrycode-agent/raspberrycodeProtocolClient.js";

/** 旧协议严格校验响应；新展示字段走独立入口，只有 -32601 能证明旧 Agent 不支持。 */
export async function requestPluginReferenceCatalog(
  client: Pick<RaspberryCodeProtocolClient, "request">,
  params: RaspberryCodePluginsReferenceCatalogParams,
) {
  try {
    return await client.request(
      raspberrycodeProtocolMethods.pluginsReferenceCatalogWithCategory,
      params,
      raspberrycodePluginsReferenceCatalogResultSchema,
    );
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === -32601))
      throw error;
    return client.request(
      raspberrycodeProtocolMethods.pluginsReferenceCatalog,
      params,
      raspberrycodePluginsReferenceCatalogResultSchema,
    );
  }
}
