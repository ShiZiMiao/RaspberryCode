// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useComposerConnectionSwitch,
  type ComposerConnection,
} from "@/hooks/useComposerConnectionSwitch.js";
import { encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { useModelSelectionServiceView } from "@/hooks/useModelSelectionView.js";
const mocks = vi.hoisted(() => {
  const settings = { providerFamilyConnectionSelections: {} } as Record<string, unknown>;
  const base = {
    settingService: { get: vi.fn(async () => settings) },
    providerSettingsService: { refresh: vi.fn(async () => {}) },
    modelSelectionService: { getView: vi.fn(), onDidChange: vi.fn(() => ({ dispose: vi.fn() })) },
  };
  return {
    base,
    target: base,
    settings,
    update: vi.fn(async (patch: unknown) => {
      Object.assign(settings, patch);
    }),
  };
});
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useBaseWorkspaceServices: () => mocks.base,
  useWorkspaceServicesResolution: () => ({ services: mocks.target, rpcReady: true }),
}));
vi.mock("@/hooks/useSettingService.js", () => ({ useSettings: () => ({ update: mocks.update }) }));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: () => "Switch failed; select again to retry" } }),
}));
const providerId = "custom-provider";
const connection: ComposerConnection = {
  key: "connection1",
  label: "Provider One",
  providerId,
  items: [],
};
const view = {
  revision: 2,
  providers: [
    {
      providerId,
      config: {
        access: { type: "api-key", apiKey: "test-key" },
        api: { type: "anthropic-messages" },
      },
      models: [{ modelId: "GLM-5.3", config: { optionSpecs: { reasoningLevel: { values: [] } } } }],
    },
  ],
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.target = mocks.base;
  mocks.settings.providerFamilyConnectionSelections = {
    bigmodel: { kind: "individual-coding-plan" },
  };
  mocks.base.modelSelectionService.getView.mockResolvedValue(view);
  mocks.base.providerSettingsService.refresh.mockResolvedValue(undefined);
});
afterEach(cleanup);
describe("Composer connection switching ownership", () => {
  it("同步完成才选择目标模型，快速重复点击只提交一次", async () => {
    const wait = deferred<typeof view>();
    mocks.base.modelSelectionService.getView.mockReturnValueOnce(wait.promise);
    const onSelectModel = vi.fn();
    const { result } = renderHook(() =>
      useComposerConnectionSwitch({
        workspacePath: "/work",
        agentProvider: "agent",
        normalizedValue: "",
        onSelectModel,
      }),
    );
    let task!: Promise<void>;
    await act(async () => {
      task = result.current.select(connection);
      await Promise.resolve();
    });
    expect(result.current.pending).toBe(true);
    expect(onSelectModel).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.select(connection);
    });
    await act(async () => {
      wait.resolve(view);
      await task;
    });
    expect(onSelectModel).toHaveBeenCalledTimes(1);
    expect(onSelectModel.mock.calls[0]![0]).toBe(encodeCustomModelValue(providerId, "GLM-5.3"));
    expect(result.current.pending).toBe(false);
  });
  it("切换后携带刚同步目录的思考档位，不能依赖旧目录", async () => {
    mocks.base.modelSelectionService.getView.mockResolvedValue({
      ...view,
      providers: [
        {
          ...view.providers[0],
          models: [
            {
              modelId: "GLM-5.3",
              config: { optionSpecs: { reasoningLevel: { values: ["low", "high", "max"] } } },
            },
          ],
        },
      ],
    });
    const onSelectModel = vi.fn();
    const { result } = renderHook(() =>
      useComposerConnectionSwitch({
        workspacePath: "/work",
        agentProvider: "agent",
        normalizedValue: encodeCustomModelValue("ordinary-api", "GLM-5.3"),
        onSelectModel,
      }),
    );
    await act(async () => {
      await result.current.select(connection);
    });
    expect(onSelectModel).toHaveBeenCalledWith(
      encodeCustomModelValue(providerId, "GLM-5.3"),
      "max",
    );
  });
  it("不同 workspaceIdentity 即使路径相同也拒绝旧结果", async () => {
    const wait = deferred<typeof view>();
    mocks.base.modelSelectionService.getView.mockReturnValueOnce(wait.promise);
    const onSelectModel = vi.fn();
    const { result, rerender } = renderHook(
      ({ identity }) =>
        useComposerConnectionSwitch({
          workspacePath: "/work",
          workspaceIdentity: identity,
          agentProvider: "agent",
          normalizedValue: "",
          onSelectModel,
        }),
      { initialProps: { identity: "ssh:first" } },
    );
    let task!: Promise<void>;
    await act(async () => {
      task = result.current.select(connection);
      await Promise.resolve();
    });
    rerender({ identity: "ssh:second" });
    await act(async () => {
      wait.resolve(view);
      await task;
    });
    expect(onSelectModel).not.toHaveBeenCalled();
  });
  it("同步失败显示可重试错误并允许重试", async () => {
    mocks.base.modelSelectionService.getView.mockRejectedValueOnce(new Error("offline"));
    const onSelectModel = vi.fn();
    const { result } = renderHook(() =>
      useComposerConnectionSwitch({
        workspacePath: "/work",
        agentProvider: "agent",
        normalizedValue: "",
        onSelectModel,
      }),
    );
    await act(async () => {
      await result.current.select(connection);
    });
    expect(result.current.error).toContain("retry");
    expect(onSelectModel).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.select(connection);
    });
    expect(onSelectModel).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });
  it("连接读取完成后仍 loading，直到界面确认目标选择", async () => {
    const onSelectModel = vi.fn();
    const { result, rerender } = renderHook(
      ({ value, status }) =>
        useComposerConnectionSwitch({
          workspacePath: "/work",
          agentProvider: "agent",
          normalizedValue: value,
          waitForPresentation: true,
          presentationStatus: status as "loading" | "ready",
          onSelectModel,
        }),
      { initialProps: { value: encodeCustomModelValue("api", "model"), status: "loading" } },
    );
    await act(async () => {
      await result.current.select(connection, "previous");
    });
    expect(result.current.pending).toBe(true);
    rerender({ value: encodeCustomModelValue(providerId, "GLM-5.3"), status: "ready" });
    expect(result.current.pending).toBe(false);
  });
  it("展示读取失败会解除等待并显示可重试错误", async () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: "loading" | "error" }) =>
        useComposerConnectionSwitch({
          workspacePath: "/work",
          agentProvider: "agent",
          normalizedValue: "",
          waitForPresentation: true,
          presentationStatus: status,
          onSelectModel: vi.fn(),
        }),
      { initialProps: { status: "loading" } },
    );
    await act(async () => {
      await result.current.select(connection);
    });
    expect(result.current.pending).toBe(true);
    rerender({ status: "error" });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

});

