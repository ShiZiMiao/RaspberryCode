// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGlobalNoticeStore,
  type GlobalNoticeStorage,
} from "@/global-notice/globalNoticeStore.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { SidebarBottomActivity } from "@/sidebar-activity/SidebarBottomActivity.js";

// 营销触达已整体移除：本组件只剩 highspeed 全局通知槽位。
function memoryStorage(): GlobalNoticeStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function publishShareNotice(
  store: ReturnType<typeof createGlobalNoticeStore>,
  now = Date.now(),
): void {
  store.publish({
    noticeId: "notice-1",
    dedupeKey: "highspeed-share:latest",
    type: "highspeed-share",
    schemaVersion: 1,
    scope: "user",
    priority: "normal",
    interruptPolicy: "passive",
    createdAt: now,
    expiresAt: now + 100_000,
    payload: {
      cardId: "hsc-1",
      shareId: "share-1",
      shareUrl: "https://example.test/share-1",
      shareExpiresAt: now + 1_000_000,
      tokenUsage: 10,
      durationSeconds: 1,
    },
    actions: [],
    dismissPolicy: { kind: "cooldown", cooldownMs: 24 * 60 * 60_000 },
    persistencePolicy: "latest-only",
    source: "highspeed",
    revision: 1,
  });
}

type GlobalNoticeStore = ReturnType<typeof createGlobalNoticeStore>;

function renderActivity(noticeStore: GlobalNoticeStore) {
  return render(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(SidebarBottomActivity, { noticeStore }),
    ),
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("SidebarBottomActivity 活动槽位", () => {

  it("无通知 → 槽位不产生多余内容", () => {
    const noticeStore = createGlobalNoticeStore({ storage: memoryStorage() });
    const { container } = renderActivity(noticeStore);

    expect(container.querySelector('[data-global-notice-type="highspeed-share"]')).toBeNull();
  });
});
