import { describe, expect, it } from "vitest";
import {
  convertToRaspberryCodeAgentMcpServer,
  isRaspberryCodeCuaMcpCommand,
  isRaspberryCodeCuaMcpPackageArg,
} from "../src/mcp.js";

describe("raspberrycode-cua MCP matcher (single source of truth for services + CLI bootstrap)", () => {
  it("matches the raspberrycode-cua command by leaf name", () => {
    expect(isRaspberryCodeCuaMcpCommand("raspberrycode-cua")).toBe(true);
    expect(isRaspberryCodeCuaMcpCommand("/opt/homebrew/bin/raspberrycode-cua")).toBe(true);
    expect(isRaspberryCodeCuaMcpCommand("uvx")).toBe(false);
    expect(isRaspberryCodeCuaMcpCommand("raspberrycode-cua-server")).toBe(false);
  });

  it("matches uvx/pip package spec forms", () => {
    for (const arg of ["raspberrycode-cua", "raspberrycode-cua[macos]", "raspberrycode-cua@v0.1.3", "raspberrycode-cua[macos]@v0.1.3"]) {
      expect(isRaspberryCodeCuaMcpPackageArg(arg)).toBe(true);
    }
  });

  it("matches git and local-path forms (the drift that broke desktop/services parity)", () => {
    expect(isRaspberryCodeCuaMcpPackageArg("raspberrycode-cua.git")).toBe(true);
    expect(isRaspberryCodeCuaMcpPackageArg("git+https://github.com/x/raspberrycode-cua.git@v0.1.3")).toBe(true);
    expect(isRaspberryCodeCuaMcpPackageArg("/Users/me/src/raspberrycode-cua")).toBe(true);
    expect(isRaspberryCodeCuaMcpPackageArg("C:\\src\\raspberrycode-cua")).toBe(true);
  });

  it("does not match unrelated args", () => {
    for (const arg of ["--from", "run", "raspberrycode-cua-server", "not-raspberrycode-cua", "server.js"]) {
      expect(isRaspberryCodeCuaMcpPackageArg(arg)).toBe(false);
    }
  });

  it("recognizes a package spec placed in COMMAND position (command/arg matchers stay consistent)", () => {
    // 之前 command matcher 只认精确叶子 raspberrycode-cua，会漏判把包规格直接当 command 的配置 → 漏注入 broker。
    for (const command of ["raspberrycode-cua@1.2.3", "raspberrycode-cua[macos]", "raspberrycode-cua.git", "/opt/tools/raspberrycode-cua@1.2.3"]) {
      expect(isRaspberryCodeCuaMcpCommand(command), command).toBe(true);
    }
  });

  it("recognizes pip == pins and the raspberrycode_cua underscore distribution name (PyPI treats _ == -)", () => {
    for (const arg of ["raspberrycode-cua==1.2.3", "raspberrycode_cua", "raspberrycode_cua==1.2.3", "raspberrycode_cua@v0.1.3"]) {
      expect(isRaspberryCodeCuaMcpPackageArg(arg), arg).toBe(true);
    }
    expect(isRaspberryCodeCuaMcpCommand("raspberrycode_cua")).toBe(true);
  });

  it("does not false-positive on sibling packages like raspberrycode-cua-proxy", () => {
    for (const value of ["raspberrycode-cua-proxy", "raspberrycode-cua-proxy@1.0.0", "raspberrycode-cua-helper"]) {
      expect(isRaspberryCodeCuaMcpCommand(value), value).toBe(false);
      expect(isRaspberryCodeCuaMcpPackageArg(value), value).toBe(false);
    }
  });

  it("recognizes `python -m raspberrycode_cua.server` submodule form (M1 fail-open fix)", () => {
    // `python -m raspberrycode_cua.server` → arg 是 `raspberrycode_cua.server`；旧 matcher 漏判 → 不注入 broker → fail-open。
    for (const arg of ["raspberrycode_cua.server", "raspberrycode-cua.server", "raspberrycode_cua.main", "raspberrycode-cua.__main__"]) {
      expect(isRaspberryCodeCuaMcpPackageArg(arg), arg).toBe(true);
    }
  });

  it("recognizes local paths with a trailing separator (M1 fail-open fix)", () => {
    // `.../raspberrycode-cua/` 直接取叶子会得到空串 → 漏判 → fail-open。
    expect(isRaspberryCodeCuaMcpPackageArg("/Users/me/src/raspberrycode-cua/")).toBe(true);
    expect(isRaspberryCodeCuaMcpPackageArg("C:\\src\\raspberrycode-cua\\")).toBe(true);
    expect(isRaspberryCodeCuaMcpCommand("/opt/homebrew/bin/raspberrycode-cua/")).toBe(true);
    // 但带尾斜杠的 sibling 仍不误判。
    expect(isRaspberryCodeCuaMcpPackageArg("/Users/me/src/raspberrycode-cua-proxy/")).toBe(false);
  });
});

