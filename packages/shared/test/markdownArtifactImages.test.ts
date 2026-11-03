import { describe, expect, it } from "vitest";

import {
  decodeMarkdownArtifactImageSource,
  extractMarkdownArtifactImageRefs,
  rewriteMarkdownArtifactImageSources,
} from "../src/markdown-artifact-images.js";

describe("Markdown artifact image references", () => {
  it("extracts only image destinations and deduplicates them", () => {
    expect(
      extractMarkdownArtifactImageRefs(
        [
          "![first](raspberrycode-artifact://session/a)",
          "[download](raspberrycode-artifact://session/not-an-image)",
          '![again](<raspberrycode-artifact://session/a> "preview")',
          "![second](raspberrycode-artifact://session/b 'title')",
        ].join("\n"),
      ),
    ).toEqual(["raspberrycode-artifact://session/a", "raspberrycode-artifact://session/b"]);
  });

  it("does not authorize image-looking text inside fenced code", () => {
    expect(
      extractMarkdownArtifactImageRefs(
        "```md\n![secret](raspberrycode-artifact://session/secret)\n```\n![ok](raspberrycode-artifact://session/ok)",
      ),
    ).toEqual(["raspberrycode-artifact://session/ok"]);
  });

  it("rewrites artifact image destinations to a harden-safe relative source", () => {
    const rewritten = rewriteMarkdownArtifactImageSources(
      "before ![shot](raspberrycode-artifact://session/shot-1) after",
    );
    expect(rewritten).not.toContain("raspberrycode-artifact://");
    const source = rewritten.match(/!\[shot\]\(([^)]+)\)/u)?.[1];
    expect(source).toBeTruthy();
    expect(decodeMarkdownArtifactImageSource(source ?? "")).toBe("raspberrycode-artifact://session/shot-1");
  });

  it("leaves normal images, links, and fenced examples unchanged", () => {
    const markdown = [
      "![web](https://example.com/image.png)",
      "[artifact](raspberrycode-artifact://session/file)",
      "```md",
      "![example](raspberrycode-artifact://session/example)",
      "```",
    ].join("\n");
    expect(rewriteMarkdownArtifactImageSources(markdown)).toBe(markdown);
  });
});
