import type { RaspberryCodeProvider } from "@raspberrycode/shared";

export const RASPBERRYCODE_MODE_OPTION_LABEL_IDS: Record<RaspberryCodeProvider, Record<string, string>> = {
  agent: {
    default: "mode.label.agent.default",
    build: "mode.label.agent.build",
    edit: "mode.label.agent.edit",
    plan: "mode.label.agent.plan",
    yolo: "mode.label.agent.yolo",
    guarded: "mode.label.agent.guarded",
  },
};

export const RASPBERRYCODE_MODE_OPTION_DESCRIPTION_IDS: Record<RaspberryCodeProvider, Record<string, string>> = {
  agent: {
    default: "mode.description.agent.default",
    build: "mode.description.agent.build",
    edit: "mode.description.agent.edit",
    plan: "mode.description.agent.plan",
    yolo: "mode.description.agent.yolo",
    guarded: "mode.description.agent.guarded",
  },
};
