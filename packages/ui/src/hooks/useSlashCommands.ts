/**
 * RaspberryCode Agent Slash Commands 便捷 hook
 *
 * 返回当前 workspace 下 Agent 广播的可用 slash commands 列表。
 */
import { useRaspberryCodeSessionStore, selectWorkspaceRaspberryCodeState } from "../store/raspberrycodeSessionStore.js";

export function useSlashCommands(workspacePath: string, workspaceIdentity?: string) {
  return useRaspberryCodeSessionStore(
    (state) => selectWorkspaceRaspberryCodeState(state, workspacePath, workspaceIdentity).slashCommands,
  );
}
