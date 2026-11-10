export interface DefaultPluginMarketplace {
  id: string;
  source: string;
  name: string;
  description: string;
  pluginCount: number;
  lastUpdated?: string;
}

export const RASPBERRYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID = "raspberrycode-plugins-official";

/**
 * Claude Code 官方市场（GitHub git 源）。它不是 RaspberryCode 的强依赖：GitHub 不可达时刷新必然失败，
 * 该失败不应作为错误提示打扰用户，UI 侧按此 id 静默处理其刷新失败（任何原因）。
 */
export const CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID = "claude-plugins-official";

/** Settings 三类资源发现共用；Bootstrap 单测与官方 definition 的 defaultEnabled 机械对照。 */
export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "browser-use@raspberrycode-plugins-official",
  "image-search@raspberrycode-plugins-official",
  "documents@raspberrycode-plugins-official",
  "pdf@raspberrycode-plugins-official",
  "presentations@raspberrycode-plugins-official",
  "spreadsheets@raspberrycode-plugins-official",
  // node_repl 宿主：不进市场、不对用户露出，也不贡献任何 skill/command/subagent，但必须
  // 始终可用 —— node_repl 的注册门禁是「Browser Use 或 Computer Use 任一启用」，宿主自己
  // 不参与那个判断。Browser Use 默认开着，宿主若默认关就等于它上来就没有宿主。
  "node-repl-host@raspberrycode-plugins-official",
  "skill-creator@raspberrycode-plugins-official",
  "plugin-creator@raspberrycode-plugins-official",
  // raspberrycode-guide 移出默认启用（中立产品不默认注入使用指南插件），用户可在插件市场手动安装。
  // visualize（交互视图）随 UI 插件合入时 CLI 定义已标 defaultEnabled，但这里漏加，
  // Settings 会把它当成默认关闭，与 CLI 实际启用状态不一致。
  "visualize@raspberrycode-plugins-official",
  "raspberrycode-site@raspberrycode-plugins-official",
  // 电脑控制回退为默认关闭，故 computer-use 不在此名单内。
  // 该集合必须与 official-plugin-definitions.ts 里标了 defaultEnabled 的插件逐一对应，
  // bootstrap 的「Settings 默认启用集合与 CLI 的官方插件声明一致」单测机械对照两者。
]);

export const DEFAULT_PLUGIN_MARKETPLACES: DefaultPluginMarketplace[] = [
  {
    // RaspberryCode 官方市场：内置插件的本地 seed 分片归此 id（启动时合并，与远端源无关）。
    // 无默认远端源（vendor CDN 分发已断开）；用户可在设置里自行补充市场源。
    id: RASPBERRYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    source: "",
    name: RASPBERRYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    description: "Official RaspberryCode plugins marketplace: built-in and community plugins for RaspberryCode.",
    pluginCount: 0,
  },
  {
    id: CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    source: "anthropics/claude-plugins-official",
    name: CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    description:
      "Directory of popular Claude Code extensions including development tools, productivity plugins, and MCP integrations",
    // 只内置官方 catalog 来源，不把远端 manifest 快照打包进仓库；首次刷新前数量未知。
    pluginCount: 0,
  },
];

// 商店「公开」分段只有一个 RaspberryCode 官方市场 id，内置与 CDN 不再拆分身份。
export const PUBLIC_STORE_MARKETPLACE_IDS = [RASPBERRYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID] as const;

export function isPublicStoreMarketplaceId(id: string): boolean {
  return (PUBLIC_STORE_MARKETPLACE_IDS as readonly string[]).includes(id);
}
