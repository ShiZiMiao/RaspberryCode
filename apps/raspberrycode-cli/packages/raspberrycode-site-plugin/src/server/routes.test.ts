import { describe, expect, it } from "vitest";
import { resourcePath } from "./routes.ts";

const SITE = "1978123456789012480";
const DEP = "1978123456789012481";

describe("resourcePath", () => {
  it.each([
    ["raspberrycode-site://usage", "/api/v1/sites/usage"],
    ["raspberrycode-site://plans", "/api/v1/sites/plans"],
    ["raspberrycode-site://sites", "/api/v1/sites"],
    ["raspberrycode-site://sites?cursor=", "/api/v1/sites"],
    ["raspberrycode-site://sites?cursor=a%2Fb&limit=20", "/api/v1/sites?cursor=a%2Fb&limit=20"],
    [`raspberrycode-site://sites/${SITE}`, `/api/v1/sites/${SITE}`],
    [
      `raspberrycode-site://sites/${SITE}/deployments?cursor=x`,
      `/api/v1/sites/${SITE}/deployments?cursor=x`,
    ],
    [`raspberrycode-site://sites/${SITE}/deployments/${DEP}`, `/api/v1/sites/${SITE}/deployments/${DEP}`],
    [`raspberrycode-site://sites/${SITE}/cover`, `/api/v1/sites/${SITE}/cover`],
    [
      `raspberrycode-site://sites/${SITE}/deployments/${DEP}/logs?offset=12`,
      `/api/v1/sites/${SITE}/deployments/${DEP}/logs?offset=12`,
    ],
  ])("maps %s", (uri, path) => {
    expect(resourcePath(uri)).toBe(path);
  });

  it.each([
    "raspberrycode-site://other",
    "https://sites/1",
    "raspberrycode-site://usage?cursor=1",
    "raspberrycode-site://plans?limit=1",
    "raspberrycode-site://plans/free",
    "raspberrycode-site://sites/abc",
    "raspberrycode-site://sites/0123",
    "raspberrycode-site://sites/1/deployments/2/logs/extra",
    "raspberrycode-site://sites/1/cover/2",
    "raspberrycode-site://sites/1/cover?offset=1",
    "raspberrycode-site://sites/1/settings",
    "raspberrycode-site://sites/1/deployments/2/logs?offset=-1",
    "raspberrycode-site://sites?limit=1e3",
    "raspberrycode-site://sites?cursor=a&cursor=b",
    "raspberrycode-site://sites/1/deployments/2?offset=1",
    "raspberrycode-site://user@sites",
    "raspberrycode-site://sites/..%2Fusage",
    "not a uri",
  ])("rejects %s", (uri) => {
    expect(resourcePath(uri)).toBeUndefined();
  });
});