it("ready 不匹配解除 pending，显示错误并允许下一次选择", async () => {
  const { result, rerender } = renderHook(
    ({ status, value }) =>
      useComposerConnectionSwitch({
        workspacePath: "/work",
        agentProvider: "agent",
        normalizedValue: value,
        waitForPresentation: true,
        presentationStatus: status as "loading" | "ready",
        onSelectModel: vi.fn(),
      }),
    { initialProps: { status: "loading", value: "" } },
  );
  await act(async () => {
    await result.current.select(connection);
  });
  expect(result.current.pending).toBe(true);
  rerender({ status: "ready", value: "another/model" });
  expect(result.current.pending).toBe(false);
  expect(result.current.error).toContain("retry");
  rerender({ status: "loading", value: "" });
  await act(async () => {
    await result.current.select(connection);
  });
  expect(result.current.pending).toBe(true);
  rerender({ status: "ready", value: encodeCustomModelValue(providerId, "GLM-5.3") });
  expect(result.current.error).toBeNull();
  expect(result.current.pending).toBe(false);
});

it("旧 ready 不是本次展示回执：等待目标 revision，再对不匹配结果结束并报错", async () => {
  const { result, rerender } = renderHook(
    ({ revision, errorRevision }) =>
      useComposerConnectionSwitch({
        workspacePath: "/work",
        agentProvider: "agent",
        normalizedValue: "old/model",
        waitForPresentation: true,
        presentationStatus: "ready",
        presentationRevision: revision,
        presentationErrorRevision: errorRevision,
        onSelectModel: vi.fn(),
      }),
    { initialProps: { revision: 1, errorRevision: 1 as number | undefined } },
  );
  await act(async () => {
    await result.current.select(connection);
  });
  expect(result.current.pending).toBe(true);
  expect(result.current.error).toBeNull();
  rerender({ revision: 2, errorRevision: undefined });
  expect(result.current.pending).toBe(false);
  expect(result.current.error).toContain("retry");
});

