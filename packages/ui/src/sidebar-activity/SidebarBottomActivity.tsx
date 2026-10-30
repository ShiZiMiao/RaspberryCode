import { GlobalNoticeSurface } from "@/global-notice/GlobalNoticeSurface.js";
import type { GlobalNoticeStore } from "@/global-notice/globalNoticeStore.js";

/**
 * 左下角活动共享槽位。营销触达已整体移除（specs/no-login-startup.md 后续裁剪），
 * 未注入 store 时走 GlobalNoticeSurface 默认的 browserGlobalNoticeStore，
 * 无可展示内容时返回 null，不产生多余 DOM。
 */
export function SidebarBottomActivity({
  noticeStore,
}: {
  noticeStore?: GlobalNoticeStore | null;
} = {}) {
  return <GlobalNoticeSurface store={noticeStore ?? undefined} />;
}
