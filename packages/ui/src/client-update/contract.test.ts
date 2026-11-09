import { describe, expect, it } from "vitest";
import { clientUpdateUiModule } from "./module.js";
import { deriveUpdateStatusViewModel } from "./contract.js";

describe("client-update-ui contract", () => {
  it("模块清单与公共入口一致（manifest-policy-mismatch 前置自检）", () => {
    expect(clientUpdateUiModule.id).toBe("client-update-ui");
    expect(clientUpdateUiModule.publicEntrypoints).toEqual(["index.ts", "contract.ts"]);
    expect(clientUpdateUiModule.requires).toEqual(["shared", "ui"]);
  });

  it("契约视图模型可推导（空状态不显示入口）", () => {
    const model = deriveUpdateStatusViewModel({
      legacyReadyVersion: null,
      updateState: { kind: "idle", enabled: true },
    });
    expect(model.displayVersion).toBeNull();
    expect(model.dialogPhase).toBe("before-download");
  });
});
