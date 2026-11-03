import type { TuiReadClipboardImage, TuiWriteClipboardText } from "@raspberrycode/tui";
import type { UiLocale } from "@raspberrycode/i18n";
import type { Logger } from "@raspberrycode/contracts";
import type {
  createManagedCdpBrowserRuntime,
  ManagedCdpBrowserRuntimeOptions,
} from "@raspberrycode/adapters/browser";
import type {
  createDefaultProviderEndpointRoutingPort,
  createModelAdapter,
  createRaspberryCodeApp,
  CreateDefaultProviderEndpointRoutingPortOptions,
  CreateModelAdapterOptions,
  inspectRaspberryCodeSkill,
  inspectWorkspaceHookTrust,
  grantWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
  inspectRaspberryCodeCustomCommand,
  InspectRaspberryCodeCustomCommandOptions,
  InspectRaspberryCodeSkillOptions,
  listRaspberryCodeCustomCommands,
  ListRaspberryCodeCustomCommandsOptions,
  loadRaspberryCodeCustomCommand,
  listRaspberryCodeSessions,
  listRaspberryCodeSkills,
  ListRaspberryCodeSessionsOptions,
  ListRaspberryCodeSkillsOptions,
  resolveLatestSession,
  ResolveLatestSessionOptions,
  RunRaspberryCodeProtocolAgentOptions,
  prepareRaspberryCodeTelemetryEnv,
  startProcessProviderRegistryRuntime,
  shutdownRaspberryCodeTelemetry,
  RaspberryCodeAppOptions,
} from "@raspberrycode/bootstrap";
import type { CliEnv, DotenvLoadResult, LoadCliDotenvOptions } from "./env.js";
import type { PluginsCommandOverrides } from "./plugins-command.js";
import type { CliShutdownProcess } from "./shutdown.js";
import type { resolveWorkspaceGitBranch } from "./tui-workspace-git.js";

export type BootstrapModule = typeof import("@raspberrycode/bootstrap");

export interface RunDependencies extends PluginsCommandOverrides {
  migrateStorage?: () => Promise<import("@raspberrycode/shared/sqlite-migrations").MigrationResult>;
  protocolLifecycle?: RunRaspberryCodeProtocolAgentOptions["lifecycle"];
  protocolInput?: NodeJS.ReadableStream;
  createManagedCdpBrowserRuntime?: (
    options?: ManagedCdpBrowserRuntimeOptions,
  ) => ReturnType<typeof createManagedCdpBrowserRuntime>;
  createModelAdapter?: (
    options?: CreateModelAdapterOptions,
  ) => ReturnType<typeof createModelAdapter>;
  createProviderEndpointRoutingPort?: (
    options: CreateDefaultProviderEndpointRoutingPortOptions,
  ) => ReturnType<typeof createDefaultProviderEndpointRoutingPort>;
  createRaspberryCodeApp?: (
    options?: RaspberryCodeAppOptions,
  ) => Awaited<ReturnType<typeof createRaspberryCodeApp>> | ReturnType<typeof createRaspberryCodeApp>;
  /**
   * Session-event shaper for --output-format stream-json. Defaults to the
   * bootstrap module's, which is also what the protocol server uses; injectable
   * so a caller that supplies its own `createRaspberryCodeApp` (tests, embedders) can
   * still stream, since the bootstrap module is not loaded on that path.
   */
  mapSessionEvent?: BootstrapModule["mapSessionEvent"];
  cwd?: () => string;
  env?: CliEnv;
  inspectSkill?: (options: InspectRaspberryCodeSkillOptions) => ReturnType<typeof inspectRaspberryCodeSkill>;
  inspectWorkspaceHookTrust?: typeof inspectWorkspaceHookTrust;
  grantWorkspaceHookTrust?: typeof grantWorkspaceHookTrust;
  revokeWorkspaceHookTrustCli?: typeof revokeWorkspaceHookTrustCli;
  inspectCustomCommand?: (
    options: InspectRaspberryCodeCustomCommandOptions,
  ) => ReturnType<typeof inspectRaspberryCodeCustomCommand>;
  loadDotenv?: (options?: LoadCliDotenvOptions) => DotenvLoadResult;
  prepareRaspberryCodeTelemetryEnv?: typeof prepareRaspberryCodeTelemetryEnv;
  projectConfigPath?: string;
  listSessions?: (options: ListRaspberryCodeSessionsOptions) => ReturnType<typeof listRaspberryCodeSessions>;
  listCustomCommands?: (
    options: ListRaspberryCodeCustomCommandsOptions,
  ) => ReturnType<typeof listRaspberryCodeCustomCommands>;
  loadCustomCommand?: (
    options: InspectRaspberryCodeCustomCommandOptions,
  ) => ReturnType<typeof loadRaspberryCodeCustomCommand>;
  // headless slash 路由要和 app facade 的保留名 gate 用同一个判据；默认取 bootstrap 的，
  // 注入点只为让单测不必拉起整个 bootstrap 模块。见 prompt-command.ts。
  isReservedSlashCommandName?: BootstrapModule["isReservedRaspberryCodeSlashCommandName"];
  listSkills?: (options: ListRaspberryCodeSkillsOptions) => ReturnType<typeof listRaspberryCodeSkills>;
  logger?: Logger;
  readClipboardImage?: TuiReadClipboardImage;
  writeClipboardText?: TuiWriteClipboardText;
  resolveLatestSession?: (
    options: ResolveLatestSessionOptions,
  ) => ReturnType<typeof resolveLatestSession>;
  resolveWorkspaceGitBranch?: typeof resolveWorkspaceGitBranch;
  runRaspberryCodeProtocolAgent?: (options?: RunRaspberryCodeProtocolAgentOptions) => Promise<void>;
  runTui?: typeof import("@raspberrycode/tui").runTui;
  skipUserConfig?: boolean;
  userConfigPath?: string;
  exitProcess?: (code: number) => void;
  shutdownCleanupTimeoutMs?: number;
  shutdownProcess?: CliShutdownProcess;
  startProcessProviderRegistryRuntime?: typeof startProcessProviderRegistryRuntime;
  shutdownRaspberryCodeTelemetry?: typeof shutdownRaspberryCodeTelemetry;
}

export type CliPermissionMode = "build" | "plan" | "edit" | "yolo" | "guarded";
export type CliRuntimeMode = CliPermissionMode | "auto";

export interface CliModeState {
  current?: CliRuntimeMode;
  override?: CliPermissionMode;
}

export interface CliTargetRequest {
  objective: string;
  replaceExisting: boolean;
}

export type ModeCapableApp = Awaited<ReturnType<typeof createRaspberryCodeApp>> & {
  getMode?: () => CliRuntimeMode;
  setLocale?: (locale: UiLocale) => Promise<{ locale: "en-US" | "zh-CN" }>;
  setMode?: (mode: CliRuntimeMode) => Promise<{ mode: CliRuntimeMode }>;
};

export interface CliResumeRequest {
  continueSession: boolean;
  resumeSessionId?: string;
}
