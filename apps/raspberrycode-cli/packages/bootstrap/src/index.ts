// Bootstrap public API surface.

export * from "./app/create-app.js";
export type {
  ListRaspberryCodeSessionsOptions,
  PromptInput,
  ResolveLatestSessionOptions,
  ResumeOptions,
  RunRaspberryCodeProtocolAgentOptions,
  SendInputOptions,
  SendInputResult,
  SetLocaleResult,
  SteerTurnOptions,
  SubmitPromptOptions,
  UserPromptInput,
  RaspberryCodeApp,
  RaspberryCodeAppOptions,
  RaspberryCodeModelOption,
} from "./app/types.js";
export {
  inspectRaspberryCodeCustomCommand,
  listRaspberryCodeCustomCommands,
  loadRaspberryCodeCustomCommand,
} from "./custom-commands.js";
export type {
  InspectRaspberryCodeCustomCommandOptions,
  ListRaspberryCodeCustomCommandsOptions,
  RaspberryCodeCustomCommandInspection,
} from "./custom-commands.js";
export { createModelAdapter } from "./model-factory.js";
export type { CreateModelAdapterOptions } from "./model-factory.js";
export {
  createDefaultProviderEndpointRoutingPort,
  resolveProcessProviderEndpointRoutingPort,
} from "./provider-endpoint-routing.js";
export type {
  CreateDefaultProviderEndpointRoutingPortOptions,
  ResolveProcessProviderEndpointRoutingPortOptions,
} from "./provider-endpoint-routing.js";
export { startProcessProviderRegistryRuntime } from "./app/process-provider-registry-runtime.js";
export type { ProcessProviderRegistryRuntimeOptions } from "./app/process-provider-registry-runtime.js";
export {
  addRaspberryCodePluginMarketplace,
  getRaspberryCodePluginsOverview,
  installRaspberryCodeMarketplacePlugin,
  listRaspberryCodePlugins,
  removeRaspberryCodePluginMarketplace,
  resolveRaspberryCodePlugins,
  setRaspberryCodePluginEnabled,
  uninstallRaspberryCodeMarketplacePlugin,
  updateRaspberryCodeMarketplacePlugin,
  updateRaspberryCodePluginMarketplace,
  validateRaspberryCodePluginPath,
} from "./plugins.js";
export type {
  AddRaspberryCodeMarketplaceOptions,
  InstallRaspberryCodeMarketplacePluginOptions,
  ListRaspberryCodePluginsOptions,
  RemoveRaspberryCodeMarketplaceOptions,
  ResolveRaspberryCodePluginsOptions,
  SetRaspberryCodePluginEnabledOptions,
  SetRaspberryCodePluginEnabledResult,
  UninstallRaspberryCodeMarketplacePluginOptions,
  UpdateRaspberryCodeMarketplaceOptions,
  UpdateRaspberryCodeMarketplacePluginOptions,
  ValidateRaspberryCodePluginPathOptions,
  RaspberryCodeAvailablePluginData,
  RaspberryCodeInstalledPluginData,
  RaspberryCodeMarketplaceSummaryData,
  RaspberryCodeMarketplaceUpdateData,
  RaspberryCodePluginInstallData,
  RaspberryCodePluginUpdateData,
  RaspberryCodePluginsOverviewData,
} from "./plugins.js";
export { runRaspberryCodeProtocolAgent } from "./raspberrycode-protocol-entrypoint.js";
// Exposed for the CLI's --output-format stream-json: it needs the same event
// shape the protocol server emits, rather than inventing a second one.
export { mapSessionEvent } from "./raspberrycode-protocol/session-mapper.js";
export { prepareRaspberryCodeTelemetryEnv, shutdownRaspberryCodeTelemetry } from "./telemetry-bootstrap.js";
export type { SessionTranscriptMessage, SessionTranscriptPart } from "./session-transcript.js";
export { listRaspberryCodeSessions, resolveLatestSession } from "./sessions.js";
export { inspectRaspberryCodeSkill, listRaspberryCodeSkills } from "./skills.js";
export type {
  InspectRaspberryCodeSkillOptions,
  ListRaspberryCodeSkillsOptions,
  RaspberryCodeSkillInspection,
} from "./skills.js";
// Exposed for the CLI's headless slash routing: it must decide "is this a real
// custom command?" with the *same* reserved-name gate the app facade's
// customCommandPromptResolver applies, or the two disagree and a reserved name
// reaches the model as literal prompt text. See prompt-command.ts.
export { isReservedRaspberryCodeSlashCommandName } from "./slash-command-surface.js";
export {
  grantWorkspaceHookTrust,
  inspectWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
} from "./workspace-hook-trust-cli.js";
export type {
  WorkspaceHookTrustCliItem,
  WorkspaceHookTrustCliStatus,
  WorkspaceHookTrustCliTarget,
} from "./workspace-hook-trust-cli.js";
