# docs/archive — 已移除功能与历史记录归档

> 本目录存放两类内容：**① 已移除功能的历史设计/测试文档**（每篇文首有归档声明）；**② 历史过程记录**（remote-r3 等）。
> 归档时间：2026-11-03（产品独立化改造收尾）。内容不反映产品现状，请以 `docs/` 现役文档与 README 为准。

## 已移除功能域索引

| 目录 / 文件 | 已移除功能 | 移除背景 |
| --- | --- | --- |
| `off-peak-task/` | 闲时任务、任务排队与票据 | 独立化改造全拆（订阅业务链路） |
| `highspeed/`、`highspeed-share-client-generated.md` | 加速卡 / 高速模式 | 同上 |
| `oauth/`、`oauth-login-failure-copy.md` | 账号登录与 OAuth 授权、JWT 会话 | 产品改为无登录 BYOK 形态 |
| `web-remote-control/`、`issues/web-remote-control-relay-v2/` | 手机远程控制（relay 配对/转发） | 分享/远控链路全拆 |
| `web-share/`、`conversation-share-v1.md` | 会话分享与公开导入 | 同上 |
| `coding-plan-purchase-*`、`coding-plan-quota-reset-*`、`coding-plan-upgrade-*`、`coding-plan-webview-bridge.md`、`sidebar-coding-plan-upgrade-entry.md` | Coding Plan 订阅购买、支付、升级、配额重置 | 订阅购买链路全拆（订阅状态查询与额度展示保留） |
| `marketing-touch-*` | 营销触达与奖励中心 | 营销链路全拆 |
| `input-model-provider-team-plan-linkage.md`、`model-provider-family-merge.md`、`start-plan-daily-quota-banner.md`、`coding-plan/zai-bigmodel-team-plan-symmetry.md` | 账号套餐体系（Team Plan / Start Plan / 账号 Provider） | 账号鉴权链全拆 |
| `testing/`（归档部分）、`monitoring/`（归档部分）、`ui/`（归档部分）、`issues/remote-e2e-stability/`（归档部分） | 上述功能对应的测试/监控/UI 设计文档 | 随功能移除归档 |

## 保留能力对照（未移除，勿混淆）

- BYOK 手动 API Key（api-key / metered-api-key）与内置供应商接口模板
- API Key 用量统计（usage-stats）与会话额度横幅
- Coding Plan **订阅状态查询**（额度横幅数据源）
- Source / SSH 远程工作区、MCP OAuth（对第三方 MCP 服务的授权）、cron 自动化、动态工作流、插件/技能体系
