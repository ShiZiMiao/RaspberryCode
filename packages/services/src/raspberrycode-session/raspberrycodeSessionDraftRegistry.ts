import type { RaspberryCodeSessionStateSnapshot } from "@raspberrycode/shared";
import type {
  RaspberryCodeSessionWorkspaceTarget,
  RaspberryCodeTaskTarget,
} from "#src/raspberrycode-session/raspberrycodeSession.js";

function getWorkspaceKey(target: RaspberryCodeSessionWorkspaceTarget): string {
  return target.workspaceIdentity?.trim() || target.workspacePath;
}

function getSessionScopedKey(target: RaspberryCodeTaskTarget): string {
  return `${getWorkspaceKey(target)}\0${target.sessionId}`;
}

export function createRaspberryCodeDeferredDraftRegistry() {
  const sessionKeys = new Set<string>();

  return {
    remember(params: RaspberryCodeSessionWorkspaceTarget, snapshot: RaspberryCodeSessionStateSnapshot): void {
      sessionKeys.add(
        getSessionScopedKey({
          workspacePath: snapshot.session.workspace.workspacePath,
          workspaceIdentity:
            snapshot.session.workspace.workspaceIdentity ?? params.workspaceIdentity,
          sessionId: snapshot.session.sessionId,
        }),
      );
    },

    has(target: RaspberryCodeTaskTarget): boolean {
      return sessionKeys.has(getSessionScopedKey(target));
    },

    forget(target: RaspberryCodeTaskTarget): void {
      sessionKeys.delete(getSessionScopedKey(target));
    },
  };
}
