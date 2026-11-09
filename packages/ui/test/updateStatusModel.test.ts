/**
 * 更新弹窗视图模型单测（spec：specs/client-github-self-update.md 验收 1-2）。
 * 覆盖：阶段推导、版本显示兜底、进度文案/数值、跳过版本面、动作收口判定。
 */
import { describe, expect, it } from "vitest";
import {
  deriveUpdateStatusViewModel,
  isUpdateActionCompleted,
} from "../src/client-update/contract.js";
import type { UpdateStatePayload } from "@raspberrycode/shared";

const releaseNotes = {
  version: "2.0.0",
  title: "v2.0.0",
  markdown: "notes",
  releaseDate: "2026-11-01T00:00:00.000Z",
};

describe("deriveUpdateStatusViewModel", () => {
  it("update-downloaded → downloaded 阶段并显示版本", () => {
    const model = deriveUpdateStatusViewModel({
      legacyReadyVersion: null,
      updateState: { kind: "update-downloaded", enabled: true, version: "2.0.0", releaseNotes },
    });
    expect(model.dialogPhase).toBe("downloaded");
    expect(model.displayVersion).toBe("2.0.0");
    expect(model.skippableVersion).toBeNull();
  });

  it("download-progress 缺版本号时用占位符撑住 UI，不卸载弹窗", () => {
    const model = deriveUpdateStatusViewModel({
      legacyReadyVersion: null,
      updateState: {
        kind: "download-progress",
        enabled: true,
        progress: 42,
      },
    });
    expect(model.dialogPhase).toBe("downloading");
    expect(model.displayVersion).toBe("…");
  });

  it("update-available → before-download 并暴露可跳过版本", () => {
    const model = deriveUpdateStatusViewModel({
      legacyReadyVersion: null,
      updateState: { kind: "update-available", enabled: true, version: "2.0.0", releaseNotes },
    });
    expect(model.dialogPhase).toBe("before-download");
    expect(model.displayVersion).toBe("2.0.0");
    expect(model.skippableVersion).toBe("2.0.0");
    expect(model.releaseNotesPayload).toEqual(releaseNotes);
  });

  it("进度：大小文案优先，百分比裁剪到 0-100", () => {
    const model = deriveUpdateStatusViewModel({
      legacyReadyVersion: null,
      updateState: {
        kind: "download-progress",
        enabled: true,
        progress: 120,
        version: "2.0.0",
        transferredBytes: 10 * 1024 * 1024,
        totalBytes: 100 * 1024 * 1024,
      },
    });
    expect(model.progressValue).toBe(100);
    expect(model.progressLabel).toBe("10.0MB / 100.0MB");

    const percentOnly = deriveUpdateStatusViewModel({
      legacyReadyVersion: null,
      updateState: { kind: "download-progress", enabled: true, progress: -5, version: "2.0.0" },
    });
    expect(percentOnly.progressValue).toBe(0);
    expect(percentOnly.progressLabel).toBeNull();
  });

  it("legacy ready 缓存只在 updateState 缺席时生效", () => {
    expect(
      deriveUpdateStatusViewModel({
        legacyReadyVersion: "2.0.0",
        updateState: { kind: "idle", enabled: true },
      }).displayVersion,
    ).toBeNull();
    expect(
      deriveUpdateStatusViewModel({ legacyReadyVersion: "2.0.0", updateState: null }).displayVersion,
    ).toBe("2.0.0");
  });
});

describe("isUpdateActionCompleted", () => {
  it("download 需进入进度/完成才收口，checking/idle 过渡态不收口", () => {
    const checking: UpdateStatePayload = { kind: "checking", enabled: true };
    expect(isUpdateActionCompleted("download", checking)).toBe(false);
    expect(
      isUpdateActionCompleted("download", {
        kind: "download-progress",
        enabled: true,
        progress: 1,
      }),
    ).toBe(true);
    expect(
      isUpdateActionCompleted("download", { kind: "update-downloaded", enabled: true, version: "x" }),
    ).toBe(true);
  });

  it("cancel 离开下载态即收口；skip 离开 available/下载态即收口", () => {
    expect(
      isUpdateActionCompleted("cancel", {
        kind: "download-progress",
        enabled: true,
        progress: 1,
      }),
    ).toBe(false);
    expect(isUpdateActionCompleted("cancel", { kind: "idle", enabled: true })).toBe(true);
    expect(
      isUpdateActionCompleted("skip", { kind: "update-available", enabled: true, version: "x" }),
    ).toBe(false);
    expect(isUpdateActionCompleted("skip", { kind: "idle", enabled: true })).toBe(true);
  });
});
