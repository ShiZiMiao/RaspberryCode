import { describe, expect, it } from "vitest";

import {
  shouldReuseDesktopE2EBuild,
  CODING_PLAN_TEAM_MOCK_BASE_URL_ENV,
  applyCodingPlanTeamMockEnv,
  clearCodingPlanTeamMockEnv,
  shouldPrepareCodingPlanTeamMock,
  isOffPeakTeamPlanSpec,
  applyZaiBusinessTeamMockEnv,
} from "./e2e/helpers/coding-plan-mock-env.js";

describe("Coding Plan E2E mock env", () => {
  it("跳过构建开关允许复用父构建；历史动态端口源已随升级购买场景移除", () => {
    expect(shouldReuseDesktopE2EBuild({})).toBe(false);
    expect(shouldReuseDesktopE2EBuild({ RASPBERRYCODE_E2E_SKIP_BUILD: "1" })).toBe(true);
    expect(shouldReuseDesktopE2EBuild({ RASPBERRYCODE_E2E_SKIP_BUILD: "0" })).toBe(false);
  });
  it.each([
    "settings/general/settings-ui-polish.test.ts",
    "settings/general/settings-ui-polish-ssh.test.ts",
    "ui-shell/panels/side-pane-tabs-responsive-interactions.test.ts",
    "conversation-session/plugins/manual-review/pending/conversation-session-mcp-async-startup-wait.test.ts",
  ])("所选回归用例隔离模拟账号控制面：%s", (spec) => {
    expect(shouldPrepareCodingPlanTeamMock([`./test/e2e/${spec}`])).toBe(true);
  });
  it("定时任务创建遥测回归隔离账号控制面", () => {
    expect(
      shouldPrepareCodingPlanTeamMock([
        "./test/e2e/conversation-session/automations/conversation-session-automation-run-title-stable.test.ts",
      ]),
    ).toBe(true);
  });
  it.each([
    "./test/e2e/conversation-session/*.test.ts",
    "test/e2e/conversation-session/*.test.ts",
    ".\\test\\e2e\\conversation-session\\*.test.ts",
    "test\\e2e\\conversation-session\\*.test.ts",
    "./test/e2e/**/*.test.ts",
    "test/e2e/**/*.test.ts",
    ".\\test\\e2e\\**\\*.test.ts",
    "./test/e2e/conversation-session/queue/**/*.test.ts",
    "./test/e2e/settings/providers/*.test.ts",
    ".\\test\\e2e\\automations\\off-peak\\*.test.ts",
  ])("prepares the mock before workers expand the suite glob %s", (spec) => {
    expect(shouldPrepareCodingPlanTeamMock([spec])).toBe(true);
  });

  it("prepares the mock for the formal CI suite without opting unrelated workers in", () => {
    const unrelatedSpecs = [
      "./test/e2e/plugins/*.test.ts",
      "./test/e2e/workspace/files/workspace-file-tree-refresh.test.ts",
      "./test/e2e/conversation-session/background/conversation-session-background.test.ts",
    ];
    expect(
      shouldPrepareCodingPlanTeamMock([
        "./test/e2e/conversation-session/*.test.ts",
        ...unrelatedSpecs,
      ]),
    ).toBe(true);
    expect(shouldPrepareCodingPlanTeamMock(unrelatedSpecs)).toBe(false);
    expect(shouldPrepareCodingPlanTeamMock([])).toBe(false);
  });

  it.each([".test.ts", "-cli.test.ts", "-tui.test.ts", "*.test.ts"])(
    "keeps ToolSearch targeted entry %s enabled",
    (suffix) => {
      expect(
        shouldPrepareCodingPlanTeamMock([
          `./test/e2e/conversation-session/conversation-session-toolsearch${suffix}`,
        ]),
      ).toBe(true);
    },
  );

  it.each([
    "conversation-session-rpn-project-navigation.test.ts",
    "conversation-session-ssh-disconnect-experience.test.ts",
    "conversation-session-ssh-remote-cold-reconnect.test.ts",
    "conversation-session-r3-mixed-entries.test.ts",
    "conversation-session-r3-mobile.test.ts",
    "conversation-session-create-telemetry.test.ts",
  ])("prepares account facts for %s", (spec) => {
    expect(
      shouldPrepareCodingPlanTeamMock([
        `./test/e2e/conversation-session/manual-review/pending/${spec}`,
      ]),
    ).toBe(true);
  });
  it("prepares account APIs for the formal real-app provider responsive case", () => {
    expect(
      shouldPrepareCodingPlanTeamMock([
        "./test/e2e/settings/providers/provider-family-responsive.test.ts",
      ]),
    ).toBe(true);
  });
  it("prepares the team mock for targeted login and provider transition cases", () => {
    expect(
      shouldPrepareCodingPlanTeamMock([
        "./test/e2e/subagents/subagent-coding-plan-login-catalog-stale.test.ts",
      ]),
    ).toBe(true);
    expect(
      shouldPrepareCodingPlanTeamMock([
        "./test/e2e/conversation-session/models/conversation-session-model-provider-settings-transition.test.ts",
      ]),
    ).toBe(true);
    expect(
      shouldPrepareCodingPlanTeamMock([
        "./test/e2e/conversation-session/automations/conversation-session-off-peak-team-plan.test.ts",
      ]),
    ).toBe(true);
  });
});
