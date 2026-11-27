import { describe, expect, it, vi } from "vitest";
import {
  applyExternalTextInsertRequestToComposer,
  applyComposerRestoreRequestToComposer,
  restorePersistedComposerDraftIntoInput,
  type ComposerRestoreRequest,
} from "@/v4/ConversationComposer.js";

describe("v4 queue edit extraction", () => {
  it("Workspace 插件页重挂载时从共享草稿恢复结构化 mention", () => {
    const mention = {
      id: "plugin:document-skills@official",
      category: "plugins" as const,
      label: "文档技能",
      value: "document-skills@official",
      markdown: "[@文档技能](plugin://document-skills@official)",
      data: { pluginId: "document-skills@official" },
    };
    const inputApi = {
      getMarkdown: vi.fn(() => "unused"),
      setEditorStateJson: vi.fn(),
      setMention: vi.fn(),
      setText: vi.fn(),
    };
    const text = `${mention.markdown} 整理文档`;

    expect(
      restorePersistedComposerDraftIntoInput({
        draft: { text, mention, updatedAt: 1 },
        inputApi,
      }),
    ).toBe(text);
    expect(inputApi.setMention).toHaveBeenCalledWith(mention, " 整理文档");
    expect(inputApi.setText).not.toHaveBeenCalled();
  });

  it("商店试用把 canonical 前缀恢复为结构化 Plugin mention", () => {
    const mention = {
      id: "plugin:demo@mkt",
      category: "plugins" as const,
      label: "Demo",
      value: "demo@mkt",
      markdown: "[@Demo](plugin://demo@mkt)",
      data: {
        pluginId: "demo@mkt",
        icon: "https://cdn.example.com/demo.png",
      },
    };
    const inputApi = {
      setMention: vi.fn(),
      setText: vi.fn(),
    };
    const updateText = vi.fn();
    const requestFocus = vi.fn();
    const scheduleDraftPersist = vi.fn();
    const text = `${mention.markdown} Diagnose this workspace`;

    expect(
      applyExternalTextInsertRequestToComposer({
        appliedRequestId: null,
        inputApi,
        request: { requestId: 7, text, mention },
        requestFocus,
        scheduleDraftPersist,
        updateText,
      }),
    ).toBe(7);
    expect(inputApi.setMention).toHaveBeenCalledWith(mention, " Diagnose this workspace");
    expect(inputApi.setText).not.toHaveBeenCalled();
    expect(updateText).toHaveBeenCalledWith(text);
    expect(scheduleDraftPersist).toHaveBeenCalledTimes(1);
    expect(requestFocus).toHaveBeenCalledTimes(1);
  });

  it("插件安装完成后把唯一 chip 前置到编辑器当前正文而不回放旧 prompt", () => {
    const mention = {
      id: "plugin:document-skills@raspberrycode-plugins-official",
      category: "plugins" as const,
      label: "文档技能",
      value: "document-skills@raspberrycode-plugins-official",
      markdown: "[@文档技能](plugin://document-skills@raspberrycode-plugins-official)",
      data: { pluginId: "document-skills@raspberrycode-plugins-official" },
    };
    const inputApi = {
      getMarkdown: vi.fn(() => `${mention.markdown} 用户安装期间编辑后的正文`),
      prependMentionIfMissing: vi.fn(() => true),
      setMention: vi.fn(),
      setText: vi.fn(),
    };
    const updateText = vi.fn();
    const requestFocus = vi.fn();
    const scheduleDraftPersist = vi.fn();

    expect(
      applyExternalTextInsertRequestToComposer({
        appliedRequestId: null,
        inputApi,
        request: {
          requestId: 8,
          text: mention.markdown,
          mention,
          mode: "prepend-if-missing",
        },
        requestFocus,
        scheduleDraftPersist,
        updateText,
      }),
    ).toBe(8);
    expect(inputApi.prependMentionIfMissing).toHaveBeenCalledWith(mention);
    expect(updateText).toHaveBeenCalledWith(`${mention.markdown} 用户安装期间编辑后的正文`);
    expect(inputApi.setMention).not.toHaveBeenCalled();
    expect(inputApi.setText).not.toHaveBeenCalled();
  });

  it("当前草稿已有同一 Plugin canonical 文本时不重复插入 chip", () => {
    const mention = {
      id: "plugin:demo@mkt",
      category: "plugins" as const,
      label: "Demo",
      value: "demo@mkt",
      markdown: "[@Demo](plugin://demo@mkt)",
      data: { pluginId: "demo@mkt" },
    };
    const inputApi = {
      // label 是 display-only；即使语言切换导致 label 不同，同一 stable ID 也不能重复插入。
      getMarkdown: vi.fn(() => "[@旧名称](plugin://demo@mkt) 当前正文"),
      prependMentionIfMissing: vi.fn(() => false),
      setMention: vi.fn(),
      setText: vi.fn(),
    };
    const updateText = vi.fn();

    expect(
      applyExternalTextInsertRequestToComposer({
        appliedRequestId: null,
        inputApi,
        request: {
          requestId: 9,
          text: mention.markdown,
          mention,
          mode: "prepend-if-missing",
        },
        requestFocus: vi.fn(),
        scheduleDraftPersist: vi.fn(),
        updateText,
      }),
    ).toBe(9);
    expect(inputApi.prependMentionIfMissing).toHaveBeenCalledWith(mention);
    expect(inputApi.setMention).not.toHaveBeenCalled();
    expect(updateText).not.toHaveBeenCalled();
  });

  it("只在绑定 session/workspace 的空 composer 幂等恢复文字与附件", () => {
    const request: ComposerRestoreRequest = {
      requestId: 1,
      sessionId: "session-1",
      workspaceKey: "remote:ssh:host:/workspace",
      inputKind: "sendText",
      text: "排队原文",
      attachments: [{ ref: "ref-1", fileName: "a.png", mime: "image/png", bytes: 1 }],
      config: { mode: "yolo", planEnabled: false },
    };
    const inputApi = {
      focus: vi.fn(),
      setText: vi.fn(),
    };
    const updateText = vi.fn();
    const requestFocus = vi.fn();
    const scheduleDraftPersist = vi.fn();
    const restoreSessionOwnedAttachments = vi.fn(() => true);
    const restoreDraftConfig = vi.fn();

    expect(
      applyComposerRestoreRequestToComposer({
        appliedRequestId: null,
        currentSessionId: "session-1",
        currentWorkspaceKey: "remote:ssh:host:/workspace",
        hasDraftContent: false,
        inputApi,
        request,
        requestFocus,
        restoreSessionOwnedAttachments,
        restoreDraftConfig,
        scheduleDraftPersist,
        updateText,
      }),
    ).toBe(1);
    expect(inputApi.setText).toHaveBeenCalledWith("排队原文");
    expect(updateText).toHaveBeenCalledWith("排队原文");
    expect(requestFocus).toHaveBeenCalledTimes(1);
    expect(scheduleDraftPersist).toHaveBeenCalledTimes(1);
    expect(restoreSessionOwnedAttachments).toHaveBeenCalledWith(request.attachments);

    expect(
      applyComposerRestoreRequestToComposer({
        appliedRequestId: 1,
        currentSessionId: "session-1",
        currentWorkspaceKey: "remote:ssh:host:/workspace",
        hasDraftContent: false,
        inputApi,
        request,
        requestFocus,
        restoreSessionOwnedAttachments,
        restoreDraftConfig,
        scheduleDraftPersist,
        updateText,
      }),
    ).toBe(1);
    expect(inputApi.setText).toHaveBeenCalledTimes(1);
    expect(restoreSessionOwnedAttachments).toHaveBeenCalledTimes(1);

    expect(
      applyComposerRestoreRequestToComposer({
        appliedRequestId: null,
        currentSessionId: "session-other",
        currentWorkspaceKey: "remote:ssh:host:/workspace",
        hasDraftContent: false,
        inputApi,
        request,
        requestFocus,
        restoreSessionOwnedAttachments,
        restoreDraftConfig,
        scheduleDraftPersist,
        updateText,
      }),
    ).toBeNull();
    expect(
      applyComposerRestoreRequestToComposer({
        appliedRequestId: null,
        currentSessionId: "session-1",
        currentWorkspaceKey: "remote:ssh:host:/workspace",
        hasDraftContent: true,
        inputApi,
        request,
        requestFocus,
        restoreSessionOwnedAttachments,
        restoreDraftConfig,
        scheduleDraftPersist,
        updateText,
      }),
    ).toBeNull();
    expect(inputApi.setText).toHaveBeenCalledTimes(1);
    expect(restoreDraftConfig).toHaveBeenCalledExactlyOnceWith(request.config);
  });

  // 回退用 replaceExistingDraft=true 覆盖草稿；queue 撤回编辑缺省 false 时不得覆盖。
  // 两种语义同住一个函数，必须各自有回归，否则一次「统一行为」就会静默丢草稿。
  it("replaceExistingDraft 允许覆盖草稿，并在覆盖前清掉旧上下文引用", () => {
    const inputApi = { setText: vi.fn() };
    const updateText = vi.fn();
    const requestFocus = vi.fn();
    const scheduleDraftPersist = vi.fn();
    const restoreSessionOwnedAttachments = vi.fn().mockReturnValue(true);
    const clearExistingDraftContexts = vi.fn();
    const request = {
      requestId: 3,
      sessionId: "session-1",
      workspaceKey: "remote:ssh:host:/workspace",
      inputKind: "sendText" as const,
      text: "被回退的消息",
      attachments: [],
      replaceExistingDraft: true,
    } satisfies ComposerRestoreRequest;

    expect(
      applyComposerRestoreRequestToComposer({
        appliedRequestId: null,
        currentSessionId: "session-1",
        currentWorkspaceKey: "remote:ssh:host:/workspace",
        // 输入框已有草稿：默认路径会拒绝，这里必须被覆盖。
        hasDraftContent: true,
        inputApi,
        request,
        requestFocus,
        restoreSessionOwnedAttachments,
        clearExistingDraftContexts,
        scheduleDraftPersist,
        updateText,
      }),
    ).toBe(3);
    expect(clearExistingDraftContexts).toHaveBeenCalledTimes(1);
    expect(inputApi.setText).toHaveBeenCalledWith("被回退的消息");
    // 先清上下文再写正文：顺序反过来会在中间态留下引用指向不存在的正文。
    expect(clearExistingDraftContexts.mock.invocationCallOrder[0]).toBeLessThan(
      inputApi.setText.mock.invocationCallOrder[0]!,
    );

    // 缺省 false 时同样的 hasDraftContent 必须继续拒绝（queue 撤回编辑的既有契约）。
    const plain = { ...request, requestId: 4, replaceExistingDraft: undefined };
    expect(
      applyComposerRestoreRequestToComposer({
        appliedRequestId: null,
        currentSessionId: "session-1",
        currentWorkspaceKey: "remote:ssh:host:/workspace",
        hasDraftContent: true,
        inputApi,
        request: plain,
        requestFocus,
        restoreSessionOwnedAttachments,
        clearExistingDraftContexts,
        scheduleDraftPersist,
        updateText,
      }),
    ).toBeNull();
    expect(clearExistingDraftContexts).toHaveBeenCalledTimes(1);
  });
});
