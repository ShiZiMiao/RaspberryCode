import { describe, expect, it, vi } from "vitest";
import {
  installUpdateMirrorRedirect,
  UPDATER_SESSION_PARTITION,
} from "./updateMirrorSession.js";
import { DEFAULT_UPDATE_MIRROR_PREFIX } from "./updateMirror.js";

const DOWNLOAD_URL =
  "https://github.com/ShiZiMiao/RaspberryCode/releases/download/v0.2.0/RaspberryCode-0.2.0-win-x64.exe";
/** 检查阶段的元数据请求：不带 /releases/download/ 段，旧实现会漏掉它。 */
const ATOM_URL = "https://github.com/ShiZiMiao/RaspberryCode/releases.atom";
const LATEST_URL = "https://github.com/ShiZiMiao/RaspberryCode/releases/latest";

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
    expect(result.redirectURL).toBe(`${DEFAULT_UPDATE_MIRROR_PREFIX}${DOWNLOAD_URL}`);
  });

  it("检查阶段三条请求全部改写（这是修复「检查更新失败」的关键）", () => {
    const fake = createFakeSession();
    installUpdateMirrorRedirect({
      session: fake.session as never,
      getRoute: () => "mirror",
    });

    // 只改下载段的话，无代理用户会在第一条 atom 就超时，永远走不到下载。
    expect(fake.dispatch(ATOM_URL).redirectURL).toBe(`${DEFAULT_UPDATE_MIRROR_PREFIX}${ATOM_URL}`);
    expect(fake.dispatch(LATEST_URL).redirectURL).toBe(
      `${DEFAULT_UPDATE_MIRROR_PREFIX}${LATEST_URL}`,
    );
    expect(fake.dispatch(DOWNLOAD_URL).redirectURL).toBe(
      `${DEFAULT_UPDATE_MIRROR_PREFIX}${DOWNLOAD_URL}`,
    );
  });

  it("镜像前缀可动态切换（getMirrorPrefix 优先于静态值）", () => {
    const fake = createFakeSession();
    let prefix = "https://first.example/";
    installUpdateMirrorRedirect({
      session: fake.session as never,
      getRoute: () => "mirror",
      getMirrorPrefix: () => prefix,
      mirrorPrefix: "https://ignored.example/",
    });

    expect(fake.dispatch(DOWNLOAD_URL).redirectURL).toBe(`https://first.example/${DOWNLOAD_URL}`);
    // 运行期切换（模拟用户改配置）：下一次请求立即生效
    prefix = "https://second.example/";
    expect(fake.dispatch(DOWNLOAD_URL).redirectURL).toBe(`https://second.example/${DOWNLOAD_URL}`);
    // 空串表示禁用镜像 → 不改写，等价直连
    prefix = "";
    expect(fake.dispatch(DOWNLOAD_URL).redirectURL).toBeUndefined();
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
    expect(fake.dispatch(DOWNLOAD_URL).redirectURL).toContain(DEFAULT_UPDATE_MIRROR_PREFIX.trim());
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
    expect(fake.dispatch(DOWNLOAD_URL).redirectURL).toContain(DEFAULT_UPDATE_MIRROR_PREFIX.trim());
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

describe("按阶段应用代理", () => {
  it("阶段首次出现时调用一次，同一阶段内不重复调用", () => {
    const fake = createFakeSession();
    const applyProxyForRoute = vi.fn(async () => {});
    installUpdateMirrorRedirect({
      session: fake.session as never,
      getRoute: () => "mirror",
      applyProxyForRoute,
    });

    fake.dispatch(DOWNLOAD_URL);
    fake.dispatch(DOWNLOAD_URL);
    fake.dispatch(DOWNLOAD_URL);

    // 镜像阶段应只切一次：每跳都切会让 closeAllConnections 打断正在进行的下载
    expect(applyProxyForRoute).toHaveBeenCalledTimes(1);
    expect(applyProxyForRoute).toHaveBeenCalledWith("mirror");
  });

  it("阶段变化时重新应用（mirror → direct）", () => {
    const fake = createFakeSession();
    let route: "mirror" | "direct" | "manual" = "mirror";
    const applyProxyForRoute = vi.fn(async () => {});
    installUpdateMirrorRedirect({
      session: fake.session as never,
      getRoute: () => route,
      applyProxyForRoute,
    });

    fake.dispatch(DOWNLOAD_URL);
    route = "direct";
    fake.dispatch(DOWNLOAD_URL);

    expect(applyProxyForRoute).toHaveBeenCalledTimes(2);
    expect(applyProxyForRoute).toHaveBeenNthCalledWith(2, "direct");
  });

  it("未注入 applyProxyForRoute 时不报错（保持旧行为）", () => {
    const fake = createFakeSession();
    installUpdateMirrorRedirect({
      session: fake.session as never,
      getRoute: () => "mirror",
    });
    expect(() => fake.dispatch(DOWNLOAD_URL)).not.toThrow();
  });
});
