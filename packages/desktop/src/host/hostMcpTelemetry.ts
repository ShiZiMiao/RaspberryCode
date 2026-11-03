import type { IDisposable } from "@raspberrycode/rpc";
import type { IRaspberryCodeAgentService } from "@raspberrycode/services";
import type { ProcessResourceRuntimeSurface } from "@raspberrycode/shared";
import { HostResponseTypes } from "@raspberrycode/shared";

interface RegisterHostMcpTelemetryOptions {
  agentService: Pick<IRaspberryCodeAgentService, "onDynamicMcpTelemetry">;
  postMessage(message: unknown): void;
  runtimeSurface: ProcessResourceRuntimeSurface;
}

export function registerHostMcpTelemetry(options: RegisterHostMcpTelemetryOptions): IDisposable {
  return options.agentService.onDynamicMcpTelemetry()((event) => {
    try {
      options.postMessage({
        type: HostResponseTypes.McpTelemetry,
        runtimeSurface: options.runtimeSurface,
        event,
      });
    } catch {
      // main 已退出或 IPC 不可用时只丢当前遥测，不影响 MCP 生命周期。
    }
  });
}
