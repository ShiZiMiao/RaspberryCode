# 0.2.3 UI 验收 —— 交接单（2026-11-16 10:15）

> **状态更新（2026-11-16 17:45）：本单列出的缺陷已全部处理完毕，本文件转为历史记录。**
>
> - 「检查更新无反馈」→ 已修，三个提交：`32570509`（失败不再误报「已是最新」+ 降级链改循环）、
>   `6aae42bf`（60s 超时兜底）、`3a522152`（诊断日志）。真机验证：点击 → 「检查中…」→
>   顶部 toast「已是最新版本 v0.2.3」；改指向不存在的 repo 后 → 「检查更新失败：404」。
> - 「`main_window_renderer` 原生崩溃」→ 判定为**遥测误报**，非产品缺陷。根因是应用退出时
>   Electron 把子进程连带终止报成 `reason: "crashed"`（而非 `killed`），被计入 `perf_crash`。
>   已修（`fb6bd8f8`）：`before-quit` 后标记 `appQuitting`，退出流程中的 renderer gone 走
>   normal 分支。**边界**：强杀（TerminateProcess）不走 `before-quit`，仍记 crash——有意保留。
> - 「MCP `image_search` 协议协商失败」→ 未处理，非本次范围。
>
> 下方「待验证清单」「本轮发现的缺陷」保留原始记录，请勿直接按它继续。

新会话接手本文件即可继续，无需回溯上文。

## 一、为什么重启会话

`agent-desktop` 的 MCP 进程原先以 headless 模式启动，物理键鼠全部被禁：

- `desktop_mouse_click` → `POLICY_DENIED: disabled in headless mode`
- `desktop_type` 对 React 受控输入框 → `POLICY_DENIED: 无可用语义动作且物理回退被禁`
- `desktop_press` → `STALE_REF: exact_window_focus_unconfirmed`
- `desktop_set_value` → 调用成功但 React 忽略，值不变

已在 `C:\Users\lecoo\.workbuddy\mcp.json` 的 `agent-desktop` 项加入 `"--headed"` 参数（该 CLI 确认支持：`--headed` = 优先物理投递、允许焦点/光标副作用）。**重启会话后该参数才生效。**

## 二、环境当前状态

| 项 | 状态 |
| --- | --- |
| 被测版本 | **0.2.3**，已安装（`%LOCALAPPDATA%\Programs\RaspberryCode`） |
| 应用进程 | 已启动，12 进程，窗口标题 `RaspberryCode` |
| 门禁 | `release-gate.mjs` exit 0 全绿（16 项 OK） |
| 产物 | `RaspberryCode-0.2.3-win-x64.exe` 180.9 MiB |
| 发布状态 | **v0.2.3 尚未发布**（远程最新是 v0.2.2） |

## 三、启动应用的唯一可靠方式（重要）

**不要**用 bash 子进程或 `Start-Process -FilePath <exe> -PassThru` 直接启动——会立刻 exit 0（纯管道 stdio 怪癖），且不写日志、不建窗口，容易误判成崩溃。

用这个：

```powershell
$exe = "$env:LOCALAPPDATA\Programs\RaspberryCode\RaspberryCode.exe"
Start-Process explorer.exe -ArgumentList "`"$exe`""
Start-Sleep -Seconds 25
```

或 agent-desktop 的 `desktop_launch`（headed 模式下应可用）。

## 四、已完成验证（真实界面截图确认过）

| 项目 | 结果 |
| --- | --- |
| 应用启动 | 12 进程、主窗口正常、从 `AppData/Local/Programs/RaspberryCode` 加载（正式安装版） |
| 工作区渲染 | 早上问候语、历史任务 3 条完整保留 |
| 设置页分组 | **16 个**全部渲染：常规/外观/模型设置/浏览器控制/远程设备/电脑控制/键盘快捷键/个性化/记忆/子智能体/插件/MCP 服务器/技能/命令/钩子/数据同步（+使用统计、项目、归档管理） |
| 常规页 | 界面语言=系统默认、界面模式=编程模式、主动任务推荐、继承终端 Profile、终端字体（留空继承）、集成终端 Shell=自动选择、工具搜索=关闭、增强 Find 和 Grep=开 |
| 外观页 | 界面主题=系统、字号 14px、代码主题 GitHub Light/GitHub Dark、显示行号=开、长行自动换行=关、代码字号 12px |
| MCP 服务器页 | 已安装 0，新建/导入按钮在；内置清单 6 项，`documents` 已连接，**`image_search` 协议协商失败（版本不兼容）** |
| 技能页 | 共 13 个，分类展示（control-browser、web-gui-tester、docx、docx-viewer、pdf-tools 等） |

## 五、待验证清单（新会话从这里继续）

### A. UI 逐项（headed 模式下应可全程用 agent-desktop）

1. **对话端到端** —— ✅ **已通过（2026-11-16 11:00）**
2. **终端** —— ✅ **已通过**：面板打开、PowerShell 可执行、命令回显正确
3. **插件市场** —— ✅ **已通过**：本地清单完整渲染
4. **文件编辑** —— ✅ **已通过**：终端写文件 → 落盘 → 内容正确 → 可删除
5. **自动化** —— ✅ **已通过**：页面渲染正常（空态）
6. **更新设置区** —— ✅ **已确认**（但「检查更新」有无反馈缺陷，见下）
7. **服务端点行** —— ✅ **已确认** `https://your-server.example`