it("真实展示 hook 保留旧 ready 时，目标刷新失败也必须结束连接等待并允许重试", async () => {
  let listener: ((candidate: any) => void) | undefined;
  let failPresentation = false;
  let revision = 1;
  const initial = { ...view, revision: 1, effectiveSelection: { providerId, modelId: "GLM-5.3" } };
  mocks.base.modelSelectionService.onDidChange.mockImplementation((callback: any) => {
    listener = callback;
    return { dispose: vi.fn() };
  });
  mocks.base.modelSelectionService.getView.mockImplementation(async (input?: unknown) => {
    if (input && failPresentation) throw new Error("presentation failed");
    if (!input) {
      if (revision === 1) {
        listener?.(view);
        revision = 2;
      }
      return view;
    }
    return { ...initial, revision };
  });
  const value = encodeCustomModelValue(providerId, "GLM-5.3");
  const hook = renderHook(() => {
    const presentation = useModelSelectionServiceView(
      mocks.base.modelSelectionService as any,
      true,
      "remote-waiting",
      {
        selection: { providerId, modelId: "GLM-5.3" },
      },
    );
    const state = presentation.state;
    return useComposerConnectionSwitch({
      workspacePath: "/work",
      agentProvider: "agent",
      normalizedValue: value,
      onSelectModel: vi.fn(),
      waitForPresentation: true,
      refreshPresentation: presentation.refresh,
      presentationStatus: state.status,
      presentationRevision: state.status === "ready" ? state.view.revision : undefined,
      presentationErrorRevision:
        state.status === "ready" ? state.refreshError?.revision : undefined,
    });
  });
  await waitFor(() => expect(mocks.base.modelSelectionService.getView).toHaveBeenCalled());
  failPresentation = true;
  await act(async () => {
    await hook.result.current.select(connection);
  });
  await waitFor(() => expect(hook.result.current.pending).toBe(false));
  expect(hook.result.current.error).toContain("retry");
  failPresentation = false;
  await act(async () => {
    await hook.result.current.select(connection);
  });
  expect(hook.result.current.pending).toBe(false);
  expect(hook.result.current.error).toBeNull();
});

it("真实展示 hook 的旧读取失败不能否定新输入已成功的连接切换", async () => {
  let rejectOld!: (error: Error) => void;
  let oldStarted = false;
  let armed = false;
  const effective = { ...view, effectiveSelection: { providerId, modelId: "GLM-5.3" } };
  mocks.base.modelSelectionService.getView.mockImplementation((input?: unknown) => {
    if (input && armed && !oldStarted) {
      oldStarted = true;
      return new Promise((_resolve, reject) => {
        rejectOld = reject;
      });
    }
    return Promise.resolve(effective);
  });
  const value = encodeCustomModelValue(providerId, "GLM-5.3");
  const hook = renderHook(
    ({ reasoning }) => {
      const presentation = useModelSelectionServiceView(
        mocks.base.modelSelectionService as any,
        true,
        "remote-waiting",
        {
          selection: { providerId, modelId: "GLM-5.3", options: { reasoningLevel: reasoning } },
        },
      );
      const state = presentation.state;
      return {
        state,
        connection: useComposerConnectionSwitch({
          workspacePath: "/work",
          agentProvider: "agent",
          normalizedValue: value,
          onSelectModel: vi.fn(),
          waitForPresentation: true,
          refreshPresentation: presentation.refresh,
          presentationStatus: state.status,
          presentationRevision: state.status === "ready" ? state.view.revision : undefined,
          presentationErrorRevision:
            state.status === "ready" ? state.refreshError?.revision : undefined,
        }),
      };
    },
    { initialProps: { reasoning: "disabled" } },
  );
  await waitFor(() => expect(hook.result.current.state.status).toBe("ready"));
  armed = true;
  let operation!: Promise<void>;
  await act(async () => {
    operation = hook.result.current.connection.select(connection);
  });
  await waitFor(() => expect(oldStarted).toBe(true));
  hook.rerender({ reasoning: "enabled" });
  await waitFor(() => expect(hook.result.current.state.status).toBe("ready"));
  await act(async () => {
    rejectOld(new Error("obsolete input failed"));
    await operation;
  });
  await waitFor(() => expect(hook.result.current.connection.pending).toBe(false));
  expect(hook.result.current.connection.error).toBeNull();
});
