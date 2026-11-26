import { resolveWorkspaceKey } from "@raspberrycode/shared";
import type {
  ConversationWorkspaceTab,
  ConversationWorkspaceTarget,
  ConversationWorkspaceTargetParams,
} from "@/conversation-workspace-target/contract.js";

/** 解析“在项目外工作”的目标；远程项目显式关闭时固定回到本机 conversation workspace。 */
export async function resolveConversationWorkspaceTarget(
  params: ConversationWorkspaceTargetParams,
): Promise<ConversationWorkspaceTarget> {
  const activeWorkspaceKey = resolveWorkspaceKey({
    workspacePath: params.activeWorkspacePath ?? "",
    workspaceIdentity: params.activeWorkspaceIdentity ?? undefined,
  });
  // 本地 identity 为空时不能通配同路径远端 tab，否则会误触远端保护；按完整 workspaceKey 匹配。
  const activeTab = params
    .getTabs()
    .find(
      (tab): tab is ConversationWorkspaceTab =>
        tab.kind === "workspace" && resolveWorkspaceKey(tab) === activeWorkspaceKey,
    );
  // 远程项目允许通过输入框项目标签的 × 显式关闭，但目标只能是本机 conversation workspace：
  // 不能复用远端 tab 的路径，否则“关闭项目”会变成留在远程设备；远程无项目聊天仍停用。
  const isRemoteTab = Boolean(
    activeTab &&
    (activeTab.remoteTarget || activeTab.remoteSessionId || activeTab.workspaceIdentity),
  );
  if (!isRemoteTab && activeTab?.workspacePurpose === "conversation")
    return { workspacePath: activeTab.workspacePath };
  return { workspacePath: await params.resolveLocalConversationWorkspacePath() };
}
