import { describe, expect, it } from "vitest";
import {
  extractRaspberryCodeFileCitations,
  projectRaspberryCodeFileCitations,
  resolveRaspberryCodeFileCitationPreviewKind,
} from "@/lib/raspberrycodeFileCitation.js";

describe("raspberrycode-file-citation parser", () => {
  it("只保留 path、purpose 和 artifact_kind，并容忍其它定位参数", () => {
    const content = [
      '前文 ::raspberrycode-file-citation{path="docs/年度 报告.docx" purpose="output" artifact_kind="document" page_number=4 future_locator="ignored"} 后文',
      String.raw`::raspberrycode-file-citation{path='C:\Users\张三\演示 文稿.pptx', artifact_kind=presentation, slide_number=3}`,
      ':raspberrycode-file-citation{path="sheets/年度 总结.xlsx" purpose="source" artifact_kind="workbook" sheet_name="总览"}',
      ':::raspberrycode-file-citation{path="reports/论文.pdf" purpose="source"}',
    ].join("\n");

    expect(extractRaspberryCodeFileCitations(content)).toEqual([
      {
        artifactKind: "document",
        end: content.indexOf("} 后文") + 1,
        path: "docs/年度 报告.docx",
        purpose: "output",
        raw: '::raspberrycode-file-citation{path="docs/年度 报告.docx" purpose="output" artifact_kind="document" page_number=4 future_locator="ignored"}',
        start: 3,
      },
      {
        artifactKind: "presentation",
        end: content.indexOf("\n:raspberrycode-file-citation"),
        path: String.raw`C:\Users\张三\演示 文稿.pptx`,
        purpose: undefined,
        raw: String.raw`::raspberrycode-file-citation{path='C:\Users\张三\演示 文稿.pptx', artifact_kind=presentation, slide_number=3}`,
        start: content.indexOf("\n::raspberrycode-file-citation") + 1,
      },
      {
        artifactKind: "workbook",
        end: content.indexOf("\n:::raspberrycode-file-citation"),
        path: "sheets/年度 总结.xlsx",
        purpose: "source",
        raw: ':raspberrycode-file-citation{path="sheets/年度 总结.xlsx" purpose="source" artifact_kind="workbook" sheet_name="总览"}',
        start: content.indexOf("\n:raspberrycode-file-citation") + 1,
      },
      {
        end: content.length,
        path: "reports/论文.pdf",
        purpose: "source",
        raw: ':::raspberrycode-file-citation{path="reports/论文.pdf" purpose="source"}',
        start: content.indexOf("\n:::raspberrycode-file-citation") + 1,
      },
    ]);
  });

  it("支持 citation 参数使用中文智能单双引号", () => {
    const content = [
      '::raspberrycode-file-citation{path=“docs/年度 报告.docx” purpose=‘output’ artifact_kind="document"}',
      "::raspberrycode-file-citation{path='docs/普通 报告.pdf' purpose=\"output\"}",
    ].join("\n");

    expect(
      extractRaspberryCodeFileCitations(content).map(({ path, purpose, artifactKind }) => ({
        path,
        purpose,
        artifactKind,
      })),
    ).toEqual([
      {
        path: "docs/年度 报告.docx",
        purpose: "output",
        artifactKind: "document",
      },
      {
        path: "docs/普通 报告.pdf",
        purpose: "output",
        artifactKind: undefined,
      },
    ]);
  });

  it("忽略未闭合、参数格式错误和缺少 path 的指令", () => {
    expect(
      extractRaspberryCodeFileCitations(
        [
          '::raspberrycode-file-citation{purpose="output"}',
          '::raspberrycode-file-citation{path "missing equals.pdf"}',
          '::raspberrycode-file-citation{path="unclosed.pdf"',
          ':raspberrycode-file-citation{path "single-colon-missing-equals.pdf"}',
          '::::raspberrycode-file-citation{path="too-many-colons.pdf"}',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("错配智能引号时 fail closed", () => {
    expect(extractRaspberryCodeFileCitations("::raspberrycode-file-citation{path=“docs/report.pdf'}")).toEqual([]);
  });

  it("streaming 隐藏最后一行未闭合 citation，但不吞掉异常输出后的正文", () => {
    const incomplete = projectRaspberryCodeFileCitations(
      '正文\n::raspberrycode-file-citation{path="reports/result.pdf"',
      { streaming: true },
    );
    expect(incomplete.visibleText).toBe("正文\n");

    const inlineIncomplete = projectRaspberryCodeFileCitations(
      '请注意 ::raspberrycode-file-citation{path="reports/result.pdf"',
      { streaming: true },
    );
    expect(inlineIncomplete.visibleText).toBe("请注意 ");

    const malformedWithFollowingText = projectRaspberryCodeFileCitations(
      '正文\n::raspberrycode-file-citation{path="reports/result.pdf"\n后续说明仍然可见',
      { streaming: true },
    );
    expect(malformedWithFollowingText.visibleText).toContain("后续说明仍然可见");
    expect(malformedWithFollowingText.visibleText).toContain("::raspberrycode-file-citation");

    const inlineMalformed = projectRaspberryCodeFileCitations(
      '请注意 ::raspberrycode-file-citation{path="reports/result.pdf" 后续说明',
      { streaming: true },
    );
    expect(inlineMalformed.visibleText).toContain("请注意");
    expect(inlineMalformed.visibleText).toContain("后续说明");

    const legacyIncomplete = projectRaspberryCodeFileCitations(
      '正文\n:raspberrycode-file-citation{path="reports/legacy.pdf"',
      { streaming: true },
    );
    expect(legacyIncomplete.visibleText).toBe("正文\n");

    const legacyMalformed = projectRaspberryCodeFileCitations(
      '正文\n:raspberrycode-file-citation{path="reports/legacy.pdf"\n后续说明仍然可见',
      { streaming: true },
    );
    expect(legacyMalformed.visibleText).toContain("后续说明仍然可见");
    expect(legacyMalformed.visibleText).toContain(":raspberrycode-file-citation");

    const tripleIncomplete = projectRaspberryCodeFileCitations(
      '正文\n:::raspberrycode-file-citation{path="reports/triple.pdf"',
      { streaming: true },
    );
    expect(tripleIncomplete.visibleText).toBe("正文\n");
  });

  it("streaming 在 citation 名称尚未闭合前暂存协议前缀", () => {
    expect(projectRaspberryCodeFileCitations("正文\n::", { streaming: true }).visibleText).toBe("正文\n");
    expect(
      projectRaspberryCodeFileCitations("正文\n::raspberrycode-file-cit", { streaming: true }).visibleText,
    ).toBe("正文\n");
    expect(projectRaspberryCodeFileCitations("正文\n:", { streaming: true }).visibleText).toBe("正文\n:");
    expect(
      projectRaspberryCodeFileCitations("正文\n:raspberrycode-file-cit", { streaming: true }).visibleText,
    ).toBe("正文\n");
    expect(
      projectRaspberryCodeFileCitations("正文\n:::raspberrycode-file-cit", { streaming: true }).visibleText,
    ).toBe("正文\n");
    expect(
      projectRaspberryCodeFileCitations("正文\n::raspberrycode-file-citationX", { streaming: true }).visibleText,
    ).toContain("::raspberrycode-file-citationX");
    expect(
      projectRaspberryCodeFileCitations("正文\n:raspberrycode-file-citationX", { streaming: true }).visibleText,
    ).toContain(":raspberrycode-file-citationX");
  });

  it("智能引号未闭合时仍隐藏流式 citation 尾部", () => {
    const result = projectRaspberryCodeFileCitations("正文\n::raspberrycode-file-citation{path=“docs/report.pdf”", {
      streaming: true,
    });
    expect(result.visibleText).toBe("正文\n");
  });

  it("artifact_kind 优先映射且必须与后缀兼容，未设置时按后缀推断", () => {
    expect(
      resolveRaspberryCodeFileCitationPreviewKind({
        artifactKind: "document",
        path: "report.docx",
      }),
    ).toBe("docx");
    expect(
      resolveRaspberryCodeFileCitationPreviewKind({
        artifactKind: "presentation",
        path: "deck.pptx",
      }),
    ).toBe("pptx");
    expect(
      resolveRaspberryCodeFileCitationPreviewKind({
        artifactKind: "workbook",
        path: "book.xlsx",
      }),
    ).toBe("xlsx");
    expect(resolveRaspberryCodeFileCitationPreviewKind({ path: "paper.PDF" })).toBe("pdf");
    expect(resolveRaspberryCodeFileCitationPreviewKind({ path: "README.md" })).toBeNull();
    expect(
      resolveRaspberryCodeFileCitationPreviewKind({
        artifactKind: "document",
        path: "paper.pdf",
      }),
    ).toBeNull();
    expect(
      resolveRaspberryCodeFileCitationPreviewKind({
        artifactKind: "unknown",
        path: "paper.pdf",
      }),
    ).toBeNull();
    expect(
      resolveRaspberryCodeFileCitationPreviewKind({
        artifactKind: "",
        path: "paper.pdf",
      }),
    ).toBeNull();
  });
});
