/**
 * workspace prepare 的协议 RPC 收口。
 *
 * 拆出原因：useWorkspacePrepare.ts 只保留可单测的轻量判定入口；
 * 这里只读取 workspace presentation（mode/slash commands）；模型选择事实由目标 Host View 提供。
 */
import type { IRaspberryCodeSessionService } from "@raspberrycode/services";
import { type RaspberryCodeProvider, type RaspberryCodeWorkspacePrepareResult } from "@raspberrycode/shared";
import { getChatErrorMessage } from "@/lib/chatPrepareError.js";
import { logger } from "@/logger.js";
import { raspberrycodeWorkspacePresentationToConfigOptions } from "@/lib/raspberrycodeSessionProjection.js";

export async function prepareWorkspaceWithRaspberryCodeSessionService(params: {
  workspacePath: string;
  workspaceIdentity?: string;
  provider: RaspberryCodeProvider;
  raspberrycodeSessionService: Pick<IRaspberryCodeSessionService, "readWorkspacePresentation">;
}): Promise<RaspberryCodeWorkspacePrepareResult> {
  const startedAt = Date.now();
  logger.info("[raspberrycode-workspace-presentation] workspace prepare start", {
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity ?? null,
    provider: params.provider,
  });

  let presentation: Awaited<ReturnType<IRaspberryCodeSessionService["readWorkspacePresentation"]>>;
  try {
    presentation = await params.raspberrycodeSessionService.readWorkspacePresentation({
      workspacePath: params.workspacePath,
      workspaceIdentity: params.workspaceIdentity,
    });
  } catch (error) {
    logger.warn("[raspberrycode-workspace-presentation] readWorkspacePresentation failed", {
      workspacePath: params.workspacePath,
      workspaceIdentity: params.workspaceIdentity ?? null,
      provider: params.provider,
      durationMs: Date.now() - startedAt,
      error: getChatErrorMessage(error),
    });
    throw error;
  }

  const readPresentationDurationMs = Date.now() - startedAt;
  const configOptions = raspberrycodeWorkspacePresentationToConfigOptions(presentation.mode);
  const totalDurationMs = Date.now() - startedAt;
  logger.info("[raspberrycode-workspace-presentation] readWorkspacePresentation done", {
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity ?? null,
    provider: params.provider,
    readPresentationDurationMs,
    totalDurationMs,
    configOptionsCount: configOptions.length,
    modeCurrent: presentation.mode,
  });

  return {
    workspacePath: params.workspacePath,
    preparedSessionId: "",
    version: "RaspberryCode Protocol/1",
    provider: params.provider,
    configOptions,
    slashCommands: presentation.slashCommands,
  };
}
