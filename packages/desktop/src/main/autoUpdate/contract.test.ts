import { describe, expect, it, vi } from "vitest";
import { clientUpdateRuntimeModule } from "./module.js";
import { resolveGithubFeedOptions } from "./index.js";

describe("client-update-runtime contract", () => {
  it("模块清单与公共入口一致（manifest-policy-mismatch 前置自检）", () => {
    expect(clientUpdateRuntimeModule.id).toBe("client-update-runtime");
    expect(clientUpdateRuntimeModule.publicEntrypoints).toEqual(["index.ts", "contract.ts"]);
    expect(clientUpdateRuntimeModule.requires).toEqual(["desktop", "shared"]);
  });

  it("feed 解析经公共入口可用", () => {
    expect(resolveGithubFeedOptions("", "").owner).toBe("ShiZiMiao");
    expect(typeof vi.fn).toBe("function");
  });
});
