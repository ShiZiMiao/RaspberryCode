import type { RaspberryCodeSessionStateSnapshot } from "@raspberrycode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { repairImportedClaudeSessionSnapshot } from "#src/session/claude-native/importedClaudeHistoryRepair.js";
import type { IRaspberryCodeAgentService } from "#src/raspberrycode-agent/raspberrycodeAgent.js";
import type {
  RaspberryCodeSessionReadParams,
  RaspberryCodeSessionResumeParams,
} from "#src/raspberrycode-session/raspberrycodeSession.js";

const logger = createServiceLogger("raspberrycode-session-service");

export async function repairEmptyImportedClaudeSessionSnapshot(params: {
  agentService: IRaspberryCodeAgentService;
  snapshot: RaspberryCodeSessionStateSnapshot;
  target: RaspberryCodeSessionResumeParams | RaspberryCodeSessionReadParams;
}): Promise<RaspberryCodeSessionStateSnapshot> {
  const repaired = await repairImportedClaudeSessionSnapshot({
    snapshot: params.snapshot,
    target: {
      workspacePath: params.target.workspacePath,
      workspaceIdentity: params.target.workspaceIdentity,
      taskId: params.target.sessionId,
      ...("mcpServers" in params.target && params.target.mcpServers
        ? { mcpServers: params.target.mcpServers }
        : {}),
    },
    createSession: (input) => params.agentService.createSession(input),
    onRepair: (history) => {
      logger.warn(
        undefined,
        `[raspberrycode-session-service] Claude 导入 session 历史异常，按 ${history.source} 回填 taskId=${params.target.sessionId}`,
      );
    },
  });
  return repaired ?? params.snapshot;
}
