import {
  RASPBERRYCODE_AGENT_PROVIDER,
  RASPBERRYCODE_COMMAND_AGENT_SOURCES,
  type RaspberryCodeProvider,
  type CommandAgentSource,
} from "@raspberrycode/shared";

export const COMMAND_AGENT_SOURCES = [
  ...RASPBERRYCODE_COMMAND_AGENT_SOURCES,
] as const satisfies readonly CommandAgentSource[];

export const COMMAND_AGENT_SOURCE_META: Record<
  CommandAgentSource,
  {
    labelId: string;
    provider: RaspberryCodeProvider;
    pathHint: string;
  }
> = {
  raspberrycodeAgent: {
    labelId: "settings.commands.source.raspberrycodeAgent",
    pathHint: "~/.raspberrycode/commands",
    provider: RASPBERRYCODE_AGENT_PROVIDER,
  },
};
