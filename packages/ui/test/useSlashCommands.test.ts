import { describe, expect, it, beforeEach } from "vitest";
import { selectWorkspaceRaspberryCodeState, useRaspberryCodeSessionStore } from "../src/store/raspberrycodeSessionStore.js";

describe("useSlashCommands", () => {
  beforeEach(() => {
    useRaspberryCodeSessionStore.setState((state) => ({
      ...state,
      workspaces: {},
    }));
  });

  it("remote workspace 会按 workspaceIdentity 读取 slash commands", () => {
    const workspacePath = "/root";
    const workspaceIdentity = "remote:ssh:demo:22:root:/root";
    useRaspberryCodeSessionStore.getState().setSlashCommands(
      workspacePath,
      [{ name: "remote-command", description: "remote command" }],
      workspaceIdentity,
    );

    const identityCommands = selectWorkspaceRaspberryCodeState(
      useRaspberryCodeSessionStore.getState(),
      workspacePath,
      workspaceIdentity,
    ).slashCommands;
    const pathOnlyCommands = selectWorkspaceRaspberryCodeState(useRaspberryCodeSessionStore.getState(), workspacePath).slashCommands;

    expect(identityCommands.map((command) => command.name)).toEqual(["remote-command"]);
    expect(pathOnlyCommands).toEqual([]);
  });
});
