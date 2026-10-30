interface RootStartupGateState {
  isResolvingStartupAuthState: boolean;
  isResolvingProviderStartupState: boolean;
  isRestoring: boolean;
  isBootstrappingInitialWorkspace: boolean;
}

interface RootStartupLoadingVisibilityState extends RootStartupGateState {
  isDesktop: boolean | undefined;
}

interface FallbackWorkspaceCreateState {
  isMounted: boolean;
  activeWorkspacePath: string | null;
}

interface ProviderStartupSyncState {
  providerFamilyDomainMigrationComplete: boolean;
  modelSelectionViewHydrated: boolean;
}

interface ProviderStartupResolutionState {
  providerStartupSyncPending: boolean;
}

export function shouldBlockRootRender(state: RootStartupGateState): boolean {
  return (
    state.isResolvingStartupAuthState ||
    state.isResolvingProviderStartupState ||
    state.isRestoring ||
    state.isBootstrappingInitialWorkspace
  );
}

export function shouldShowRootStartupLoading(
  state: RootStartupLoadingVisibilityState,
): boolean {
  // 登录入口已整体移除（specs/no-login-startup.md）：启动 loading 只反映
  // 与登录无关的就绪等待（provider 快照、workspace 恢复、初始 workspace 注入）。
  return Boolean(state.isDesktop) && shouldBlockRootRender(state);
}

export function shouldResolveProviderStartupState(
  state: ProviderStartupResolutionState,
): boolean {
  return state.providerStartupSyncPending;
}

export function shouldOpenFallbackWorkspaceAfterCreate(
  state: FallbackWorkspaceCreateState,
): boolean {
  return state.isMounted && !state.activeWorkspacePath;
}

export function isProviderStartupSyncPending(
  state: ProviderStartupSyncState,
): boolean {
  return (
    !state.providerFamilyDomainMigrationComplete ||
    !state.modelSelectionViewHydrated
  );
}
