import { describe, expect, it } from "vitest";
import {
  isProviderStartupSyncPending,
  shouldResolveProviderStartupState,
  shouldBlockRootRender,
  shouldShowRootStartupLoading,
  shouldOpenFallbackWorkspaceAfterCreate,
} from "@/lib/rootStartupGate.js";

describe("Root startup gate", () => {
  it("会在恢复标签页时阻塞首屏", () => {
    expect(
      shouldBlockRootRender({
        isResolvingStartupAuthState: false,
        isResolvingProviderStartupState: false,
        isRestoring: true,
        isBootstrappingInitialWorkspace: false,
      }),
    ).toBe(true);
  });

  it("会在注入初始工作区时阻塞首屏", () => {
    expect(
      shouldBlockRootRender({
        isResolvingStartupAuthState: false,
        isResolvingProviderStartupState: false,
        isRestoring: false,
        isBootstrappingInitialWorkspace: true,
      }),
    ).toBe(true);
  });

  it("会在启动鉴权状态未落定时阻塞首屏", () => {
    expect(
      shouldBlockRootRender({
        isResolvingStartupAuthState: true,
        isResolvingProviderStartupState: false,
        isRestoring: false,
        isBootstrappingInitialWorkspace: false,
      }),
    ).toBe(true);
  });

  it("会在 provider 登录入口判定未落定时阻塞首屏", () => {
    expect(
      shouldBlockRootRender({
        isResolvingStartupAuthState: false,
        isResolvingProviderStartupState: true,
        isRestoring: false,
        isBootstrappingInitialWorkspace: false,
      }),
    ).toBe(true);
  });

  it("所有启动检查完成后才放行首屏", () => {
    expect(
      shouldBlockRootRender({
        isResolvingStartupAuthState: false,
        isResolvingProviderStartupState: false,
        isRestoring: false,
        isBootstrappingInitialWorkspace: false,
      }),
    ).toBe(false);
  });

  it("provider 启动同步未完成时会延后首屏放行", () => {
    const providerStartupSyncPending = isProviderStartupSyncPending({
      providerFamilyDomainMigrationComplete: false,
      modelSelectionViewHydrated: true,
    });
    expect(providerStartupSyncPending).toBe(true);
    expect(
      shouldBlockRootRender({
        isResolvingStartupAuthState: false,
        isResolvingProviderStartupState: providerStartupSyncPending,
        isRestoring: false,
        isBootstrappingInitialWorkspace: false,
      }),
    ).toBe(true);
  });

  it("桌面 Root 在 provider 启动同步未完成时继续等待", () => {
    expect(
      shouldResolveProviderStartupState({
        isMobileOverlayRoot: false,
        providerStartupSyncPending: true,
      }),
    ).toBe(true);
  });

  it("桌面 Root 在 provider 启动同步完成后放行（无登录判定）", () => {
    // 登录入口守卫已移除（specs/no-login-startup.md）：不再有账号/Provider 可用性登录门禁。
    expect(
      shouldResolveProviderStartupState({
        isMobileOverlayRoot: false,
        providerStartupSyncPending: false,
      }),
    ).toBe(false);
  });

  it("启动门禁未清时显示启动 loading", () => {
    expect(
      shouldShowRootStartupLoading({
        isDesktop: true,
        isResolvingStartupAuthState: false,
        isResolvingProviderStartupState: true,
        isRestoring: false,
        isBootstrappingInitialWorkspace: false,
      }),
    ).toBe(true);
  });

  it("启动门禁清除后不再显示启动 loading", () => {
    expect(
      shouldShowRootStartupLoading({
        isDesktop: true,
        isResolvingStartupAuthState: false,
        isResolvingProviderStartupState: false,
        isRestoring: false,
        isBootstrappingInitialWorkspace: false,
      }),
    ).toBe(false);
  });

  it("兜底默认 workspace 返回时如果已经恢复出 active workspace，就不再抢占当前 tab", () => {
    expect(
      shouldOpenFallbackWorkspaceAfterCreate({
        isMounted: true,
        activeWorkspacePath: "/Users/dev/workspace/cgx-dev-web",
      }),
    ).toBe(false);
  });
});