describe("MCP config helpers", () => {
  it("passes legacy http_headers through to RaspberryCode Agent MCP servers", () => {
    expect(
      convertToRaspberryCodeAgentMcpServer("web-search-prime", {
        type: "http",
        url: "https://bigmodel.example.test/mcp",
        timeoutMs: 5000,
        http_headers: {
          Authorization: "Bearer token",
        },
      }),
    ).toEqual({
      name: "web-search-prime",
      type: "http",
      url: "https://bigmodel.example.test/mcp",
      headers: [{ name: "Authorization", value: "Bearer token" }],
      timeoutMs: 5000,
    });
  });

  it("preserves timeoutMs when converting stdio MCP servers for RaspberryCode Agent", () => {
    expect(
      convertToRaspberryCodeAgentMcpServer("context7", {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        timeoutMs: 3,
      }),
    ).toEqual({
      name: "context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: [],
      timeoutMs: 3,
    });
  });

  it("preserves timeoutMs when converting sse MCP servers for RaspberryCode Agent", () => {
    expect(
      convertToRaspberryCodeAgentMcpServer("stream", {
        type: "sse",
        url: "https://bigmodel.example.test/sse",
        timeoutMs: 8000,
      }),
    ).toEqual({
      name: "stream",
      type: "sse",
      url: "https://bigmodel.example.test/sse",
      headers: [],
      timeoutMs: 8000,
    });
  });

  it("preserves HTTP OAuth client credentials when converting MCP servers for RaspberryCode Agent", () => {
    expect(
      convertToRaspberryCodeAgentMcpServer("protected", {
        type: "http",
        url: "https://mcp.example.test/mcp",
        oauth: {
          type: "client_credentials",
          clientId: "raspberrycode-client",
          clientSecret: "secret",
          scope: "mcp:tools",
        },
      }),
    ).toMatchObject({
      name: "protected",
      type: "http",
      oauth: {
        type: "client_credentials",
        clientId: "raspberrycode-client",
        clientSecret: "secret",
        scope: "mcp:tools",
      },
    });
  });

  it("preserves HTTP OAuth authorization code config when converting MCP servers for RaspberryCode Agent", () => {
    expect(
      convertToRaspberryCodeAgentMcpServer("figma", {
        type: "http",
        url: "https://mcp.figma.com/mcp",
        oauth: {
          type: "authorization_code",
          clientName: "RaspberryCode",
          redirectPath: "/oauth/callback/mcp/figma",
          scope: "mcp:connect",
        },
      }),
    ).toMatchObject({
      name: "figma",
      type: "http",
      oauth: {
        type: "authorization_code",
        clientName: "RaspberryCode",
        redirectPath: "/oauth/callback/mcp/figma",
        scope: "mcp:connect",
      },
    });
  });

  it("does not persist implicit OAuth defaults when converting bare HTTP MCP servers", () => {
    expect(
      convertToRaspberryCodeAgentMcpServer("notion", {
        type: "http",
        url: "https://mcp.notion.com/mcp",
        timeoutMs: 30000,
      }),
    ).toEqual({
      name: "notion",
      type: "http",
      url: "https://mcp.notion.com/mcp",
      headers: [],
      timeoutMs: 30000,
    });
  });

  it("drops invalid timeoutMs when converting MCP servers for RaspberryCode Agent", () => {
    expect(
      convertToRaspberryCodeAgentMcpServer("zero", {
        type: "stdio",
        command: "npx",
        timeoutMs: 0,
      }),
    ).not.toHaveProperty("timeoutMs");

    expect(
      convertToRaspberryCodeAgentMcpServer("fractional", {
        type: "http",
        url: "https://bigmodel.example.test/mcp",
        timeoutMs: 1.5,
      }),
    ).not.toHaveProperty("timeoutMs");
  });

  it("keeps headers ahead of legacy http_headers when both are present", () => {
    expect(
      convertToRaspberryCodeAgentMcpServer("web-reader", {
        type: "sse",
        url: "https://bigmodel.example.test/sse",
        headers: {
          Authorization: "Bearer fresh",
        },
        http_headers: {
          Authorization: "Bearer stale",
        },
      }),
    ).toMatchObject({
      headers: [{ name: "Authorization", value: "Bearer fresh" }],
    });
  });
});