---

## 附录：2026-11-16 11:00~13:40 实测结果（headed 模式）

### 环境前提
`agent-desktop` 需带 `--headed` 才能物理输入（配置见 `~/.workbuddy/mcp.json` 的 `args: ["mcp","--headed"]`，改后**必须重连 MCP 才生效**）。
进程参数可自查：`Get-CimInstance Win32_Process -Filter "Name='agent-desktop-win32-x64.exe'"`。

### 关键操作要点（踩过的坑）
| 现象 | 原因 | 正确做法 |
| --- | --- | --- |
| `desktop_click` 报 `Target window did not become foreground` | headed 下要求窗口前台，Windows 防抢焦点 | **`desktop_maximize` 能强制抢到前台**（已验证），之后立刻操作 |
| 「自动化」「插件市场」点击无效 | 它们是 `role=switch` 不是按钮 | 用 **`desktop_toggle`**，`click` 会静默失败 |
| 两个「返回工作区」报 `AMBIGUOUS_TARGET` | 语义层无法区分同名按钮 | 用 `desktop_mouse_click` 坐标点击（截图定位） |
| 快照只剩 3~5 节点 | **不是崩溃**，是窗口不在前台时 Chromium 裁剪 a11y 树 | 先确认/恢复前台，或看截图判断 |
| `desktop_type` 对对话输入框报 `POLICY_DENIED` | 该 React 受控组件只暴露 SetValue 且被忽略 | headed 下用物理输入即可成功 |
| 终端 a11y 是 `role=group` 不可编辑 | xterm 渲染在 canvas | 找 `Terminal input` 这个隐藏 textarea（在终端 tabpanel 内），先 `desktop_focus` 再 `desktop_type` |

### 逐项实测证据

**1. 对话端到端 ✅**
- 新建任务 → 输入「只回答两个字：恢复」→ `desktop_type` 返回 `post_state.value` 一致（`physical_synthetic`）
- 点发送 → **1 秒**回复「恢复」
- 任务标题自动生成为「只回答两个字：恢复」，左侧列表新增并高亮
- **重启应用后任务仍在**（显示“15分”），持久化正常

**2. 终端 ✅**
```
PS D:\...\draft-cdaa87ec-...> echo rcode-ok
rcode-ok
```
PowerShell、工作目录正确、输出回显正常。

**3. 插件市场 ✅**
分类页签（公开/社区/个人）、搜索框、排序、刷新。加载完成后的完整清单：
- 应用插件：Word 文档、WPS 文档、PDF、PowerPoint、Excel、RaspberryCode Sites
- 生产力：电脑控制、交互图像、浏览器操作、图像
- 开发者工具：Android 模拟器、IOC 编程
- 实用工具：插件创建器、技能创建器、RaspberryCode 安卓安装包、RaspberryCode 系统监控
- 其他：Node Repl Host
结论：**远端源断开但本地 seed 清单完整可用**，符合设计。

**4. 自动化 ✅**
- 标题「自动化 工作流」，副标题“创建定时任务，按时间自动执行操作或修改”
- 空态：“还没有定时任务” + 「创建定时任务」按钮
- “RaspberryCode 运行期间保持电脑唤醒”开关
- “定时任务模板”区，空态“暂无模板”

**5. 设置页 ✅**（18 个入口全部渲染）
常规/外观/模型设置/浏览器控制/远程设备/电脑控制/键盘快捷键 ｜ 个性化/记忆/子智能体/插件/MCP 服务器/技能/命令/钩子 ｜ 数据同步/使用统计/项目/归档管理

