import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TaskActionMenuContent } from "@/TaskActionMenuContent.js";

const PIN_ITEM_INDEX = 0;
const RENAME_ITEM_INDEX = 1;
const ARCHIVE_ITEM_INDEX = 2;
const UNREAD_ITEM_INDEX = 3;
const DELETE_ITEM_INDEX = 4;
const FILE_MANAGER_ITEM_INDEX = 5;
const WORKSPACE_PATH_ITEM_INDEX = 6;
const TASK_PATH_ITEM_INDEX = 7;
const TASK_LOG_PATH_ITEM_INDEX = 8;
const PROVIDER_CONFIG_ITEM_INDEX = 9;

function renderMenu(overrides: Partial<React.ComponentProps<typeof TaskActionMenuContent>> = {}) {
  const itemStates: Array<{ disabled?: boolean; variant?: string; testId?: string }> = [];

  const html = renderToStaticMarkup(
    createElement(TaskActionMenuContent, {
      intl: {
        formatMessage: ({ id }: { id: string }) => id,
      },
      isPinned: false,
      fileManagerLabel: "Open in Finder",
      taskSessionFile: {
        loading: false,
        path: "/tmp/task/session.md",
        exists: true,
      },
      taskNativeSessionLogFile: {
        loading: false,
        path: "/tmp/task/session.jsonl",
        exists: true,
      },
      providerConfigFile: {
        loading: false,
        path: "/tmp/provider/config.json",
        exists: true,
      },
      Item: ({
        children,
        title,
        disabled,
        variant,
        "data-testid": testId,
      }: {
        children: React.ReactNode;
        title?: string;
        disabled?: boolean;
        variant?: "default" | "destructive";
        "data-testid"?: string;
      }) => {
        itemStates.push({ disabled, variant, testId });
        return createElement(
          "button",
          { title, disabled, "data-variant": variant, "data-testid": testId },
          children,
        );
      },
      Separator: () => createElement("hr"),
      onTogglePinTask: vi.fn(),
      onStartRenameTask: vi.fn(),
      onArchiveTask: vi.fn(),
      onMarkTaskAsUnread: vi.fn(),
      onDeleteTask: vi.fn(),
      onOpenTaskPathInFileManager: vi.fn(),
      onCopyWorkspacePath: vi.fn(),
      onCopyTaskPath: vi.fn(),
      onCopyTaskLogPath: vi.fn(),
      onOpenProviderConfig: vi.fn(),
      ...overrides,
    }),
  );

  return {
    html,
    itemStates,
  };
}

describe("TaskActionMenuContent", () => {
  it("provider 配置文件未落盘但路径已知时仍保留入口", () => {
    const { itemStates } = renderMenu({
      providerConfigFile: {
        loading: false,
        path: "/tmp/provider/config.json",
        exists: false,
      },
    });

    expect(itemStates[PROVIDER_CONFIG_ITEM_INDEX]?.disabled).toBe(false);
  });

  it("日志文件未落盘但路径已知时仍允许复制路径", () => {
    const { itemStates } = renderMenu({
      taskNativeSessionLogFile: {
        loading: false,
        path: "/tmp/task/raspberrycode-log.jsonl",
        exists: false,
      },
    });

    expect(itemStates[TASK_LOG_PATH_ITEM_INDEX]?.disabled).toBe(false);
  });

  it("新建未落库任务只禁用依赖 taskId 的动作", () => {
    const { itemStates } = renderMenu({
      disableTaskTargetActions: true,
    });

    expect(itemStates[PIN_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[RENAME_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[ARCHIVE_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[UNREAD_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[DELETE_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[TASK_PATH_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[TASK_LOG_PATH_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[FILE_MANAGER_ITEM_INDEX]?.disabled).toBe(false);
    expect(itemStates[WORKSPACE_PATH_ITEM_INDEX]?.disabled).toBe(false);
    expect(itemStates[PROVIDER_CONFIG_ITEM_INDEX]?.disabled).toBe(false);
  });

  it("手机远控菜单隐藏本机文件和配置入口但保留复制路径", () => {
    const { html } = renderMenu({
      hideMobileUnsupportedActions: true,
    });

    expect(html).not.toContain("Open in Finder");
    expect(html).not.toContain("appHeader.goToProviderConfig");
    expect(html).toContain("appHeader.copyPath");
    expect(html).toContain("appHeader.copyTaskPath");
    expect(html).toContain("appHeader.copyLogPath");
  });

  it("删除任务紧随标记未读，使用不可撤销的 destructive 语义", () => {
    const { html, itemStates } = renderMenu();

    expect(html).toContain("taskList.delete");
    expect(itemStates[DELETE_ITEM_INDEX]).toMatchObject({
      disabled: false,
      variant: "destructive",
      testId: "task-delete",
    });
    // 删除属于任务管理动作组，必须排在“在文件管理器中打开”分隔线之前。
    expect(html.indexOf("taskList.delete")).toBeLessThan(html.indexOf("Open in Finder"));
    expect(html.indexOf("taskList.markAsUnread")).toBeLessThan(html.indexOf("taskList.delete"));
  });

  it("调用方不提供删除命令时不渲染删除入口且不占用索引", () => {
    const { html, itemStates } = renderMenu({ onDeleteTask: undefined });

    expect(html).not.toContain("taskList.delete");
    expect(itemStates.some((state) => state.testId === "task-delete")).toBe(false);
    // 删掉删除项后，紧随其后的“在文件管理器中打开”顶到原删除位。
    expect(itemStates[DELETE_ITEM_INDEX]?.testId).toBeUndefined();
    expect(html).toContain("Open in Finder");
  });

  it("不再提供在分屏打开入口", () => {
    const { html } = renderMenu();

    expect(html).not.toContain("taskList.openInSplitPane");
  });
});
