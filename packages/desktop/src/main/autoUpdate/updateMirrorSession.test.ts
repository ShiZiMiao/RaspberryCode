import { describe, expect, it, vi } from "vitest";
import {
  installUpdateMirrorRedirect,
  UPDATER_SESSION_PARTITION,
} from "./updateMirrorSession.js";

const DOWNLOAD_URL =
  "https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.0/RaspberryCode-0.2.0-win-x64.exe";

/** 构造只记录调用的假 session，用来验证重定向行为而不依赖 Electron。 */
function createFakeSession() {
  let listener:
    | ((
        details: { url: string },
        callback: (response: { redirectURL?: string }) => void,
      ) => void)
    | null = null;
  const filters: unknown[] = [];
  return {
    filters,
    session: {
      webRequest: {
        onBeforeRequest: vi.fn((filter: unknown, next: typeof listener) => {
          filters.push(filter);
          listener = next;
        }),
      },
    },
    dispatch(url: string) {
      let result: { redirectURL?: string } = {};
      listener?.({ url }, (response) => {
        result = response;
      });
      return result;
    },
  };
}

describe("installUpdateMirrorRedirect", () => {
  it("mirror 阶段把 release 下载改写为镜像地址", () => {
    const fake = createFakeSession();
    installUpdateMirrorRedirect({
      session: fake.session as never,
      getRoute: () => "mirror",
    });

    const result = fake.dispatch(DOWNLOAD_URL);
    expect(result.redirectURL).toBe(`https://ghfast.top/${DOWNLOAD_URL}`);
  });

  it("direct 阶段不改写", () => {
    const fake = createFakeSession();
    installUpdateMirrorRedirect({
      session: fake.session as never,
      getRoute: () => "direct",
    });
    expect(fake.dispatch(DOWNLOAD_URL).redirectURL).toBeUndefined();
  });

  it("manual 阶段不改写（不再发起下载）", () => {
    const fake = createFakeSession();
    installUpdateMirrorRedirect({
      session: fake.session as never,
      getRoute: () => "manual",
    });
    expect(fake.dispatch(DOWNLOAD_URL).redirectURL).toBeUndefined();
  });

  it("非下载请求一律放行（API 元数据不受影响）", () => {
    const fake = createFakeSession();
    installUpdateMirrorRedirect({
      session: fake.session as never,
      getRoute: () => "mirror",
    });
    expect(
      fake.dispatch("https://api.github.com/repos/o/r/releases").redirectURL,
    ).toBeUndefined();
  });

  it("route 在每次请求时实时读取，不缓存首次值", () => {
    const fake = createFakeSession();
    let route: "mirror" | "direct" | "manual" = "mirror";
    installUpdateMirrorRedirect({
      session: fake.session as never,
      getRoute: () => route,
    });
    expect(fake.dispatch(DOWNLOAD_URL).redirectURL).toContain("ghfast.top");
    route = "direct";
    expect(fake.dispatch(DOWNLOAD_URL).redirectURL).toBeUndefined();
  });

  it("只监听 github.com，避免拦截无关流量", () => {
    const fake = createFakeSession();
    installUpdateMirrorRedirect({
      session: fake.session as never,
      getRoute: () => "mirror",
    });
    expect(fake.filters[0]).toEqual({ urls: ["https://github.com/*"] });
  });

  it("未提供 session 时用 resolveSession 兜底（生产走 updater partition）", () => {
    const fake = createFakeSession();
    const resolveSession = vi.fn(() => fake.session as never);
    installUpdateMirrorRedirect({ resolveSession, getRoute: () => "mirror" });

    expect(resolveSession).toHaveBeenCalledTimes(1);
    expect(fake.dispatch(DOWNLOAD_URL).redirectURL).toContain("ghfast.top");
  });

  it("既无 session 也无 resolveSession 时抛出可诊断错误", () => {
    expect(() => installUpdateMirrorRedirect({ getRoute: () => "mirror" })).toThrow(
      /requires a session or resolveSession/u,
    );
  });

  it("partition 名与 electron-updater 内部常量一致", () => {
    // 上游 electronHttpExecutor.js：NET_SESSION_NAME = "electron-updater"。
    // 改成别的值会让重定向装到下载请求根本不会经过的 session 上（v0.2.0 首测踩过）。
    expect(UPDATER_SESSION_PARTITION).toBe("electron-updater");
  });
});
