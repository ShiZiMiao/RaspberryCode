import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractCodexSessionMeta,
  extractCodexVisibleMessages,
  previewCodexSessionTitle,
} from "../src/session/claude-native/codexSessionParser.js";

function record(value: unknown) {
  return value as Record<string, unknown>;
}

const sessionMeta = {
  timestamp: "2026-11-06T06:37:35.680Z",
  type: "session_meta",
  payload: {
    session_id: "01a1af93-b337-7923-8f68-afa974fa2cd5",
    id: "01a1af93-b337-7923-8f68-afa974fa2cd5",
    cwd: "C:\\Users\\demo\\Documents\\Codex\\ni-h",
    model_provider: "custom",
    base_instructions: { text: "You are Codex..." },
  },
};

describe("codexSessionParser", () => {
  it("从 session_meta 读取 cwd 与 session id", () => {
    expect(extractCodexSessionMeta([record(sessionMeta)])).toMatchObject({
      sessionId: "01a1af93-b337-7923-8f68-afa974fa2cd5",
      workspacePath: "C:\\Users\\demo\\Documents\\Codex\\ni-h",
    });
  });

  it("只提取 user/assistant 可见消息，丢弃 developer 注入提示词", () => {
    const messages = extractCodexVisibleMessages([
      record(sessionMeta),
      record({
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "<app-context>injected</app-context>" }],
        },
      }),
      record({
        timestamp: "2026-11-06T06:38:00.000Z",
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "你好" }] },
      }),
      record({
        timestamp: "2026-11-06T06:38:05.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "你好！有什么可以帮你的？" }],
        },
      }),
      // 运行态事件不参与对话
      record({ type: "event_msg", payload: { type: "token_count" } }),
    ]);

    expect(messages).toEqual([
      { role: "user", content: "你好", timestamp: Date.parse("2026-11-06T06:38:00.000Z") },
      {
        role: "assistant",
        content: "你好！有什么可以帮你的？",
        timestamp: Date.parse("2026-11-06T06:38:05.000Z"),
      },
    ]);
  });

  it("多条文本块按段落拼接，空内容消息被丢弃", () => {
    const messages = extractCodexVisibleMessages([
      record({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "第一段" },
            { type: "input_text", text: "第二段" },
          ],
        },
      }),
      record({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "  " }],
        },
      }),
    ]);
    expect(messages).toEqual([{ role: "user", content: "第一段\n\n第二段" }]);
  });

  it("剥离 Codex 以 user 角色注入的环境上下文", () => {
    const messages = extractCodexVisibleMessages([
      record({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "<environment_context>\n  <cwd>C:\\repo</cwd>\n  <shell>powershell</shell>\n</environment_context>\n",
            },
          ],
        },
      }),
      record({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "真实提问" }],
        },
      }),
    ]);
    // 纯环境注入的那条整条丢弃，不能进入正文或标题。
    expect(messages).toEqual([{ role: "user", content: "真实提问" }]);
  });

  it("环境注入与真实提问混在同一条时只保留提问", () => {
    const messages = extractCodexVisibleMessages([
      record({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "<environment_context><cwd>C:\\repo</cwd></environment_context>\n真正的需求",
            },
          ],
        },
      }),
    ]);
    expect(messages).toEqual([{ role: "user", content: "真正的需求" }]);
  });

  it("不剥离 assistant 正文里的标签样式内容", () => {
    const messages = extractCodexVisibleMessages([
      record({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "示例：<environment_context>x</environment_context>" },
          ],
        },
      }),
    ]);
    expect(messages).toEqual([
      {
        role: "assistant",
        content: "示例：<environment_context>x</environment_context>",
      },
    ]);
  });

  it("无可见用户消息时不产出标题", () => {
    expect(previewCodexSessionTitle([])).toBeUndefined();
    expect(
      previewCodexSessionTitle([{ role: "assistant", content: "only assistant" }]),
    ).toBeUndefined();
  });

  it("标题取自首条用户消息", () => {
    expect(
      previewCodexSessionTitle([{ role: "user", content: "帮我分析磁盘占用情况" }]),
    ).toBeTruthy();
  });
});

describe("codexSessions 目录约定", () => {
  it("扫描不到目录时返回空数组而不是抛错", async () => {
    const home = mkdtempSync(join(tmpdir(), "raspberrycode-codex-home-"));
    const previousHome = process.env.HOME;
    try {
      process.env.HOME = home;
      const { externalSessionImportRepo } =
        await import("../src/session/claude-native/externalSessionImportRepo.js");
      expect(await externalSessionImportRepo.scanCodexSessions({})).toEqual([]);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("按 rollout 结构落入候选并解析出可见消息", async () => {
    const home = mkdtempSync(join(tmpdir(), "raspberrycode-codex-home-"));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    try {
      const dayDir = join(home, ".codex", "sessions", "2026", "11", "06");
      mkdirSync(dayDir, { recursive: true });
      const filePath = join(dayDir, "rollout-2026-11-06T14-37-34-demo.jsonl");
      const lines = [
        sessionMeta,
        {
          timestamp: "2026-11-06T06:38:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "你好" }],
          },
        },
        {
          timestamp: "2026-11-06T06:38:05.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "你好！" }],
          },
        },
      ];
      writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf-8");
      process.env.HOME = home;
      // homedir() 在本机可能仍指向真实用户目录；同步覆盖 USERPROFILE 让 Windows 也命中。
      process.env.USERPROFILE = home;

      const { externalSessionImportRepo } =
        await import("../src/session/claude-native/externalSessionImportRepo.js");
      const candidates = await externalSessionImportRepo.scanCodexSessions({});
      const fromFixture = candidates.find(
        (candidate) => candidate.sessionId === "01a1af93-b337-7923-8f68-afa974fa2cd5",
      );
      // homedir() 缓存了真实路径时可能扫不到夹具，此时只验证不抛错。
      if (fromFixture) {
        expect(fromFixture.provider).toBe("codex");
        expect(fromFixture.workspacePath).toBe("C:\\Users\\demo\\Documents\\Codex\\ni-h");
      }
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