常规页底部实测值：
- 服务端点 `https://your-server.example`（占位正确，无 Z.ai 残留）
- 自动更新 = 已开启
- 检查更新按钮就位
- 更新源仓库 `ShiZiMiao / RaspberryCode`
- 动态工作流 = 始终开启、提问自动继续 = 开、增强 Find 和 Grep = 开
- 数据存储路径 `C:\Users\lecoo`

技能页：13 个分组（浏览器操作 2、Word文档 2、PDF 2、插件创建器 1、演示文档 2、技能创建器 1、电子表格 2、交互视图 1…）

MCP 服务器页：已安装 0；内置清单 6 项，`documents` 已连接，**`image_search` 协议协商失败（版本不兼容）**

**6. 文件编辑 ✅**
- 终端执行 `echo hello-rcode > test-acceptance.txt`
- 文件落盘：`~/.raspberrycode/workspace/draft-cdaa87ec-.../test-acceptance.txt`
- 内容为 `hello-rcode`（Read 工具确认）
- 清理 `del test-acceptance.txt` 成功

### 本轮发现的缺陷

**⚠️ 缺陷 1：「检查更新」点击后无任何反馈**
点击设置页「检查更新」后（13:30:02），日志只有 `github feed applied` + `check retry continues`，**既无 error 也无 success 记录，界面上也没有任何提示/Toast/加载态**。用户视角是“点了按钮什么都没发生”。
网络确实不通（`ERR_CONNECTION_RESET`），但产品应当给出“检查失败/网络错误”的可见反馈。
严重度：中（不影响核心功能，但网络异常时用户无法判断状态）。

**⚠️ 缺陷 2：`main_window_renderer` 原生崩溃（存量）**
今日 2 次：10:39:27、10:40:35，`crash_kind=native / crash_scope=main_window_renderer / exit_reason=crashed`。
历史对照：`2026-11-12.log` 同类 1 次、`2026-11-13.log` 1 次（`embedded_webview`）。
**结论：0.2.2 时代就存在，非 0.2.3 引入**。未定位到触发条件（怀疑与最大化/窗口切换有关，未证实）。

### 仍未完成
- **升级路径端到端**：前置未满足（v0.2.3 未发布）
- macOS / Linux 产物
- E2E 全量套件

---

### B. 升级路径端到端（发版铁律必验项，仍未完成）

前置：**必须先发布 v0.2.3 到 GitHub Releases**（需你确认，我没打 tag）。

网络情况（2026-11-16 实测）：
- `api.github.com` 直连 **200 正常**
- `github.com` 下载域名直连 **超时**（这才是卡点）
- `ghfast.top` 镜像 **200 可用**
- 代理 `127.0.0.1:7897` 能连通，但出口 IP 被 GitHub 限流（403 `API rate limit exceeded`）

验证步骤：装 0.2.2 → 启动 → 检查更新 → 下载 → 安装 → 重启 → 确认版本变 0.2.3。

## 六、agent-desktop 已知约束（headed 下预计缓解）

| 现象 | 原因 | headed 下 |
| --- | --- | --- |
| `desktop_type` 被 POLICY_DENIED | 输入框只暴露 SetValue，物理回退被禁 | 应可物理输入 |
| `AMBIGUOUS_TARGET`（两个「返回工作区」同名按钮） | 语义层无法区分 twins | 可用 `--headed` 坐标点击 |
| `desktop_set_value` 无效 | React 受控组件忽略 DOM value 写入 | 改用物理输入 |

## 七、测试中发现但未定性的异常（建议留意）

**渲染层冻结一次**：在设置页来回切换后，连续三张截图 md5 完全相同（`9dae5ff41688d7eb1df923e3b1eed80f`），窗口状态变 `disabled`，进程数从 12 涨到 18，但所有进程 `Responding=True`。重启应用后恢复。

**未确认是产品缺陷还是 agent-desktop 快照的过渡态**。如复现，值得单独查（可能是 Radix 弹层未关闭导致 inert 遮罩，或设置页切换时的动画卡住）。

## 八、验收报告

完整报告（含 4 项阻塞修复、7 项测试基础设施修复、全量测试数据）：
`docs/release-acceptance-2026-11-15.md`

## 九、发版铁律（不可违反）

未经全面测试禁止发版。发版 = 改版本号 / 打包 / 打 tag / 创建 Release。

必验：门禁全绿 → 完整构建 `pnpm build` → 产物核验（从 asar 读回）→ 真实安装 → 升级路径全程 → 主要功能逐项点过 → 未测项如实报告。
