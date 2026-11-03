import { describe, expect, it } from "vitest";
import { resolveDefaultEmbeddedSearchBackend } from "../src/app/embedded-search-backend.js";

describe("resolveDefaultEmbeddedSearchBackend", () => {
  it("uses bundled bfs, ugrep, and ripgrep paths by default", () => {
    expect(
      resolveDefaultEmbeddedSearchBackend({
        env: {
          RASPBERRYCODE_BFS_BINARY: "/opt/raspberrycode/tools/bfs/bfs",
          RASPBERRYCODE_RG_BINARY: "/opt/raspberrycode/tools/ripgrep/rg",
          RASPBERRYCODE_UGREP_BINARY: "/opt/raspberrycode/tools/ugrep/ugrep",
        },
      }),
    ).toEqual({
      kind: "native-binaries",
      findCommand: "/opt/raspberrycode/tools/bfs/bfs",
      grepCommand: "/opt/raspberrycode/tools/ugrep/ugrep",
      rgCommand: "/opt/raspberrycode/tools/ripgrep/rg",
    });
  });

  it("falls back to bfs, ugrep, and rg command names when bundled paths are unavailable", () => {
    expect(resolveDefaultEmbeddedSearchBackend({ env: {} })).toEqual({
      kind: "native-binaries",
      findCommand: "bfs",
      grepCommand: "ugrep",
      rgCommand: "rg",
    });
  });

  it("preserves the explicit internal CLI compatibility override", () => {
    expect(
      resolveDefaultEmbeddedSearchBackend({
        env: { RASPBERRYCODE_EMBEDDED_SEARCH_COMMAND: "/tmp/raspberrycode-test" },
      }),
    ).toEqual({
      kind: "internal-cli",
      command: "/tmp/raspberrycode-test",
      args: ["__internal-search"],
    });
  });
});
