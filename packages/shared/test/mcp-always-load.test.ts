import { describe, expect, it } from "vitest";
import { convertToRaspberryCodeAgentMcpServer, raspberrycodeProtocolMcpServerSchema } from "@raspberrycode/shared";

describe.each([
  { type: "stdio", command: "node" },
  { type: "http", url: "https://mcp.example.test/mcp" },
  { type: "sse", url: "https://mcp.example.test/sse" },
])("$type alwaysLoad protocol conversion", (config) => {
  it.each([true, false])(
    "preserves alwaysLoad=%s through JSON and protocol validation",
    (alwaysLoad) => {
      const server = convertToRaspberryCodeAgentMcpServer("demo", { ...config, alwaysLoad });
      expect(server?.alwaysLoad).toBe(alwaysLoad);
      const received = raspberrycodeProtocolMcpServerSchema.parse(JSON.parse(JSON.stringify(server)));
      expect(received.alwaysLoad).toBe(alwaysLoad);
    },
  );

  it.each([undefined, null, "true", 1])("omits missing or invalid alwaysLoad=%s", (alwaysLoad) => {
    const server = convertToRaspberryCodeAgentMcpServer("demo", { ...config, alwaysLoad });
    expect(server).not.toHaveProperty("alwaysLoad");
    const received = raspberrycodeProtocolMcpServerSchema.parse(JSON.parse(JSON.stringify(server)));
    expect(received).not.toHaveProperty("alwaysLoad");
  });
});
