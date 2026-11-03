import {
  RASPBERRYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
  type RaspberryCodePluginsResolveSuggestedReferenceResult,
} from "@raspberrycode/shared";

export interface DraftSuggestedPluginFlow {
  anchorItemId: string;
  operationId: string;
  plugin: { stableId: string; label: string };
  result?: RaspberryCodePluginsResolveSuggestedReferenceResult;
  stage: "checking" | "missing" | "disabled" | "unavailable";
}

export interface DraftSuggestedPluginOperation {
  operationId: string;
  abort: AbortController;
  pending?: Promise<unknown>;
  cancellation?: Promise<void>;
}

export interface ConversationDraftSuggestedPromptsContainerProps {
  className?: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  isDesktop?: boolean;
  isMobileOverlay?: boolean;
}

export async function trackDraftSuggestedPluginOperation<T>(
  operation: DraftSuggestedPluginOperation,
  pending: Promise<T>,
): Promise<T> {
  operation.pending = pending;
  try {
    return await pending;
  } finally {
    if (operation.pending === pending) delete operation.pending;
  }
}

export function resolveDraftSuggestedPluginFlowStage(
  result: RaspberryCodePluginsResolveSuggestedReferenceResult,
): DraftSuggestedPluginFlow["stage"] {
  const { status } = result;
  if (
    (status === "ready" || status === "disabled" || status === "missing") &&
    (result.marketplace !== RASPBERRYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID ||
      result.sourceTrust !== "official" ||
      !result.pluginName)
  ) {
    return "unavailable";
  }
  if (status === "missing" || status === "disabled") return status;
  return status === "ready" ? "checking" : "unavailable";
}

export function resolveSuggestedPluginClientBoundary(isMobileOverlay: boolean) {
  const profile = isMobileOverlay
    ? ("web-remote-replayable" as const)
    : ("desktop-continuous" as const);
  return { clientMode: profile, deliveryKind: profile };
}
