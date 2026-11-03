import type { WorkspacePurpose, RaspberryCodeTaskMeta } from "@raspberrycode/shared";

export type RaspberryCodeTaskListKind = "pinned" | "archived" | "timeline" | "active";
export type RaspberryCodeTaskListSortBy = "created" | "updated";

export interface RaspberryCodeTaskListWorkspaceScope {
  workspacePath: string;
  workspaceIdentity?: string;
  workspacePurpose?: WorkspacePurpose;
}

export interface RaspberryCodeTaskListQuery {
  kind: RaspberryCodeTaskListKind;
  workspaceScopes: RaspberryCodeTaskListWorkspaceScope[];
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
