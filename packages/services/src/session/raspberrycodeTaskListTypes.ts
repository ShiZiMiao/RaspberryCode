import type { WorkspacePurpose, RaspberryCodeTaskMeta } from "@raspberrycode/shared";

export type RaspberryCodeTaskListKind = "pinned" | "archived" | "timeline" | "active";
export type RaspberryCodeTaskListSortBy = "created" | "updated";

export interface RaspberryCodeTaskListWorkspaceScope {
  workspacePath: string;
  workspaceIdentity?: string;
  workspacePurpose?: WorkspacePurpose;
}

export interface RaspberryCodeTaskListQuery {
  /** "all" 表示不按 membership 过滤（全局搜索结果用）。 */
  kind: RaspberryCodeTaskListKind | "all";
  /** "host" 由存储 owner 确定全部范围，不接受 UI 已打开工作区作为历史目录。 */
  workspaceScopes: RaspberryCodeTaskListWorkspaceScope[] | "host";
  sortBy: RaspberryCodeTaskListSortBy;
  search?: string;
  limit?: number;
}

export type RaspberryCodeTaskListItem = RaspberryCodeTaskMeta & {
  searchSnippet?: string;
  searchSnippets?: string[];
};

export interface RaspberryCodeTaskListResult {
  items: RaspberryCodeTaskListItem[];
  total: number;
  hasMore: boolean;
}

export interface RaspberryCodeWorkspaceEventSubscriptionParams {
  workspacePath: string;
  workspaceIdentity?: string;
}
