const RASPBERRYCODE_PROCESS_PREFIX = "raspberrycode";
const MAX_PROCESS_NAME_SEGMENT_LENGTH = 24;

function sanitizeProcessNameSegment(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_PROCESS_NAME_SEGMENT_LENGTH);
}

function joinRaspberryCodeProcessName(...segments: Array<string | null | undefined>): string {
  const sanitizedSegments = segments
    .map((segment) => sanitizeProcessNameSegment(segment))
    .filter((segment): segment is string => Boolean(segment));
  return [RASPBERRYCODE_PROCESS_PREFIX, ...sanitizedSegments].join("-");
}

function pickWorkspaceTag(workspacePath: string | null | undefined): string | undefined {
  const trimmedPath = workspacePath?.trim();
  if (!trimmedPath) {
    return undefined;
  }

  const parts = trimmedPath.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? trimmedPath;
}

export function formatRaspberryCodeMainProcessName(): string {
  return joinRaspberryCodeProcessName("main");
}

export function formatRaspberryCodeGpuProcessName(): string {
  return joinRaspberryCodeProcessName("gpu");
}

export function formatRaspberryCodeHostProcessName(label?: string): string {
  return joinRaspberryCodeProcessName("host", label);
}

export function formatRaspberryCodeRendererProcessName(windowTitle?: string): string {
  const normalizedTitle = windowTitle?.trim();
  // Modified for RaspberryCode: 窗口标题基准名随产品名同步改名，与 desktopRuntimeEnv 的标题保持一致。
  if (!normalizedTitle || normalizedTitle === "RaspberryCode") {
    return joinRaspberryCodeProcessName("renderer", "main");
  }

  if (normalizedTitle === "Resource Manager") {
    return joinRaspberryCodeProcessName("renderer", "resource-manager");
  }

  const remoteWindowPrefix = "RaspberryCode - ";
  if (normalizedTitle.startsWith(remoteWindowPrefix)) {
    return joinRaspberryCodeProcessName(
      "renderer",
      "remote",
      normalizedTitle.slice(remoteWindowPrefix.length),
    );
  }

  return joinRaspberryCodeProcessName("renderer", normalizedTitle);
}

export function formatRaspberryCodeAgentProcessName(provider: string, workspacePath?: string): string {
  return joinRaspberryCodeProcessName("agent", provider, pickWorkspaceTag(workspacePath));
}

export function formatRaspberryCodeUtilityProcessName(name?: string, type = "utility"): string {
  return joinRaspberryCodeProcessName(type, name);
}
