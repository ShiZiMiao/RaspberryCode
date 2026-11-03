import { describe, expect, it } from "vitest";
import {
  parseRaspberryCodeBackgroundTaskNotificationText,
  raspberrycodeBackgroundTaskNotificationToolUpdateStatus,
} from "../src/background-task-notifications.js";

describe("background task notifications", () => {
  it("preserves stopped task-notification status and normalizes killed to stopped", () => {
    expect(raspberrycodeBackgroundTaskNotificationToolUpdateStatus("stopped")).toBe("stopped");
    expect(raspberrycodeBackgroundTaskNotificationToolUpdateStatus("killed")).toBe("stopped");
  });

  it("normalizes terminal task-notification status", () => {
    expect(raspberrycodeBackgroundTaskNotificationToolUpdateStatus("completed")).toBe("completed");
    expect(raspberrycodeBackgroundTaskNotificationToolUpdateStatus("failed")).toBe("failed");
    expect(raspberrycodeBackgroundTaskNotificationToolUpdateStatus("lost")).toBe("failed");
    expect(raspberrycodeBackgroundTaskNotificationToolUpdateStatus("unexpected")).toBe("completed");
    expect(raspberrycodeBackgroundTaskNotificationToolUpdateStatus(undefined)).toBe("completed");
  });

  it("parses failed notification error and decodes XML entities exactly once", () => {
    const providerMessage = "429 & retry; literal &amp; marker";
    const summary = `Agent general-purpose task "Review" failed. ${providerMessage}`;
    const parsed = parseRaspberryCodeBackgroundTaskNotificationText(
      [
        "<task-notification>",
        "<task-id>agent_429</task-id>",
        "<tool-use-id>toolu_429</tool-use-id>",
        "<status>failed</status>",
        "<summary>Agent general-purpose task &quot;Review&quot; failed. 429 &amp; retry; literal &amp;amp; marker</summary>",
        "<error>429 &amp; retry; literal &amp;amp; marker</error>",
        "</task-notification>",
      ].join("\n"),
    );

    expect(parsed).toMatchObject({
      toolUseId: "toolu_429",
      notification: {
        taskId: "agent_429",
        status: "failed",
        summary,
        error: providerMessage,
      },
    });
  });
});
