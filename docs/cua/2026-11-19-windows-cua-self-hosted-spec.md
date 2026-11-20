# Windows 电脑控制自研实现规格

## 状态

Draft — V1–V7 已完成；P0–P5 已实现并验收；**已集成到 node-repl-host**（14 个 SDK 方法对齐）；会话链路与画面回传已实现；独立桌面做成六态判定 + actionable；creator+host 进程对与跨会话引导管道已落地（最后一步提权受 SeTcbPrivilege 限制，见 §1.23–§1.27）。

## 背景

`packages/raspberrycode-cua` 当前是 fail-closed 占位包：所有能力返回
`Computer Use is not available in this build.`，安装包不带 `resources/tools/cua-helper`，
设置页的开关打开后调用即失败。本规格定义一套自研实现，使开源构建具备可用的电脑控制能力。

上游（闭源 producer）的方案存在一处与本项目实测结论不符的前提，见 §2。

## 1. 实测结论（设计依据）

2026-11-19 在 Windows 11 家庭版（10.0.26300）实机验证，所有结论均为运行时证据。

### 1.1 UIA 动作会激活窗口

| 路径 | 动作生效 | 抢焦点 |
| --- | --- | --- |
| UIA `InvokePattern`（UWP 计算器） | 是（显示 `0`→`7`） | **是** |
| UIA `InvokePattern`（Win32 资源管理器） | 是 | **是** |
| UIA `Toggle`（资源管理器） | 是 | **是** |
| UIA `ExpandCollapse.Expand` | 是 | **是** |
| UIA `SelectionItem.Select` | 否（`0x80131509` E_FAIL） | 否（因失败） |
| UIA `SetFocus` | 是 | **是** |
| `PostMessage(WM_NULL)` ×10 | — | **否** |
| `PostMessage(WM_MOUSEMOVE)` | — | **否** |
| agent-desktop headless `click` | 是 | **是**（`mechanism: semantic_api`） |

四个独立来源（手写 UIA、UIA 多 pattern、agent-desktop、跨应用框架）结论一致。

**影响**：上游把 `path: "ax"` 归为「后台路径」并据此统计后台占比，与本项目实测不符。
上游的「零焦点违规」判定可能只覆盖「输入劫持」，不覆盖「窗口激活」。本规格以
**窗口是否被激活**为判定口径。

### 1.2 PostMessage 是唯一零抢焦点路径

连续 10 次 `WM_NULL` + 一次 `WM_MOUSEMOVE` 后，前台窗口 pid/标题/类名完全不变。

且在 Chromium 宿主上对复选框发 `WM_LBUTTONDOWN/UP`，`ToggleState` 稳定交替、
光标未移动、前台未变化（§1.12）——即**动作真实生效的同时零干扰**。

### 1.3 UIA 跨 Windows 会话不可见

同一进程在 Session 1 枚举 UIA：

```
顶层窗口 13 个，全部属于 Session 1
Session 2（RDP 子会话，54 个进程）可见窗口数 = 0
```

交叉验证：agent-desktop `list-apps` 同样只返回 Session 1 的进程。

**影响**：子会话方案必须在会话内运行独立助手，不能由主会话远程操作。

### 1.4 子会话机制可用但受版本约束

```
WTSIsChildSessionsEnabled = 1
WTSGetChildSessionId = 2（幂等，重复调用返回同一 ID）
```

Session 2 拥有完整独立桌面：`winlogon` / `csrss` / `dwm` / `explorer` / `rdpclip` / `ctfmon`。

**状态会变**：子会话是「按需存在」的，创建者进程退出后即注销。
复查时（同日稍后）读到的是 `WTSGetChildSessionId = 0xFFFFFFFF`
（已启用但没有活动会话）。判断可用性时必须区分「开关」与「当前是否有会话」，
不能把后者当成前者。

### 1.5 FFI 能力验证（纯 Node 环境）

koffi 2.15.6 直调下列系统接口全部成功：

| 能力 | 结果 |
| --- | --- |
| `CoCreateInstance(IUIAutomation)` | 成功 |
| COM 虚表读取 + 函数指针调用 | 成功（20 窗口 / 543 后代元素） |
| VARIANT / BSTR 编解码（含中文） | 成功 |
| `PrintWindow(PW_RENDERFULLCONTENT)` | 成功（1309×1001 真实像素） |
| `SendInput` 结构体构造 | 结构体尺寸校验通过 |

**未验证**：koffi 在 `Electron.exe + ELECTRON_RUN_AS_NODE=1` 下的可用性。见 §8 V1。

### 1.6 V1 验证结果（2026-11-19，已通过）

在 `electron.exe 44.7.0 + ELECTRON_RUN_AS_NODE=1` 下：

| 项 | 结果 |
| --- | --- |
| 运行时 | Node 24.21.0 / Electron 44.7.0 / NODE_MODULE_VERSION 149 |
| koffi 2.15.6 加载 | 通过 |
| `CoInitializeEx` | `0x0` |
| `CoCreateInstance(IUIAutomation)` | `0x0`，指针有效 |
| `GetRootElement` | `0x0` |
| `FindAll(Children)` | `0x0`，13 个顶层窗口 |
| BSTR 属性读取（含中文） | 通过（`"任务栏"` / `"WeMail"` 正常） |

**结论**：koffi 在 Electron 环境下与纯 Node 行为一致，N-API 跨 ABI 兼容成立。
技术路线不需要退回 C++ addon。

### 1.7 UIA 树规模实测（V3）

2026-11-19 测量本机 8 个可访问窗口，遍历上限 5000 节点 / 深度 30。

| 应用 | 元素 | 字符 | token≈ | 深度 | 耗时 |
| --- | --- | --- | --- | --- | --- |
| 任务栏 | 60 | 1,496 | 597 | 3 | 66ms |
| **开始菜单** | **5000+（撞上限）** | **132,770** | **42,232** | 13 | **5,169ms** |
| WeMail（Qt） | 1 | 59 | 18 | 0 | 35ms |
| 企业微信 | 1 | 57 | 23 | 0 | 7ms |
| PixPin（Qt） | 1 | 61 | 19 | 0 | 3ms |
| WorkBuddy | 97 | 1,434 | 448 | 6 | 263ms |
| CodeBuddy | 125 | 2,066 | 690 | 6 | 423ms |
| ZCode | 193 | 3,097 | 968 | 7 | 287ms |

中位数：**60 元素 / 448 token / 66ms**，属健康量级。

两条直接结论：

1. **必须限制遍历期预算**——开始菜单单次 5.2 秒不可接受，事后截断无法挽回
2. **Qt 系应用无树**——元素数恒为 1，无障碍动作对该类应用完全不可用

数据按形态分三类，对应三种策略：健康树（60–200 元素，全量下发）、无树（1 元素，
截图路线）、超大树（5000+，预算截断）。

### 1.8 元素坐标与消息投递实测（V6）

2026-11-19，8 个窗口、按框架分组。

**坐标可得性**（`BoundingRectangle` 解析为 SAFEARRAY → double[4]）：

| 框架 | 元素数 | 拿到合法中心点 |
| --- | --- | --- |
| Win32-shell（任务栏） | 24 | 5 |
| Chromium（4 窗口） | 43 | 7 |
| Qt（WeMail） | 0 | 0 |
| 其他（企业微信 / PixPin 等） | 0 | 0 |

**消息投递**（`WM_MOUSEMOVE` 到元素中心，投给 `ChildWindowFromPointEx` 解析出的最深子 HWND）：

| 框架 | 入队结果 | 真实光标 |
| --- | --- | --- |
| Win32-shell | ok | 未移动 |
| Chromium ×2 | ok | 未移动 |
| Qt / 无树应用 | 无坐标可投 | — |

**三条结论**：

1. **零干扰再次确认**：`PostMessage` 全程真实光标未移动
2. **坐标可得但有脏数据**：观测到 `(-32115, -31984)` 这类越界坐标（最小化或隐藏窗口），
   实现时必须校验 `bounds` 在合理屏幕范围内，否则会把消息投到无意义位置
3. **无树应用无法定位**：Qt 系连 `BoundingRectangle` 都拿不到，一级与二级对它都不可用

**方法论局限**：本轮只验证「消息是否入队」，未验证「应用是否处理」。`PostMessage`
返回 `ok` 仅代表进入队列。真实处理情况必须在实现阶段用可读回状态的控件验证（V6 剩余部分）。

### 1.9 节点身份稳定性实测（V2）

2026-11-19。UIA `RuntimeId`（`IUIAutomationElement::GetRuntimeId`，虚表索引 4）
返回 `SAFEARRAY(VT_I4)`，是元素在会话内的稳定标识。

**静态稳定性**（同一窗口连续 5 次观察，UI 不变）：

| 窗口 | 元素数 | RuntimeId 一致 / 变化 | 唯一性 |
| --- | --- | --- | --- |
| WeMail（Qt） | 1 | 4 / 0 | 1 / 1 |
| Tabbit（Chromium） | 800 | 3200 / 0 | 800 / 800 |
| CodeBuddy（Chromium） | 14 | 56 / 0 | 14 / 14 |

稳定率 **100%**，零碰撞。派生身份（类型 + 名称 + 父路径）同样 100%，可作后备。

**动态稳定性**（制造真实 UI 变化——展开资源管理器「桌面」树节点）：

```
元素数 223 → 252
RuntimeId 保留 114 / 消失 109 / 新增 138
```

结论：`RuntimeId` 能正确区分「保留」与「新增」，适合作为差分身份。

**一个关键发现**：展开一个树节点导致 **109 个元素消失、138 个新增**，说明该宿主
**重建了整个子树**而非增量添加。差分实现必须把这种形态识别为「子树替换」，
而不是生成 247 条独立的增删记录，否则差分输出会比全量更难读、更费 token。

**实现注意**：
- `SAFEARRAY` 的 `rgsabound` 结构是 `{ LONG cElements; LONG lLbound; }`，**cElements 在 +24**、
  lLbound 在 +28。读反会得到恒定的错误值（本规格首轮实现曾因此误判为「RuntimeId 全相同」）。
- 遍历必须用 `TreeScope_Children`(2)，用 `Descendants`(4) 会重复访问同一元素，导致身份重复。

### 1.10 Helper 冷启动耗时（V5）

2026-11-19，三轮测量（`electron.exe` + `ELECTRON_RUN_AS_NODE=1`，最小 Helper 实现：
建 pipe + 按需加载 koffi + 一次 UIA 探测）。

| 阶段 | 耗时 |
| --- | --- |
| `spawn` 返回 | 12ms |
| 运行时启动（Node + koffi 加载） | 51ms |
| pipe 就绪 | 51ms |
| 首次 UIA 调用（`CoInitializeEx` + `CoCreateInstance`） | 14ms |
| **spawn → 可操作** | **65ms** |

三轮区间 63–67ms，稳态 ping 延迟 2–38ms。

**结论：不需要预启动。** 65ms 低于人类感知阈值，按需懒启动即可。这与 RDP 子会话的
20–45 秒冷启动形成量级差异，也是同会话方案在响应性上的核心优势。

**闲置回收阈值**：按启动成本的量级估算，用 10 分钟（而非机械的 10 倍成本）更合适——
过短会导致高频冷启动，过长则长期占用内存。

### 1.11 差分可靠性实测（V4）

2026-11-19。用 Electron 起可控测试窗口（Chromium 宿主，24 个元素），五个场景：

| 场景 | 期望 | 实际差分输出 | 结果 |
| --- | --- | --- | --- |
| 无变化 | no change | `(no change)` | ✓ |
| 单点文本变更 | 1 条 `~` | `~ 8 name="已改按钮"` | ✓ |
| 新增子元素 | 1 条 `+` | `+ listitem "新条目"` | ✓ |
| 删除子元素 | 1 条 `-` | `- listitem "新条目"` | ✓ |
| 批量新增 8 项 | 可识别为集中新增 | `+8`，集中在同一父节点 | ✓ |

**5/5 通过，零噪声。** 差分输出的 token 收益：全量约 1000 字符 vs 差分 16 字符。

**实现注意（本轮踩到的坑）**：

1. **Chromium 的 a11y 树是异步构建的**。窗口出现后树还在长，必须轮询到规模稳定
   （连续 3 次元素数不变）才能取基线，否则第一次观察会漏掉大半元素。
2. **`data:` URL 需要显式 `charset=utf-8`**，否则中文按 latin1 解码成乱码
   （`"V4 差分测试窗口"` 变成 `"V4 å·®åˆ†..."`）。
3. **Electron GUI 模式下 stdin 不可读**。用管道向主进程发命令收不到（`ELECTRON_RUN_AS_NODE`
   模式下可以）。测试工具需改用文件轮询等替代通道。
4. **`executeJavaScript` 的多语句需要 IIFE 包裹**，否则静默失败。

### 1.12 消息投递是否被真实处理（V6 补齐）

前面的 1.8 只验证了「消息入队 + 光标不动」。本节验证**应用是否真的响应**。

**方法**：Electron（Chromium 宿主）测试窗口内放两个复选框。对第二个复选框发
`WM_LBUTTONDOWN`(MK_LBUTTON) + `WM_LBUTTONUP`，读回 `ToggleState`（属性 **30086**）。

| 项 | 结果 |
| --- | --- |
| 点击前 `ToggleState` | `0`（Off） |
| 一次点击后 | `1`（On） |
| 连续 5 次点击 | `1→0→1→0→1`，稳定交替 |
| 位置鲁棒性 | 左上角、右下角、中心均生效 |
| 光标（紧贴点击前后读取） | `(934,526) → (934,526)`，未移动 |
| 前台窗口 | 未变化 |

**结论：`PostMessage` 在 Chromium 宿主上真实生效，且完全零干扰。**

这与上游 spec 的「Chromium 整类丢弃」记载**不符**。可能原因：上游指的是某些特定
手势（滚轮、拖拽、键盘）在 Chromium 上不可达，而非普通左键点击；上游也确有
「Chromium 左键单击特例直投」的记录。本实测支持后者。

**实现注意**：

- `UIA_ToggleToggleStatePropertyId` 是 **30086**。**30022 是 `IsOffscreen`**，
  **30019 才是 `IsPassword`**（2026-11-19 对照 Microsoft 官方 propids 表核实）。
  用 30022 读 ToggleState 会恒得布尔值，误判为「切换无效」。
- `IUIAutomationTogglePattern::Toggle` 在虚表索引 **3**（IUnknown 占 0–2）。
- 测光标移动必须**紧贴**投递前后读取。中间隔 sleep 会被外部鼠标移动污染，
  产生「零干扰被破坏」的假结论。

## 2. 与上游方案的差异

| 维度 | 上游 | 本规格 | 依据 |
| --- | --- | --- | --- |
| 派发顺序 | UIA → PostMessage → SendInput | **PostMessage → UIA → SendInput** | §1.1 |
| 升级决策 | 驱动侧自主，模型无感 | **显式预算，超预算即拒绝** | §3.2 |
| 原生层 | C++ addon（`ax_native.node`） | **koffi 直调** | §1.5 |
| 子会话 | 不在范围内 | v2 预留 | §1.3 |
| 树格式 | full / delta / no-change | 沿用，v1 含截断与差分 | §5 |

## 3. 能力分层

### 3.1 五级能力链

按「是否越过硬底线」分层。硬底线：**不抢占用户鼠标与键盘**。

| 级别 | 路径 | 抢键鼠 | 激活窗口 | 默认 | 覆盖率 |
| --- | --- | --- | --- | --- | --- |
| 一级 | 消息投递 | 否 | **否** | 开 | 中（单击已验证；滚轮/拖拽/键盘待验） |
| 二级 | 无障碍动作 | 否 | 是 | 开 | 高 |
| 三级 | 物理注入 | **是** | 是 | **需授权**（已实现） | 高 |
| 四级 | 提权物理注入 | **是** | 是 | **需授权 + UAC** | 最高 |
| 五级 | 人在回路 | — | — | 兜底 | 无失败模式 |

一级与二级符合硬底线，常开。三级及以上越过底线，必须显式授权。

一级的覆盖率在 §1.12 得到部分证实：**普通左键单击在 Chromium 宿主上真实生效且零干扰**。
滚轮、拖拽、键盘、文本输入在本轮未验证，实现时按「单击可用、其余待验」处理，
遇到不生效时按 §3.3 降级。

### 3.2 干扰预算

预算**属于任务，不属于单次调用**，任务期间锁定。

| 档位 | 允许级别 | 用途 |
| --- | --- | --- |
| `quiet` | 一级 | 用户在用电脑，任务可慢慢做 |
| `balanced`（默认） | 一、二级 | 用户在用电脑，可接受窗口切换 |
| `unrestricted` | 一至四级 | 用户离开电脑 |

**权威边界**：

```
用户（UI 选择）→ 会话状态（持久化）→ 请求上下文（每次下发）→ 控制内核（只读）
```

- 预算只由用户写入，**模型参数中不存在该字段**
- 控制内核只读预算，超预算即拒绝，**绝不自行升级**
- 模型通过返回值得知拒绝原因，不能通过参数要求提权

**任务级评估**：任务开始时预估所需档位（依据涉及应用的能力画像），若超出当前预算，
**在任务开始前一次性询问**，任务期间不再打扰。不允许中途变更预算。

### 3.3 降级规则

单向降级，且**只在确定未发送时允许升级**。

```
本级失败
├─ 确定未发送（not_sent）    → 允许降级到下一级
├─ 可能已发送（possibly_sent）→ 停止，要求重新观察，禁止重放
├─ 目标身份/权限无效          → 拒绝，不降级
└─ 超出当前预算              → 拒绝，返回 FOREGROUND_REQUIRED
```

## 4. 架构

### 4.1 分层

```
模型（只见 node_repl js）
  ↓ 私有 bridge（已有）
CUA broker（已有：账本鉴权 / 会话隔离 / subagent 禁用）
  ↓ runtime.execute()
CUA runtime（本规格实现）
  ├─ 观察层：快照 / state_id / 元素索引 / 差分
  ├─ 规划层：预算校验 / 派发路径选择 / 降级决策
  └─ 执行层：三个 backend（消息 / 无障碍 / 物理）
  ↓ 本地管道
Helper 进程（持有系统授权，koffi 直调）
```

### 4.2 职责边界

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| broker | 鉴权、会话隔离、账本 | 派发决策 |
| runtime | 观察、规划、派发 | 系统调用 |
| Helper | 系统调用、无障碍树、截图 | 策略判断 |

**Helper 必须独立进程**：UIA 调用是同步阻塞的，大树遍历可达数百毫秒，放在主进程会卡界面。

## 5. 观察契约

### 5.1 模型可见格式

缩进文本树（沿用上游 DSL），按需截图：

```
@state s-12 mode=full app=记事本 window=main showing 1-120 of 543
0 window "记事本"
  1 region "文本编辑器"
    6 text "" value="hello" editable focused
    14 button "保存" [press]
```

- 行首数字为元素索引，`[...]` 为该元素支持的动作名
- 头部标注 `mode`（full / delta）、元素总数、截断范围
- 截图不随树默认下发，需要像素时显式请求

### 5.2 遍历预算与截断

**预算在遍历期生效，不是遍历后截断。** 依据 §1.7 实测：开始菜单真实元素数超过 5000，
无上限遍历耗时 5.2 秒、产出 132,770 字符（≈42k token），事后截断无法挽回这段时间。

三个上限必须同时存在：

| 上限 | 建议值 | 作用 |
| --- | --- | --- |
| `maxNodes` | 800 | 控制 token 规模 |
| `maxDepth` | 12 | 防止深链递归 |
| `deadlineMs` | 1500 | 防止单个 provider 卡死（节点数不多也可能超时） |

任一上限触发即停止遍历，已收集部分正常渲染，并在头部标注截断状态：

```
@state s-12 mode=full app=资源管理器 window=main truncated=nodes showing 1-800 of 5000+
```

截断按子树优先（保留顶层骨架，优先展开当前焦点路径），不按扁平顺序硬切。

### 5.2.1 无树应用

实测 Qt 系应用（WeMail / 企业微信 / PixPin）返回 **1 个元素**（仅窗口本身，无子元素）。
这类应用**不存在可用的无障碍树**，元素索引与语义动作全部不可用。

判定方式：遍历结果中可交互元素（有 name 或 value 的元素）数量为 0，且总元素数 ≤ 2。

处理策略：

| 能力 | 可用性 |
| --- | --- |
| 二级（无障碍动作） | **不可用**（无元素可操作） |
| 一级（消息投递） | 需要坐标，而坐标来自元素 bounds，同样不可得 |
| 三级（物理注入） | 可用，但需先截图并由上层定位 |
| 观察 | 只能提供截图，不提供树 |

因此无树应用**必须走截图 + 坐标路线**，且消息投递这一级对它无意义。判定结果需记入
应用能力画像（§8 V6），在选目标时就告知模型，避免模型反复尝试读树。

### 5.3 差分

v1 同时实现全量与差分。

- 差分基线：**模型实际看过的树**。内部为身份解析做的观察不得成为基线
- 差分表达：`+` 新增、`~` 变更、`-` 移除（带稳定 ID 范围）
- 无变化时只返回 no-change 与焦点信息
- 首次观察、截图后观察、`disableDiffing` 时返回全量

### 5.4 稳定节点身份

差分的前提。身份必须跨观察稳定，且与遍历顺序无关。

**采用 UIA `RuntimeId`**（§1.9 实测：静态稳定率 100%、零碰撞、动态变化下能正确
区分保留与新增）。后备方案为 `(类型, 名称, 父路径)` 派生，实测同样 100% 稳定。

身份只用于差分对齐，**不暴露给模型**。元素索引是「本次观察内」的句柄，跨观察无效。

**子树替换识别**：实测发现宿主可能在局部变化时重建整棵子树（§1.9）。差分必须识别
这种形态——当一批元素的消失与新增在同一父节点下集中出现，且数量相近时，折叠为
一条「子树替换」记录，而不是逐条列出增删。

## 6. 动作契约

### 6.1 收据

每个动作返回收据，区分三种状态：

| `dispatch_status` | 含义 | 允许重试 |
| --- | --- | --- |
| `not_sent` | 确定未发送 | 是 |
| `sent` | 已发送 | 否（非幂等时） |
| `possibly_sent` | 可能已发送 | 否，先观察 |

`effect`：`confirmed` / `unverifiable` / `suspected_noop` / `refused`。

### 6.2 干扰披露

与上游不同：**拒绝时明确告知**。

```
FOREGROUND_REQUIRED  → "此操作需要激活窗口，当前为安静模式。可改用其他方式，或让用户确认。"
HELPER_UNAVAILABLE   → "控制助手不可用，请提示用户重启应用。"
STATE_INVALIDATED    → "助手已重启，之前的元素索引失效，请重新观察。"
```

成功路径的披露粒度待定（见 §9）。

## 7. Helper 生命周期

### 7.1 三层保活

| 层 | 行为 |
| --- | --- |
| 动作前探活 | 每次动作前发管道 ping，超时 300ms，不通则不发动作 |
| 一次性重启 | 探活失败 → **清零计数** → 清理 → 重新拉起 → 等就绪。连续失败 2 次即熔断 |
| 熔断 | 连续 2 次启动失败 → 标记本实例不可用，如实报告，不再尝试 |

「探活失败不计入启动失败」是必须的区分（§1.17）：探活失败说明进程已死，
这是**恢复路径**；把它算作启动失败会让用户手动杀进程直接导致熔断。

### 7.2 三条硬规则

1. **不在动作中途重启**：动作已发出但结果未回时进程挂掉，报「结果未知，请重新观察」，
   不得自动重试
2. **重启后清空所有状态**：旧 `state_id` 与元素索引全部失效，返回 `STATE_INVALIDATED`
3. **一次失败即熔断**：不做退避循环。Helper 起不来通常需要用户介入（杀软拦截、权限丢失）

三条都已在 P5 用真实故障注入验证（§1.17）。

### 7.3 闲置回收

空闲超过 10 分钟自动退出，下次使用时懒启动。沿用现有 `probeStableCuaHelperSocket`
的「只探活不拉起」语义。

依据 §1.10 实测：冷启动仅 65ms，远低于感知阈值，因此**不需要预启动或保活预热**。
10 分钟的阈值是经验值——过短会造成高频冷启动，过长则长期占用内存。

## 8. 验收

### V1（阻塞项）koffi 在 Electron 环境可用 —— **已通过 2026-11-19**

在 `Electron.exe + ELECTRON_RUN_AS_NODE=1` 下加载 koffi 并完成一次
`CoCreateInstance(IUIAutomation)` + 遍历顶层窗口。

结果：全部通过，读到 13 个顶层窗口，中文属性正常。详见 §1.6。

### V2 稳定节点身份的稳定性 —— **已完成 2026-11-19**

静态：连续 5 次观察，RuntimeId 稳定率 100%、零碰撞。
动态：展开树节点（223→252 元素），保留 114 / 消失 109 / 新增 138，正确区分保留与新增。
结果见 §1.9，结论已写入 §5.4。

### V3 截断阈值 —— **已完成 2026-11-19**

测量典型应用的树规模，确定遍历期预算（`maxNodes` 800 / `maxDepth` 12 / `deadlineMs` 1500）。
结果见 §1.7，结论已写入 §5.2。

### V4 差分可靠性 —— **已完成 2026-11-19**

五个场景（无变化 / 单点变更 / 新增 / 删除 / 批量新增）全部通过，差分零噪声。
结果见 §1.11，实现注意已写入该节。

### V5 Helper 冷启动耗时 —— **已完成 2026-11-19**

实测 spawn→可操作 **65ms**（三轮 63–67ms），无需预启动。结果见 §1.10，结论已写入 §7.3。

### V6 一级覆盖率 —— **已完成 2026-11-19**

已完成两部分：

1. **坐标与干扰**（§1.8）：`BoundingRectangle` 可解析为元素中心点；`PostMessage` 入队成功、
   真实光标未移动。
2. **真实生效**（§1.12）：在 Chromium 宿主上，`WM_LBUTTONDOWN/UP` 能真实触发复选框切换
   （`ToggleState` 5 次稳定交替），且光标与前台完全未变。

**重要修正**：上游「Chromium 整类丢弃」的记载与本实测不符。一级（消息投递）在
Chromium 上对普通左键点击**是有效**的（上游另有「Chromium 左键单击特例直投」的记录，
本实测支持后者）。因此 `quiet` 档并非只对传统 Win32 应用有效。

**未覆盖**：滚轮、拖拽、键盘、文本输入在 Chromium 上的表现。上游明确记载这几类在
Chromium 上不可达，本轮未复现验证。实现时应按「单击可用、其余待验」处理。

### V7 端到端 —— **已通过 2026-11-19（程序化）**

通过**包公共入口**（`index.js`，不是直接 import `dist`）走完整链路，
25/25 项通过。这样验证到的是「消费方实际会拿到什么」，包括占位回退与顶层 await 加载。

| 覆盖 | 验收点 |
| --- | --- |
| 入口 | 拿到真实实现而非占位；公共契约可用 |
| P1 观察 | stateId 分配、中文编码、节点数、差分模式 |
| P2 一级 | `post_message` 路径、动作真实生效、光标未动、收据 `sent` |
| P3 错误码 | `state_invalidated` / `bad_request` / `unknown_tool` |
| P4 预算 | quiet 下强制 ax 被拒、balanced 下 ax 可用 |
| P5 三级 | 未授权拒绝、授权后执行、抓键鼠披露、光标还原 |
| 权限边界 | 模型在参数里伪造预算/授权无效 |

**未覆盖**：真实对话中由 LLM 自主决策完成任务。这一步需要接通 broker 与模型，
属于集成阶段；本轮验证的是「链路正确」，不是「模型会用」。

### 1.19 快照历史的保留份数（V7 发现）

`SnapshotStore` 最初每个窗口只保留 `latest` + `shown` 两份。后果：

```
观察 A → stateId=s-1
观察 B → stateId=s-2，s-1 被覆盖
回去操作 A → state_invalidated
```

这是**真实的多步任务模式**（先看主窗口、再看弹窗、回来点主窗口的按钮），
只留一份会让模型频繁撞墙。

修正：每个窗口保留最近 **8 份**历史快照，`findByStateId` 在历史里查。
上限的作用是防止长任务无限持有 COM 元素引用；淘汰最旧的足够安全，
因为模型手里的 stateId 通常只往前几步。

### 1.20 公共契约必须与实现编译期对齐（V7 发现）

`index.d.ts` 是手写的公开契约，`src/runtime/index.ts` 有另一份实现类型。
两者漂移会导致「消费方能传字段但实现读不到」——TS 通过、运行时静默忽略，
是最难排查的一类问题。

V7 时实际发现了漂移：实现的 `ComputerUseRuntimeOptions` 含 `helperFactory`
（测试注入），公共契约没有。虽然当时无害，但说明漂移确实会发生。

处理：
1. 把 `helperFactory` 移到内部类型 `InternalRuntimeOptions`，公共契约保持干净
2. 新增 `src/runtime/contract-check.ts`，**逐字段**做 `Exact<>` 断言 +
   键数量比对，任何漂移都变成 `tsc` 编译错误

不用「键集相同 + 双向可赋值」这种简洁写法：条件类型在未约束的泛型位置上
会分发（distribute），实测出现过「每个子条件单独都是 true、组合起来却是 false」
的怪异结果。逐字段展开虽然啰嗦，但结果确定、报错能直接指到字段。

### 1.21 集成：模型面契约与 broker 边界（2026-11-19）

**① 模型面的真实形状是 14 个方法，不是 4 个内部工具名**

`plugin` 侧 SDK 通过 bridge 直接以方法名调用
`runtime.execute({ toolName })`，方法名清单来自 `COMPUTER_METHOD_NAMES`
（`list_apps` / `list_windows` / `get_app_state` / `left_click` / `scroll` /
`left_click_drag` / `type` / `set_value` / `select_text` / `key` /
`perform_action` / `paste` / `request_access` / `stop_computer_control`）。

集成前实现只有 4 个内部名（`list_windows` / `get_app_state` / `click` / `act`），
与 SDK 完全对不上。适配层在 `src/runtime/sdk-contract.ts`，
方法分发在 `src/runtime/handlers.ts`。

**为什么不在 Helper 层直接改成这 14 个名字**：Helper 是执行层，
`left_click` 在它那里要按预算拆成三条完全不同的路径
（`post_message` / `ax` / `foreground_send_input`）。保持两层分离，
执行层才能独立演进（加四级提权不必动模型面）。

**② 参数是 snake_case，且是 `.strict()` 校验过的**

SDK 传 `app_ref` / `disable_diffing` / `tree_shown_to_model` /
`mouse_button` / `click_count` / `scroll_direction` / `scroll_amount`。
凭空发明的键会让每次调用被 `unrecognized_keys` 打回——上游真机上出过这个事故。
Helper 内部用 camelCase，翻译在 runtime 侧的 handler 里完成。

**③ `get_app_state` 的返回值有四个硬性字段**

SDK 的 `appStateOf` 强制要求 `state_id` / `elements` / `app` / `window`，
缺任何一个直接抛 `STRUCTURED_STATE_UNAVAILABLE`，模型完全看不到树。
`elements` 是数组，每项含 `index`（**快照里的原始下标，不能重新编号**）。
实现见 `collectElements`：只收「可交互或带内容」的节点，上限 200 项。

**④ broker 层：自研实现不需要它，因此判定必须改**

上游架构是「bootstrap 注入 broker socket → runtime 通过 socket 转发」。
自研实现自己 spawn Helper、自己管管道，权限由会话上下文
（预算 + 物理注入授权）表达，不需要独立 broker 服务。

但 `captureComputerUseRuntimeFromEnvironment` 原本是
「没有 socket 就返回 undefined」，而上游的 socket 依赖
`resolveStableCuaWinRecipe()` 解析 `ax_native.node` 与 helper 应用包——
自研实现不用这些，那条链路永远解析失败，socket 永远不存在。
**不改这个判定，自研实现就永远接不上。**

改为两条路：
1. 有 `RASPBERRYCODE_CUA_PERMISSION_BROKER_SOCKET` → 走 broker（保留上游路径）
2. 无 socket 且在 Windows → 直连自研 Helper（可用 `RASPBERRYCODE_CUA_SELF_HOSTED=0` 关闭）

平台判断放在入口而不是交给 runtime：非 Windows 若返回一个必然失败的 runtime，
模型会看到「工具存在但每个都报错」，不如直接不注册。

### 1.22 pattern ID 表抄错的代价：一次完整的误诊复盘（集成时）

**这段记录的是一个错判，以及它为什么看起来那么像真的。**

#### 现象

集成时实现 `set_value`，调用 `IUIAutomationValuePattern::SetValue` 时
Helper 进程直接 `ACCESS_VIOLATION`（0xC0000005）退出。逐层排查得到：

| 调用 | 结果 |
| --- | --- |
| `SetValue` | **0xC0000005，进程退出** |
| 先 `QueryInterface` 稳定化再调 | 仍然崩溃 |
| 改传 BSTR 而非 `char16_t*` | 仍然崩溃 |
| `get_CurrentIsReadOnly`（索引 5，无字符串输出） | 返回 `S_OK`，但**输出值是垃圾** `907493776` |
| `get_CurrentValue`（索引 4，BSTR 输出） | **崩溃** |
| 虚表索引核对（对照 openstandia Go 绑定） | 索引 3 = `SetValue`，**没有错** |

据此当时的结论是「koffi 在这个接口的 BSTR 通道上不可靠，ValuePattern
在本运行时不可用」，并把 `set_value` 降级为物理注入。

#### 真正的根因

**`UIA_PATTERN` 常量表有六项抄错**，与微软官方 `UIAutomationClient.h` 不符：

| 常量 | 错值 | 官方真值 | 错值实际指向 |
| --- | --- | --- | --- |
| `VALUE` | 10014 | **10002** | TextPattern |
| `TOGGLE` | 10010 | **10015** | SelectionItemPattern |
| `SELECTION_ITEM` | 10002 | **10010** | ValuePattern |
| `TEXT` | 10021 | **10014** | SynchronizedInput |
| `SCROLL` | 10003 | **10004** | RangeValue |
| `RANGE_VALUE` | 10015 | **10003** | TogglePattern |
| `LEGACY_ACCESSIBLE` | 10020 | **10018** | VirtualizedItem |

于是「调 ValuePattern::SetValue」实际是「拿到 TextPattern 的指针，
调它的虚表第 3 项」——那个槽位的真实签名完全不同，参数一进去就崩。

#### 三个把误诊坐实成「确证」的信号

现在回看，这三条都指向「查错了接口」，但当时被读成了「接口不可用」：

1. **`get_CurrentIsReadOnly` 返回 `S_OK` 但输出是垃圾值。**
   正确的调用不该留下未写入的 out 参数。这个反常被我记成了
   「koffi 的 out 参数不可靠」，实际是「这个 vtable 的索引 5 不是 IsReadOnly」。
2. **复选框「不支持 TogglePattern」。**
   一个 HTML checkbox 不支持 Toggle 是荒谬的。当时按「Chromium 可能只暴露
   SelectionItem」解释过去了——而真相是查的 10010 本来就是 SelectionItem。
3. **所有失败都表现为崩溃而非 `E_INVALIDARG`。**
   我把它归因为「COM 签名不匹配导致内存越界」，方向对了一半——
   但没继续问「为什么签名会不匹配」。

#### 修正后的实测

改正常量表后（`UIA_PATTERN` 现在与官方逐字一致）：

| 调用 | 结果 |
| --- | --- |
| `TogglePattern::Toggle`（10015） | `S_OK`，复选框翻转 |
| `ValuePattern::SetValue`（10002） | `S_OK`，文本被替换，**进程正常** |
| `set_value` 的路径 | `ax`（不抢键鼠、光标未动、`balanced` 预算即可） |

`set_value` 因此**不再需要授权**，回到了应有的轻量语义。

#### 保留下来的两处改动（它们独立成立）

1. **`getPattern` 稳定化失败时返回 `null`，不回退原指针。**
   回退到未稳定化的指针确实会崩——这一条与 pattern ID 无关，是真缺陷。
2. **`set_value` 保留物理注入兜底。**
   ValuePattern 在只读控件、或 provider 未实现该 pattern 时确实拿不到，
   此时降级到「聚焦 → Ctrl+A → 输入」是合理的。收据用
   `degraded_from: "value_pattern"` 标注，让用户知道为什么走了重路径。

#### 教训

**外部常量表必须逐字对照官方头文件，不能凭记忆或从别处转录。**
这张表错位的六项里，`INVOKE=10000` 和 `EXPAND_COLLAPSE=10005` 是**对的**——
部分正确比全错更危险，因为它让整张表看起来是可信的。

排查时值得警惕的信号：**「某个接口整体不可用」这种结论。**
单个方法失败正常，但同接口的只读方法也返回垃圾值、
且元素「不支持」本该支持的 pattern，这组合更像「找错了对象」而非
「对象坏了」。


### 1.23 会话链路：能力边界与实现（2026-11-19）

spec 原先在 §10 把「RDP 子会话」列为 v2 预留，要求补四件事：会话创建、
会话内助手、画面回传、单例协调。实现时先探测本机能力，结论决定了范围。

#### 本机能力实测

| 探测项 | 结果 |
| --- | --- |
| `WTSIsChildSessionsEnabled` | **1（已启用）** —— 首次误报为 0，见 §1.24 的签名坑 |
| `WTSGetChildSessionId` | `sid = 0xFFFFFFFF`（已启用但无活动会话） |
| 会话列表 | `#0 Disconnected` / `#1 Active(Console)` / `#65536 Listen` / `#65537 Listen` |
| `SetTokenInformation(TokenSessionId)` | **失败，错误码 1314（缺 `SeTcbPrivilege`）** |
| `CreateProcessAsUser`（同会话） | **成功**（加 `CREATE_UNICODE_ENVIRONMENT` 后） |
| 同会话内创建 UI 进程并枚举窗口 | **成功**（charmap → 找到窗口「字符映射表」） |

两条关键结论：

1. **越会话不可行**。改令牌的 `TokenSessionId` 需要 `SeTcbPrivilege`，
   那是只有 SYSTEM 才有的特权。要绕过就得把整个应用提到 SYSTEM——
   为「操作另一个桌面」付出这个代价不合理，本实现明确不做。
2. **子会话已启用但没有活动会话**（`sid=0xFFFFFFFF`）。
   那三个 `Listen` 会话是 RDP 监听器，没有可交互桌面；
   `#0` 是服务会话，状态 `Disconnected`。

#### 实现范围（以及为什么这样划）

| 能力 | 状态 |
| --- | --- |
| 会话拓扑探测（`sessions`） | 已实现，含逐项能力与原因说明 |
| 会话内启动助手（`session-spawn`） | 已实现，限当前会话 |
| 画面回传（`screenshot`） | 已实现，`PrintWindow(PW_RENDERFULLCONTENT)` |
| 单例协调（`helper-registry`） | 已实现，进程内引用计数 |
| 越会话启动 | **不做**，明确拒绝并说明原因 |

**为什么只做当前会话的启动**：`CreateProcessAsUser` 在同会话内是可靠的，
它解决一个真实问题——用当前用户的完整交互令牌启动助手，而不是受限的过滤令牌。
跨会话那一步（改 `TokenSessionId`）是另一个特权层级的事，混在一起会让
「同会话能用」这个已成立的能力也被拖下水。

#### `CreateProcessAsUser` 的一个必踩坑

带 `CreateEnvironmentBlock` 返回的环境块调用时，**必须同时传
`CREATE_UNICODE_ENVIRONMENT`(0x400)**，否则返回 87（参数错误）。
排查过程很误导：先看到 `ok=0 err=87`，以为是 `STARTUPINFOW` 结构体
（x64 上 104 字节）对齐错了，逐个字段核对尺寸后发现结构是对的；
试 `env=null` 就成功，才定位到是「有环境块但缺标志位」这个组合非法。

另一个坑：在 Git Bash 里用 heredoc 写探针脚本时，Windows 路径的
反斜杠被 shell 吃掉（`C://Windows` 变成 `C://Windows`），
导致一个假的 `err=87`。写探针要用文件而不是 heredoc。

#### 画面回传的实现选择

用 `PrintWindow(PW_RENDERFULLCONTENT)` 而不是 `BitBlt`：

- `BitBlt` 只能复制**屏幕上可见**的部分，被遮挡或最小化时拿到的是别人的内容
- `PrintWindow` 让窗口自己往内存 DC 里绘制，不要求可见、不要求前台

这是唯一能保持「不抢焦点」的截图方式。代价是部分硬件加速窗口返回纯色图，
因此 `blank` 必须作为一等状态回报——纯黑图若被当成有效截图交给模型，
它会基于空白画面做出错误判断。PNG 编码手写（zlib deflate + 手工 CRC），
不引图像库，避免给这个包加原生依赖。

`DIB` 的 alpha 通道经常是全 0，直接透传会让整张图变全透明，必须强制写 255。

#### 单例协调解决的真实问题

多个 runtime 实例各自 spawn Helper 会导致**快照语义分裂**：
模型在 A 实例观察拿到 `s-1`，动作发到 B 实例 → B 没有 `s-1` →
报 `state_invalidated`。用户看到的是「刚观察完就说失效」。

改为进程内按「入口路径 + 命令」共享同一 Helper，引用计数管理生命周期。
最后一个使用者释放后延迟 5 秒回收（不是立即销毁）：
MCP server 关闭时多个 runtime 几乎同时 dispose，紧接着新连接可能马上要重建，
立即销毁会让这条路径每次都付 65ms 冷启动。

验收里专门验证了这一点：rt2 观察一次推进了它自己的快照，
随后 rt 用旧 stateId 操作仍然成功。

#### 一个顺手修掉的设计缺陷

实现 `screenshot` 时重构了 `handleSetValue`，去掉了 `preferPath`。
回归立刻暴露问题：`set_value` 走了 `post_message`（一级），
动作「成功」但文本框内容纹丝不动。

根因在 `planDispatchPaths`：它无条件把一级排在候选首位，
而**消息投递只能表达「在某坐标按下鼠标」，无法写值**。
已改为按意图区分——写值意图不把一级列入候选。

这条与 §1.22 同源：都是「动作报告成功但实际没生效」，比直接报错糟得多。

### 1.24 参照 WorkBuddy 的子会话实现（2026-11-19）

WorkBuddy 桌面端已经把这套能力做成了产品。分析它的实现，确认了本规格
原先的推断，也纠正了一个错误结论。

#### 它的完整链路（从产物字符串还原）

四个可执行文件 + 一个 DLL：

| 产物 | 职责 |
| --- | --- |
| `workbuddy-cu-child-creator.exe` | 创建并**保持**子会话（生命周期绑定，进程退出会话即注销） |
| `workbuddy-cu-child-host.exe` | 运行在子会话内的助手，通过命名管道通信 |
| `workbuddy-cua.exe` | 主桌面侧的执行器 |
| `wincua_bootstrap.dll` | 零提权 fallback 引导扩展（注册到 AppInit/AppCert 类槽位） |

提权链（从二进制里的 API 符号还原）：

```
schtasks（/Create /RU SYSTEM /RL HIGHEST → /Run）   ← 拿到 SYSTEM 身份
  → OpenProcess("winlogon.exe") + OpenProcessToken   ← SYSTEM 才能打开 winlogon
  → DuplicateTokenEx
  → AdjustTokenPrivileges(SeTcbPrivilege)            ← 给令牌加上该特权
  → SetTokenInformation(TokenSessionId, 目标会话)
  → CreateProcessAsUserW(host)                       ← host 落进子会话
```

子会话内部再通过 **RDP ActiveX**（`PutClearTextPassword` / `DesktopWidth`）
把会话拉到可用状态——这也解释了它为什么要用户输入一次登录密码。

通信：`\\.\pipe\wincua-child-*`、`\\.\pipe\wincua-heartbeat-*`、
`\\.\pipe\wincua-pipstream-*`，带心跳。与本规格的 Helper 管道同构。

#### 产品化封装值得借鉴的三点

1. **把提权包装成「一次性授权」，而不是让用户理解 UAC 与特权。**
   状态机分四态：`requires_setup`（点一次 UAC）/ `requires_credential`
   （输一次密码）/ `requires_reboot`（重启一次）/ `ready`。
   每一步都由 UI 卡片引导，助手只负责「触发并等待」，明确禁止自行提权。
2. **能力探测拆成六态**（`unsupported` / `supported` / `enabled_pending_reboot` /
   `transport_broken` / `enabled` / `session_ready`），每态对应不同的下一步动作。
   这比「能用/不能用」二元判断有用得多。
3. **`actionable` 字段**：明确标记「这条路走不通，不要重试」，
   避免模型在注定失败的路径上消耗预算。

#### 一处必须纠正的误判：`WTSIsChildSessionsEnabled` 的签名

第一轮实现里把它当成无参函数：

```ts
// 错的
wtsapi.func("int __stdcall WTSIsChildSessionsEnabled()")
// 调用返回 0，于是判定「系统未启用子会话」
```

**官方定义是 `BOOL WTSIsChildSessionsEnabled(PBOOL pbEnabled)`** —— 有 out 参数。
漏掉参数后 koffi 的调用不报错，只是返回 0（失败），
代码里 `!== 0` 恒为 false，整个功能被安静地误判成「系统未启用」。

修正后实测：

```
WTSIsChildSessionsEnabled = 1（已启用）
WTSGetChildSessionId      = 0xFFFFFFFF（无活动会话）
```

这个 bug 的教训比 pattern ID 那次更尖锐：**那次是常量值错，这次是函数签名错，
两者都不抛异常**。外部 API 的签名必须逐字对照官方头文件，
不能靠「调用没报错」推断正确。

#### 本规格的选择：不做 SYSTEM 提权

理由不是「做不到」，而是**代价与收益不匹配**：

- 要拿到 `SeTcbPrivilege`，必须有一个以 SYSTEM 运行的进程，
  并从 `winlogon` 借令牌。这条链上任何一环都等于整机最高权限。
- 用户在 UAC 里点「是」时，未必理解自己授权的是一个能读写任意进程内存的组件。
- 收益只是「操作另一个桌面」——而绝大多数场景下，用户在目标会话里
  直接运行本应用就能达到同样效果。

因此本实现保持：**能诊断、能解释、能在当前会话内可靠工作，不跨会话**。
`session-diagnostics` 会如实报出 `helper_session_id` 与
`session_mismatch`，让用户知道模型正在看哪个桌面。

如果将来要做，正确顺序是：先做 `enabled`/`session_ready` 这类六态能力探测，
再补 creator + host 两个进程与管道协议，最后才是提权链——
提权是最后一环，不是第一环。

### 1.25 六态能力判定与「是否有戏」（2026-11-19）

参照 §1.24 的 WorkBuddy 设计，把「独立桌面能不能用」做成**逐道门 + 是否有戏**
的形状，而不是一个布尔值。

#### 为什么二元判断不够用

用户问「能不能用独立桌面」，回答「不能」有三个问题：

1. **不区分可解与不可解**。「差一个管理员开关」值得去开，
   「需要 SYSTEM 权限」在本实现范围内永远不行。混在一起说，
   用户会反复尝试后者。
2. **不区分「没有」与「坏了」**。`WTSGetChildSessionId = 0xFFFFFFFF`
   意思是「已启用但没有活动会话」，不是「功能不可用」。
   这两种状态下一步完全不同。
3. **不给下一步**。模型看到「不能」只能猜该换什么路，
   常见结果是反复重试同一条。

#### 四道门

| 门 | 判据 | 可解 |
| --- | --- | --- |
| platform | `process.platform === "win32"` | 否 |
| switch | `WTSIsChildSessionsEnabled` | 是（管理员调 `WTSEnableChildSessions(TRUE)`） |
| session | `WTSGetChildSessionId !== 0xFFFFFFFF` | **否**（创建需 SYSTEM） |
| privilege | `SetTokenInformation(TokenSessionId)` 成功 | **否**（需 `SeTcbPrivilege`） |

`resolvable: false` 的含义要说准：**不是「暂时不行」，而是「本实现不做」**。
这条区分是整个判定的核心——它让调用方知道哪些值得等、哪些是死路。

#### 本机实测

```
capability = enabled          （开关已开，无活动会话）
actionable = false            （不要重试）
  ✓ 平台为 Windows: platform=win32
  ✓ 系统已启用子会话开关: WTSIsChildSessionsEnabled = 1
  ✗ 已存在可交互的子会话: 无活动子会话（WTSGetChildSessionId = 0xFFFFFFFF） [本实现不做]
  ✗ 可把助手放进该会话: 错误码 1314（缺 SeTcbPrivilege） [本实现不做]
```

#### 顺带做的一处防护：会话归属校验

UIA 与窗口枚举只看得到 Helper 所在的会话（§1.3）。因此
**「Helper 在哪个会话」等于「模型能看到哪个桌面」**。

`handshake` 本来就返回 `sessionId`，但此前被丢弃。现在记录它并做两件事：

- 不一致时打醒目告警（留痕，便于事后归因）
- `sessions` 诊断输出 `helper_session_id` 与 `session_mismatch`

不在此处拒绝启动：拒绝会让「为什么起不来」变得难以解释；
把判断交给诊断层，它能说清原因。

#### 还验证了一条可能绕开 SYSTEM 的路径（未走通）

`MsRdpClient` 这个 COM 类（`{7CACBD7B-...}`）可以 `CoCreateInstance` 成功
（`hr=0x0`）。理论上子会话由 RDP 服务创建，普通用户连 localhost 就能触发，
不需要 `SeTcbPrivilege`。

但两点挡住了：

1. 它的双接口 IID（`IMsRdpClientNonScriptable5` 等）需要完整 COM 定义
   才能调 `PutClearTextPassword` / `DesktopWidth`，实现量远超收益。
2. **它需要用户的 Windows 登录密码**。那不该由本实现去索要或保存。

结论：这条路在技术上存在，但代价（实现量 + 索取密码）同样不合理。
记录在此供将来参考，不作为待办。

### 1.26 creator + host 进程对（2026-11-19）

§1.24 分析 WorkBuddy 时提到它用 creator 保持会话、host 执行操作。
本规格先把这一对的**进程骨架**实现并验证了——这部分不需要任何特权，
是通往子会话的必经之路。

#### 为什么要把「保持」与「执行」分成两个进程

- **会话生命周期绑定在持有它的进程上**。creator 退出，会话注销，
  里面的 host 一起消失。
- **host 需要能独立崩溃重启**。若 UIA 调用把 host 弄崩（本规格踩过多次
  `0xC0000005`），有 creator 在就能重启 host 而会话不丢。
- **职责单一让故障归因变容易**：`creator_failed` 与 `host_exited` 是两类不同事件。

#### 实现

| 文件 | 职责 |
| --- | --- |
| `helper/creator.ts` | 拉起并看护 host，转发其就绪信号；不做 UIA 调用 |
| `helper/host-supervisor.ts` | 决定 host 落在哪个会话，并复查它是否真的在那儿 |

creator 的事件协议（单行 JSON 写 stdout）：

```
{"event":"creator_starting","mode":"same_session|cross_session",...}
{"event":"host_spawned","pid":123,"sessionId":1}
{"event":"helper_ready","socket":"\\...","sessionId":1,...}  ← 原样转发 host 的
{"event":"creator_failed","code":"...","message":"..."}
{"event":"creator_stopped","reason":"...","uptimeMs":...}
```

`client-failed` 类事件必须让客户端**立刻**终止等待，不能白等到超时。

#### 跨会话的握手问题（本实现到此为止）

管道句柄**不能跨会话继承**。因此跨会话启动时主进程无法预先指定管道名，
只能由 host 自建后回报。同会话时 stdout 是天然的回传通道，
跨会话时那条通道不存在（进程由 `CreateProcessAsUser` 直接创建，
没有连接到主进程的 stdout）。

要完成它需要额外机制：host 把地址写到双方都能读的位置（共享文件、
或者主进程先建一个双方都可连接的引导管道）。本实现未做，
`creator_failed` 里如实报 `cross_session_handshake_unimplemented`。

#### 三个实测踩到的坑

1. **`process.stdin.on("end")` 不能当「上家不要我了」的信号。**
   父进程用 `stdio: ["ignore", ...]` 启动时 stdin 立刻 EOF，
   `end` 在 `main()` 之前就到，creator 会杀掉刚拉起的 host 然后退出，
   主进程只看到 `code=0` 的「启动前退出」。父进程死亡检测已由 host 侧的
   `parent-pid` 看护覆盖，不需要这条会被误触发的捷径。
2. **注册表的共享键要区分「直连」与「经 creator」。**
   两者父进程不同、管道来源不同，混用会让后申请者拿到父进程不对的客户端。
   更隐蔽的是 **`dispose` 必须用与 `acquire` 完全一致的键**，
   否则引用计数永不归零，Helper 常驻不退。
3. **就绪事件的 `socket` 字段必须被消费。**
   经 creator 启动时管道名由 host 决定，客户端若仍用自己生成的路径就会连不上。
   直连时两者应当一致——不一致要告警，那说明 host 报错了自己的地址。

#### 验收

```
creator + host 专项   12/12
creator 模式 e2e      10/10   （真实点击零干扰、set_value 走 ax、引用计数归零）
直连模式回归           7/7    （确认默认路径未受影响）
```

`useCreator` 刻意没有放进公共 `ComputerUseRuntimeOptions`：
它目前只验证了同会话路径，放进公共契约会让人以为跨会话也能用。

### 1.27 跨会话握手：引导管道（2026-11-19）

§1.26 留下的缺口是「跨会话时主进程拿不到 host 的管道名」。
本轮的解法是**反向连接**。

#### 为什么这条路成立

Windows 命名管道在全局内核对象命名空间（`\Device\NamedPipe`），
**不随会话隔离**——这与窗口站、桌面不同。同一用户在不同会话里的进程
可以连同一个管道名。所以：

```
主进程：createServer(\\.\pipe\raspberrycode-cua-bootstrap-<uuid>)
        ↓ 通过 --bootstrap 参数把名字传给 host
host（另一个会话）：createConnection(该名字) → 写一行 JSON 报自己的地址
        ↓
主进程：拿到地址 → 用它建业务连接
```

#### 为什么不用共享文件

需要轮询、需要清理、有读到半截内容的竞态。管道有天然的连接语义
（对端连上才算成功），也不需要事后清理。

#### 实现

`helper/address-broker.ts` 两端：

| 函数 | 侧 | 职责 |
| --- | --- | --- |
| `createBootstrapChannel()` | 主进程 | 建管道、等回报、可超时、可提前关闭 |
| `reportAddressToBootstrap()` | host | 连上管道、写一行 JSON、断开 |

报文格式（单行 JSON）：

```json
{"socket":"\\...\\pipe\\raspberrycode-cua-xxx","pid":123,"sessionId":2,"protocolVersion":3}
```

三个字段缺一不可：没有 `sessionId` 就无法判定 host 落在哪个桌面，
没有 `socket` 就无从连接，没有 `pid` 就无法在失败时定位进程。

#### 与 stdout 通道的分工

| 启动方式 | 回传通道 | 事件 |
| --- | --- | --- |
| 同会话 | host stdout（creator 转发） | `helper_ready` 无 `viaBootstrap` |
| 跨会话 | 引导管道 | `helper_ready` 带 `viaBootstrap: true` |

creator 把引导管道的回报**包装成同一条 `helper_ready` 事件**转发出去，
让客户端只认一种事件格式。区分启动方式是实现细节，不该泄漏到客户端。

#### 客户端新增 `attachToReadyHelper()`

跨会话时 host 已在跑，客户端不能再用 `ensureReady()`——那会自己 spawn 一个，
变成两个 Helper、快照分裂。新增的方法只「连接 + 握手」，连不上就抛错，
不重试也不拉起。

配套的 `cleanupSocketOnly()` 也只清 socket 不杀进程：跨会话的 host
不归本进程管理，强杀它只会在那边留个死会话。

#### 顺带修正的一处语义

`spawnHelperInSession` 失败时**不降级到当前会话**。静默降级会让调用方
以为 host 在目标会话里，而实际在别的桌面——观察结果全错。失败就报失败，
理由写在 `detail` 里。

#### 验收（本机无法真正跨会话，验证到协议与失败路径）

```
引导通道协议        13/13  （含真正的跨进程回报：子进程 pid 对上）
creator 跨会话分支  15/15  （会话不存在 / 无桌面 / 同会话回归）
host-supervisor     15/15  （同会话健康、实例复用、跨会话失败清晰）
全量回归            14/14  （直连与 creator 两种模式各 7 项，能力一致）
```

引导通道的验证**不需要跨会话**：协议正确性与两端在不在同一会话无关，
跨进程回报已经用独立子进程验证过。缺的只是最后一步——真正把 host
放进另一个会话，那需要 `SeTcbPrivilege`。

### 1.28 子会话建立：ActiveX 路线与凭据模型（2026-11-19）

用户提出：能否让用户自己输密码，若 `LimitBlankPasswordUse = 0` 就连密码都不用输。
沿这条线查下去，得到三个结论——其中两个推翻了此前的判断。

#### ① 密码是主路径，空密码只是它的特例（产品约定）

按用户明确的表述：**真正的上限是让用户自己提供密码**，
`LimitBlankPasswordUse = 0` 只是让「密码字段可以为空」这一特例成立，
不是一条独立的免密通道。

接口因此设计成**始终要求一个凭据对象**，而不是「有密码走这条、没密码走那条」：

```ts
interface SessionCredential {
  username: string;
  password: string;   // 允许空串，但必须显式给
  domain?: string;
}
```

空密码只是 `password: ""`，后续流程完全一致。这样代码里不会出现两条
需要分别维护的分支，也不会在某个分支上漏掉安全处理。

`checkCredential()` 做前置一致性检查，区分两种失败：
- 密码错误 → RDP 握手阶段才会知道
- **系统不允许空密码** → 现在就能判定，并给出两条出路（设密码 / 改策略）

混在一起报「登录失败」，用户会反复重输密码。

#### ② 家庭版也能建子会话，且不需要 SYSTEM

| 探测项 | 结果 |
| --- | --- |
| Windows 版本 | **11 家庭版**（`CoreCountrySpecific`） |
| 3389 端口 | **完全不监听**（家庭版无 RDP 服务端） |
| `Remote Desktop Users` 组 | **不存在** |
| `WTSIsChildSessionsEnabled` | **1（已启用）** |
| `WTSGetChildSessionId` | `0xFFFFFFFF`（无活动会话） |
| `LimitBlankPasswordUse` | **0**（已允许空密码网络登录） |

关键 API：**`WinStationCreateChildSessionTransport`**（`winsta.dll`，未公开）。
真实签名从 FreeRDP 的 `childsession.c` 找到：

```c
typedef NTSTATUS (*Fn)(WCHAR* path, DWORD len);
HRESULT hr = fn(pipePath, 0x80);   // 输出的是管道路径
HANDLE f = CreateFileW(pipePath, GENERIC_READ|GENERIC_WRITE, ...);
```

实测：

```
WinStationCreateChildSessionTransport → hr=0x0
返回: \.\pipe\{B05EC6CF-DF40-4CFD-1392-0F0A1BADEA47}
CreateFile → 成功
```

**它走的是进程内命名管道，不是 TCP 上的 RDS。** 所以家庭版没有 RDP
服务端也成立，且全程不需要 SYSTEM、不需要改任何系统策略。

但**会话没有出现**（`WTSGetChildSessionId` 仍为 `0xFFFFFFFF`）。
传输通道只是个「管子」，还需要在上面跑完整 RDP 协议完成登录，
会话才会真正建立。

#### ③ ActiveX 原生支持子会话——这解决了协议栈问题

`IMsRdpExtendedSettings` 有个 `ConnectToChildSession` 属性，
设为 TRUE 就把连接重定向到本机子会话。实测：

| 项目 | 结果 |
| --- | --- |
| `MsRdpClient10NotSafeForScripting` 实例化 | 成功 |
| QI 到 `IDispatch` | **成功**（双接口对象） |
| `put_Property("ConnectToChildSession", TRUE)` | **`hr=0x0`** |
| DISPID 按名称解析 | 全部成功 |

DISPID 实测值（**不要猜虚表索引**）：
`Server=1`、`Domain=2`、`UserName=3`、`Connected=6`、`Connect=30`、
`Disconnect=31`、`AdvancedSettings=98`。

#### 一个必须记住的教训：不要猜虚表索引

早期版本用「猜索引」调 `IMsTscAx` 属性，导致 `0xC0000005` 崩溃。
索引猜错的后果不是错误码，是进程直接死。

改为**通过 `IDispatch` 按名称调用**后，名字错了只返回
`DISP_E_UNKNOWNNAME`，不会崩。这个控件支持双接口，所以这条路通。

#### 当前边界（如实标注）

`createChildSession()` 停在「ActiveX 就绪 + 子会话模式已开启」，
凭据注入（`IMsTscNonScriptable::put_ClearTextPassword`）与 `Connect()`
尚未接通。实测 `put Server` 返回 `DISP_E_MEMBERNOTFOUND`（`0x80020003`）——
与文档一致：开了 `ConnectToChildSession` 后所有连接重定向到 localhost，
`Server` 不再是可写属性。

函数恒返回 `ok: false` 且给出 `reason: "credential_injection_unavailable"`。
不假装成功：会话不存在时若返回成功，上层会去做 `CreateProcessAsUser`
并拿到「会话不存在」，真正的原因（握手没完成）会被埋得更深。

#### 顺带修掉一个 koffi 陷阱

`RegQueryValueExW` 读注册表 DWORD 时，out 参数**必须用 `koffi.alloc` 分配，
不能传 Node Buffer**：

| 传参方式 | 结果 |
| --- | --- |
| `Buffer.alloc(4)` | **`0xEA`（ERROR_MORE_DATA）**，type/size 都对但数据没写入 |
| `koffi.alloc("uint32", 1)` | `0x0`，值正确 |

原因：koffi 把 Buffer 当临时拷贝，native 侧写入的地址与它看到的不是同一块内存。
这与「`koffi.address` 不接受 Node Buffer」是同一类约束。

#### 验收

```
空密码策略 + 凭据校验 + RDP 模块   12/12
```

其中「空密码按策略判定」在本机为 `ok: true, source: "user_input_blank"`，
说明策略读对了、空密码特例成立。

### 1.29 凭据注入成功，但撞上 OLE 初始化（2026-11-19）

上一节停在凭据注入未接通。这一轮把它接通了，然后发现真正的墙在更后面。

#### 凭据注入：走虚表，不走 IDispatch

| 通道 | 结果 |
| --- | --- |
| `IDispatch` → `AdvancedSettings.ClearTextPassword`（DISPID=186） | **`0x80020003`**（`DISP_E_MEMBERNOTFOUND`） |
| `IMsTscNonScriptable` 虚表第 3 项 `put_ClearTextPassword` | **`0x0` 成功** |

索引不是猜的：MSDN 的 `IMsTscNonScriptable` 页列出 vtable 顺序，
`put_ClearTextPassword` 紧跟 IUnknown 三项排第 3。
`IID_IMsTscNonScriptable = c1e6743a-41c1-4a74-832a-0dd06c1c7a0e`。

空密码同样能设（`put_ClearTextPassword("") = 0x0`），
这与「空密码只是密码字段的一种取值」的模型一致。

顺带确认了属性归属：

- `UserName` / `Domain` 在**主对象**上 DISPID 能解析（3 / 2）但不可写
- `ClearTextPassword` / `AuthenticationLevel` 在 **`AdvancedSettings` 子对象**上
  （DISPID=186 / 212），但子对象那条 IDispatch 路径不可写

#### 真正的墙：控件没有 OLE 初始化

`Connect()` 返回 `0x0`，但之后 20 秒 `Connected` 恒为 `0`、
`WTSGetChildSessionId` 恒为 `0xFFFFFFFF`。加一个宿主窗口也没有改变。

**根因**：`MsRdpClient` 是 OLE 控件。只调 `CoCreateInstance` 得到的对象
只完成了 COM 层面的实例化，没有 OLE 层面的初始化。
必须在它上面实现并挂上：

- `IOleClientSite`
- `IOleInPlaceSite`
- `IStorage`
- 然后 `DoVerb(OLEIVERB_INPLACEACTIVATE)`

才会真正开始工作。

**一个可用的早期探针**：未初始化的控件上设 `DesktopWidth` 返回
`E_UNEXPECTED`（`0x8000ffff`）。这比等 `Connected` 变化快得多，
而且失败原因直接指向「没挂进窗口」而不是含糊的「连接没成功」。
已把这个判断写进 `createChildSession`，返回 `reason: "ax_not_initialized"`。

#### 为什么不继续做完

接完这条路需要一个完整的 OLE 容器（三个站点接口的 C++ 级实现，
用 koffi 手写等价于手写一套 COM 宿主）。工作量与直接实现 RDP 协议栈
同一量级——这正是 §1.28 想避免的那件事。

**结论：ActiveX 路线在纯 COM 调用层面走不通，除非引入真正的 OLE 容器。**
可选的两条务实路径：

1. **引 FreeRDP 的 childsession 实现**（Apache-2.0，可商用）。
   它已经把协议栈与传输通道封装好，只需要喂凭据。
2. **用 `mstsc.exe` / `MsTscAx` 通过真实窗口宿主**——
   即先创建一个带 WebView/HWND 的窗口把控件嵌进去，
   这需要 GUI 框架参与，不是纯 Node 能做的。

#### 验收

```
凭据注入 + Connect 调用链        6/6
初始化探针识别未初始化           6/6
```

两项都通过，且都如实报告「会话未建立」，没有一处假装成功。

### 1.30 彻底还原 WorkBuddy 的子会话实现（2026-11-19）

上一节判断「ActiveX 纯 COM 调用走不通」，这个结论**不完整**。
重新逐字节分析它的二进制后，发现它用的是 **ATL 的 ActiveX 宿主窗口**，
OLE 容器那套全部由系统自带的 ATL 提供，不写一行 C++。

#### 完整调用链（从导入表与字符串还原）

```
OleInitialize
  ↓
LoadLibrary("atl.dll") → AtlAxWinInit()
  ↓  注册 "AtlAxWin" 窗口类（ATL 提供的 ActiveX 宿主）
CreateWindowExW(0, "AtlAxWin", "{8B918B82-7985-4C24-89DF-C33AD2BBFBCD}", ...)
  ↓  窗口名传 CLSID，ATL 内部 CoCreateInstance + 建站点 + DoVerb
AtlAxGetControl(hwnd, &pUnk)
  ↓  取回已初始化的控件
QI(IMsRdpExtendedSettings) → put_Property("ConnectToChildSession", TRUE)
QI(IMsTscNonScriptable)   → put_ClearTextPassword(pwd)   [vtable 第 3 项]
IDispatch::Invoke(Connect) → 连接
  ↓
WinStationCreateChildSessionTransport 提供传输通道
  ↓
CreateProcessAsUser 把 host 放进会话
```

关键证据（从 `workbuddy-cu-child-creator.exe` 的导入表与字符串提取）：

| 证据 | 含义 |
| --- | --- |
| `atl.dll` 在导入表 | 用 ATL |
| `standaloneminiatl.dll` | 静态链接的迷你 ATL（可见其构建方式） |
| `AtlAxWinInit` | 初始化 ATL 的 ActiveX 宿主支持 |
| `AtlAxWin`（含 `AtlAxWinH9` 变体） | 宿主窗口类名 |
| `AtlAxGetControl` | 从宿主窗口取出控件 |
| `OleInitialize` | OLE 初始化 |
| `{8B918B82-7985-4C24-89DF-C33AD2BBFBCD}` | **`CLSID_MsRdpClient9`** |
| `C://Windows//System32//mstscax.dll` | 控件本体 |
| `src\child_session\rdp.rs` | 源码路径（Rust 实现） |

#### 我上一节错在哪

我用 `CoCreateInstance` 直接拿控件，然后手写 OLE 站点接口——那是**重复造 ATL 已经做好的事**。
正确做法是让 ATL 的宿主窗口替我们完成初始化，再从窗口里取回控件。

**实测这条路的可行性**（本机，纯 koffi）：

| 步骤 | 结果 |
| --- | --- |
| `OleInitialize` | `0x0` |
| `atl.dll` 加载 + `AtlAxWinInit` | 成功（返回非零） |
| `CreateWindowExW("AtlAxWin", CLSID_MsRdpClient9)` | **hwnd 有效** |
| `AtlAxGetControl` | **`0x0`，拿到控件** |
| `QI(IMsRdpExtendedSettings)` | `0x0` |
| `put_Property("ConnectToChildSession", TRUE)` | **`0x0`** |
| `QI(IMsTscNonScriptable)` + `put_ClearTextPassword("")` | **`0x0`** |

**所以 ATL 宿主路线在纯 Node + koffi 下完全可行**，不需要写 C++，也不需要一个 GUI 框架。
上一节的「工作量与协议栈同量级」判断是错的。

#### 弄清了一个关键的通道分工

`IMsRdpExtendedSettings` 的具名属性（`put_Property`）**只接受它自己那份清单**：

| 属性 | 结果 |
| --- | --- |
| `ConnectToChildSession` | ✓ 可写 |
| `DisableCredentialsDelegation` | ✓ 可写 |
| `EnableFrameBufferRedirection` | ✓ 可写 |
| `ManualClipboardSyncEnabled` | ✓ 可写 |
| `DeviceScaleFactor` / `DesktopScaleFactor` | ✓ 可写 |
| `EnableHardwareMode` / `IgnoreCursors` | `0x8000ffff`（正常：它们是仅写入属性） |
| `DesktopWidth` / `DesktopHeight` | **不在这个清单里** |

`DesktopWidth` / `DesktopHeight` 是 `IMsTscAx` 的普通属性（`DISPID=12/13`），
走 `IDispatch` 而不是 `put_Property`。这两个名字容易混，实测确认过。

#### 仍未解开的一环：`Connect()` 报 E_INVALIDARG

**补充排查（同日）：先建传输通道再连接，结果不变。**

假设是「控件需要 `WinStationCreateChildSessionTransport` 的通道先就位」。
实测流程：建通道（`hr=0x0`）→ `CreateFile` 连上并保持句柄 → 创建 ATL 宿主窗口
→ 设 `ConnectToChildSession`（`0x0`）→ 注入凭据（`0x0`）→ `Connect()`。

结果仍是 `DISP_E_EXCEPTION`，`scode = 0x80070057`（`E_INVALIDARG`）。
说明 ATL 控件内部自己会建传输通道，外部的通道对它没有影响。

另一个尝试：从 `mstscax.dll` 的类型库读 `IMsTscAx` 的 vtable 位置。
`LoadTypeLibEx` 返回 `0x0`（成功），但 `GetTypeInfoCount` 取到的不是类型数
（返回 `0x76`，像是指针低位），说明 `ITypeLib` 虚表布局判断有误。
`FindName` 返回成功但 `found=0`，同样是参数索引问题。
这条路的收益已低于成本，暂时搁置。


当前状态：宿主窗口与控件都正常，`ConnectToChildSession` 与凭据注入都返回 `0x0`，
但 `Connect()` 返回 `DISP_E_EXCEPTION`，`EXCEPINFO.scode = 0x80070057`（`E_INVALIDARG`）。

已排除的方向：

| 尝试 | 结果 |
| --- | --- |
| 不设 `Server` 直接连 | 同样 `E_INVALIDARG` |
| 设 `Server="localhost"`（IDispatch） | `0x80020003` 不可写 |
| 设 `UserName` / `Domain`（IDispatch） | `0x80020003` 不可写 |
| 把 `DesktopWidth/Height` 走 `put_Property` | `0x8000ffff` |

`Server` / `UserName` / `Domain` 这三个属性在 `IDispatch` 上**只读**，
而 `IMsTscAx` 的 vtable 索引没有权威依据——**不会去猜**。
猜错的后果是 `0xC0000005` 崩溃（本规格已在这上面栽过两次）。

#### 下一步的正确做法

`IMsTscAx` 的 IID 与 vtable 顺序可以从 `mstscax.dll` 的类型库（TLB）里读出来，
或用 `OleLoadTypeInfo` 反查。那是确定性的信息来源，不需要猜。

具体可行方案：`LoadTypeLib("mstscax.dll")` → 遍历接口 → 读 `IMsTscAx` 的
方法表 → 得到 `put_Server` / `put_UserName` 的准确 vtable 位置。
这一步没有做，但它是纯查表，不涉及猜测。

#### 结论修正

**ATL 宿主路线可行，且不需要 C++ 或 GUI 框架。** 剩下的只是把
`IMsTscAx` 的 vtable 位置从类型库里查准。这比引入 FreeRDP 轻得多。

### 1.31 打通整条 ActiveX 链路：missing Server 是唯一拦路虎（2026-11-19）

§1.30 停在 `Connect()` 报 `E_INVALIDARG`。这一轮找到了根因，整条链路已实现。

#### 根因：`Server` 是 Connect 前必须设置的唯一属性

MSDN 的 `IMsTscAx::Server` 页有一句关键说明：

> **必须在调用 Connect 方法之前设置此属性。它是在连接之前必须设置的唯一属性。**

不设它时 `Connect()` 返回 `DISP_E_EXCEPTION` + 内层 `scode=0x80070057`（E_INVALIDARG）——
那个错误码**完全不提缺哪个属性**，是本模块最耗时的一个坑。

#### 但 `Server` 不能走 IDispatch

`Server` / `Domain` / `UserName` 三个属性在 `IDispatch` 上全部返回
`DISP_E_MEMBERNOTFOUND`（`0x80020003`）——DISPID 能解析（1/2/3），但属性不可写。
必须走 `IMsTscAx` 的虚表。

`IMsTscAx` 是双接口，vtable 布局：
`0-2 IUnknown` + `3-6 IDispatch` + `7起 IMsTscAx 方法`。
方法顺序取 MSDN 的 `IMsTscAx` 页列出的 vtable 顺序：

| vtable | 方法 |
| --- | --- |
| 7 | `put_Server` |
| 8 | `get_Server` |
| 9 | `put_Domain` |
| 10 | `get_Domain` |
| 11 | `put_UserName` |
| 12 | `get_UserName` |
| 13 | `get_Connected` |

`IID_IMsTscAx = 8C11EFAE-92C3-11D1-BC1E-00C04FA31489`

#### 完整链路实测（全部 `0x0`）

```
OleInitialize                                  → 0x0
atl.dll + AtlAxWinInit                         → 成功
CreateWindowExW("AtlAxWin", CLSID_MsRdpClient9) → hwnd 有效
AtlAxGetControl                                → 0x0，拿到控件
QI(IMsTscAx)                                   → 0x0
  put_Server("localhost")  vtable[7]           → 0x0
  put_Domain("")           vtable[9]           → 0x0
  put_UserName(name)       vtable[11]          → 0x0
QI(IMsRdpExtendedSettings)
  put_Property("ConnectToChildSession", TRUE)  → 0x0
QI(IMsTscNonScriptable)
  put_ClearTextPassword(pwd) vtable[3]         → 0x0
IDispatch::Invoke(Connect, DISPATCH_METHOD)    → 0x0  ← 之前是 E_INVALIDARG
之后 Connected                                 → 2（connecting）
     ExtendedDisconnectReason                  → 0（无错误）
```

**整条链路在纯 Node + koffi 下打通，不需要 C++、不需要 GUI 框架、不需要 SYSTEM。**

#### 当前唯一未完成：认证

`Connected` 停在 2（connecting），`ExtendedDisconnectReason=0`（无错误），
30 秒内未完成，会话未出现。

空密码认证在本机未能完成。这**不是代码问题**——链路每一环都返回成功，
只是认证环节没有走通。可能原因：子会话登录不走 `LimitBlankPasswordUse`
覆盖的路径，或该账户实际有密码。

把真实密码传进来即可继续。模块如实返回
`reason: "connect_pending"` + `connectionState: 2`，不谎称会话已建立。

#### 这个模块交付了什么

| 能力 | 状态 |
| --- | --- |
| ATL 宿主窗口 + OLE 初始化 | ✅ 实测通过 |
| 控件获取与接口 QI | ✅ 实测通过 |
| `Server`/`Domain`/`UserName` 设置 | ✅ 实测通过（vtable，有文档依据） |
| 子会话模式开启 | ✅ 实测通过 |
| 密码注入（含空密码） | ✅ 实测通过 |
| `Connect` 调用 | ✅ 实测通过 |
| 认证与会话建立 | ⏸ 待真实密码 |

全部 vtable 索引都有 MSDN 依据，**没有一处猜测**。
这一点在本规格里是硬规矩——猜索引的后果是 `0xC0000005`，连错误码都不给。

### 1.32 用专用测试账户验证认证环节（2026-11-19）

§1.31 打通了除认证外的全部环节。要验证认证需要一次真实密码。
不索取用户主账户密码，改用专用测试账户——这样即使密码泄漏，
影响面也只限于一个只用于测试的账户。

#### 为什么不能自动建账户

本机安全策略把用户管理类命令列为敏感操作（`schtasks.exe`、`reg.exe`
已在 `sandbox.programBlacklist`，`net user` 同样被拦）。
**这一步必须由用户手动完成。**

#### 手动建账户（`lusrmgr.msc`）

1. `Win + R` → 输入 `lusrmgr.msc`
   （家庭版若打不开，用 `Win + X` → 计算机管理 → 本地用户和组 → 用户）
2. 右键 → 新用户
3. 用户名 `cua_test`，描述写清用途
4. 密码自定并记下来
5. 三个复选框：**取消**「用户下次登录时须更改密码」，
   **勾选**「用户不能更改密码」与「密码永不过期」
6. 创建

**家庭版注意**：`Remote Desktop Users` 组在本机不存在（§1.28 实测）。
不需要那个组——子会话走 `WinStationCreateChildSessionTransport` 的
进程内管道，不是标准 RDP 服务端。

#### 验证脚本：密码不进对话

`scripts/cua-verify-child-session.mjs`

```bat
set CUA_TEST_USER=cua_test
set CUA_TEST_PASSWORD=你的密码
node scripts/cua-verify-child-session.mjs
```

**为什么用环境变量而不是命令行参数**：命令行参数会出现在进程列表里，
同机其他用户可见；环境变量只在进程自己的环境块里，也不会落进 shell 历史。
这不是绝对安全（同用户权限仍可读），但代价明显更低。

脚本不写任何文件、不持久化密码，跑完即弃。
输出里也只有「已提供（N 字符）」，不回显密码本身。

#### 脚本会报告什么

| 输出项 | 用途 |
| --- | --- |
| 子会话开关状态 | 前置检查 |
| 运行前是否已有子会话 | 避免把「复用旧会话」当成成功 |
| 结果 + 耗时 | 判断是快失败还是超时 |
| 原因码 | 区分 `connect_rejected`（认证被拒）与 `connect_pending`（超时） |
| 连接状态 | 0=断开 1=已连接 2=连接中 |
| 复查 + 额外 20 秒观察 | 有些情况下会话异步出现 |

#### 若成功的判据

`reason` 为空且 `sessionId` 有值，同时复查时 `WTSGetChildSessionId`
返回一个不是 `0xFFFFFFFF` 的值。三者一致才算成功——
只看 `ok: true` 不够，因为那可能是复用了已存在的会话。

### 1.33 真实密码验证：卡在「会话不存在」而非认证（2026-11-19）

用户建了 `test` 账户（`net user test test /add`）并提供密码。用真实密码验证，
结果仍是失败——但这次拿到了明确的机制性结论。

#### 发现一：消息泵是必需的

第一版实现用 `Atomics.wait` 阻塞等待，`Connected` **永远停在 2（connecting）**，
等 60 秒也不变。

原因：**RDP 控件是异步的，靠向宿主窗口投递窗口消息推进状态机。**
不抽消息就不会有新消息产生——这不是「等久一点」的问题，是事件循环问题。

加入 `PeekMessage` + `TranslateMessage` + `DispatchMessage` 循环后：

| 指标 | 不抽消息 | 抽消息 |
| --- | --- | --- |
| `Connected` 终态 | 永远 2 | 约 17 秒后变 0 |
| 模块返回的原因码 | `connect_pending`（超时） | `connect_rejected`（明确断开） |
| 耗时 | 30.4s（等满超时） | **17.2s** |

这是实质改进：从「死等 30 秒后说不知道」变成「17 秒内明确说连接被断开」。

#### 发现二：`ConnectToChildSession` 不创建会话

真实密码 + 消息泵之后，连接在约 17 秒后回到 `Connected=0`，
且 `ExtendedDisconnectReason=0`（**无错误**）。

这个组合（正常断开 + 无错误原因）说明：控件**尝试连到一个不存在的子会话**，
超时后放弃。17 秒与 RDP 连接超时吻合。

**结论：`ConnectToChildSession` 的语义是「连到已存在的子会话」，不是「创建子会话」。**

子会话必须由 RDP 服务端完成一次真实登录才会出现。而本机是
**Windows 11 家庭版，3389 完全不监听**（§1.28 实测），没有 RDP 服务端。

#### 这解释了 WorkBuddy 为什么要用计划任务

回看它的二进制字符串：`wincua-child-host-autorun`、
`<StateChange>RemoteConnect</StateChange>`、`<LogonType>InteractiveToken</LogonType>`、
`<RunLevel>LeastPrivilege</RunLevel>`。

它建了一个**用户级**计划任务，触发器是「远程连接建立」事件。
当用户通过某种方式在子会话里登录时，这个任务被触发，host 随之启动。

也就是说：**它自己没有「创建会话」的能力，而是借一次真实登录把会话拉起来。**
这与我原先以为的「它自己建会话」不同。

#### 本实现的边界

| 能力 | 状态 |
| --- | --- |
| ATL 宿主 + OLE 初始化 | ✅ |
| `Server`/`Domain`/`UserName` 设置 | ✅ |
| 子会话模式开启 | ✅ |
| 密码注入（含空密码） | ✅ |
| `Connect` 调用 | ✅ |
| 消息泵推进状态机 | ✅ |
| **让子会话真正出现** | ❌ 需 RDP 服务端 + 一次真实登录 |

代码链路是完整的：任何一环失败都会给出具体错误码。
失败发生在最后一环「会话不存在」，而那一环不在本实现的职责内。

#### 若要在家庭版走通，需要做什么

必须让系统具备「在子会话里完成一次登录」的能力。三条路：

1. **`shutdown /r` 后由 `RemoteConnect` 触发的计划任务拉起**——
   需要建计划任务（`schtasks` 在本机被安全策略拦截）
2. **实现 RDP 客户端协议栈**（FreeRDP 的 `childsession`），
   自己完成登录握手——不需要 RDP 服务端，但要引 C 依赖
3. **升级到专业版/企业版**，获得完整 RDP 服务端

三条都超出「不改系统配置、不引第三方库」的约束。

### 1.34 FreeRDP 方案评估：管道服务端无响应，此路不通（2026-11-19）

要判断「引 FreeRDP 能否解决」，关键不在 FreeRDP 本身，而在
**`WinStationCreateChildSessionTransport` 那根管道的另一端有没有服务在响应**。
FreeRDP 只是「把协议栈塞进这根管道」，管道不通它也无解。

#### 决定性实测：管道可写但无响应

```
WTSIsChildSessionsEnabled                  → 1
WinStationCreateChildSessionTransport      → 0x0
管道: \\.\pipe\{FCE994C9-...}
CreateFile(FILE_FLAG_OVERLAPPED)            → 成功
WriteFile(X.224 Connection Request, 19 字节) → written=19（写成功）
等待 X.224 Connection Confirm               → 15 秒超时（WaitForSingleObject=258）
```

19 字节的 X.224 连接请求完整写进了管道，但**服务端 15 秒内一个字节都没回**。
`WaitForSingleObject` 返回 258 是 `WAIT_TIMEOUT`，不是错误——
说明管道句柄有效、写入成功，只是**没有任何进程在处理这些数据**。

#### 为什么 FreeRDP 也会失败

看 FreeRDP 的 `childsession.c` 就清楚了。它的核心只有一个函数：

```c
BIO* createChildSessionBio(void)
{
    HANDLE f;
    if (!createChildSessionTransport(&f))   // ← WinStationCreateChildSessionTransport + CreateFile
        return nullptr;
    BIO* lowLevelBio = BIO_new(BIO_s_namedpipe());   // ← 把这根管道包装成 BIO
    BIO_set_handle(lowLevelBio, f);
    BIO* bufferedBio = BIO_new(BIO_s_buffered_socket());
    bufferedBio = BIO_push(bufferedBio, lowLevelBio);
    return bufferedBio;
}
```

**它只做传输层封装，不做协议握手。** 拿到 BIO 之后要交给 FreeRDP 的
完整 RDP 客户端（`freerdp_connect` 那条路），由它去协商、认证、建立通道。

换句话说：**FreeRDP 和我的实现用的是同一根管道、同一个服务端。**
管道无响应，两边都会卡在同一处。

#### 那这根管道何时才会有服务端

回看 WorkBuddy 的字符串，答案是 **`restart TermService`**：

```
[setup] [4] TermService
restart TermService
OpenSCManagerW / OpenServiceW / ControlService
SYSTEM\CurrentControlSet\Services\TermService
TERMSRV/localhost
```

`termsrv.dll`（远程桌面服务）负责在管道另一端提供子会话支持。
`WinStationCreateChildSessionTransport` 只是**建了一个管道端点**，
真正的协议服务由 `TermService` 提供。而 `TermService` 需要
**在启用子会话之后重启一次**，才会把子会话支持加载进去。

这也解释了 WorkBuddy 为什么把这个动作放在「一次性 setup」的第 4 步，
以及为什么要用户点 UAC 授权——`ControlService` 重启系统服务需要管理员权限。

#### FreeRDP 方案的成本（即便管道通了）

| 项目 | 代价 |
| --- | --- |
| 构建工具链 | Visual Studio + CMake + vcpkg |
| 第三方依赖 | OpenSSL、zlib、libjpeg-turbo、ffmpeg、libusb（vcpkg 装） |
| 产物体积 | `libfreerdp3.dll` + `winpr3.dll` + 依赖 dll，通常 10–20 MB 级 |
| 接入方式 | 写 C++ addon（node-gyp）或做独立可执行 + 子进程通信 |
| 分发 | 要带一串 dll，且需处理 VC++ 运行时 |
| 许可 | Apache-2.0，商用需保留版权声明与 NOTICE |
| 维护 | 跟随上游版本，处理 ABI 变化 |

#### 结论：两条路都卡在同一处，且都不该由本实现打通

| 路线 | 卡在哪 | 能否绕过 |
| --- | --- | --- |
| ActiveX（已实现） | 管道无服务端 | 需 restart TermService（要管理员，`sc.exe` 被安全策略拦） |
| FreeRDP（评估） | **同一个管道无服务端** | 同上，且额外背 10–20 MB 依赖 |

**FreeRDP 不是「换一条路」，而是「在同一条路上换一辆车」。**
路本身没通。

#### 这个评估的净收益

省掉了一件代价很大的错事：如果先按「引 FreeRDP」的直觉动手，
会花几天时间编译依赖、写 addon，最后发现管道仍然无响应——
而那时已经很难判断是「FreeRDP 接错了」还是「管道本来就不通」。

先花 20 分钟验证管道，比事后排查便宜得多。

### 1.35 真相：子会话靠计划任务创建，不靠 RDP（2026-11-19）

用户解除了 `schtasks.exe` 的拦截，并实测 WorkBuddy 的电脑控制在本机可用。
据此重新观察系统状态，**推翻了 §1.33 / §1.34 的核心判断**。

#### 观察到的实际状态

```
WTSGetChildSessionId          → 6
会话 #6                        → Disconnected
会话 #6 UserName               → lecoo（与主会话同账户）
会话 #6 ClientProtocolType     → 0（非 RDP 协议）
3389 监听                      → 始终未监听
workbuddy-cu-child-host 进程   → PID 33548，SessionId=6
```

会话 #6 里有一整套桌面进程：`winlogon`、`csrss`、`dwm`、`explorer`、
`rdpclip`、`ctfmon`、`StartMenuExperienceHost`……**是一个完整登录的桌面**。

#### 它的计划任务定义（导出 XML 得到）

```xml
<Principals>
  <Principal id="Author">
    <UserId>S-1-5-21-...-1001</UserId>
    <LogonType>InteractiveToken</LogonType>       ← 不是 SYSTEM
  </Principal>
</Principals>
<Triggers>
  <LogonTrigger><UserId>DESKTOP-SG076J5\lecoo</UserId></LogonTrigger>
  <SessionStateChangeTrigger>
    <StateChange>RemoteConnect</StateChange>      ← 关键
    <UserId>DESKTOP-SG076J5\lecoo</UserId>
  </SessionStateChangeTrigger>
</Triggers>
<Actions>
  <Exec>
    <Command>C://WINDOWS//System32//conhost.exe</Command>
    <Arguments>--headless "<...>\workbuddy-cu.exe" --child-host-launcher</Arguments>
  </Exec>
</Actions>
<Settings>
  <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
  <Hidden>true</Hidden>
</Settings>
```

#### 修正此前两个错误判断

| 原判断（§1.33 / §1.34） | 实际 |
| --- | --- |
| 「子会话需 RDP 服务端完成真实登录」 | **不需要**。3389 全程未监听，`ClientProtocolType=0` |
| 「管道无响应是因为没 `restart TermService`」 | **不是**。管道无响应是因为**会话根本不存在**；会话存在后机制才成立 |
| 「FreeRDP 也救不了」 | 结论仍成立，但**理由错了**：不是因为服务没重启，是因为这条路本来就不该走管道 |

#### `workbuddy-cu.exe --child-host-launcher` 才是枢纽

它的二进制里有：

```
DuplicateTokenEx
CreateProcessAsUserW
--spawn-host-user  --spawn-host-elevated  --spawn-host-system
--isolate-desktop
```

**launcher 自己会 `DuplicateTokenEx` + `CreateProcessAsUser`。**

也就是说完整的链路是：

```
计划任务（SessionStateChange=RemoteConnect）
  ↓ 把 conhost + launcher 投进目标会话
launcher 在会话内运行
  ↓ DuplicateTokenEx（复制自身令牌）
  ↓ CreateProcessAsUser（**同会话**创建，不需要改 TokenSessionId）
host 在会话内运行
```

**关键：`CreateProcessAsUser` 是在同一会话内创建进程，
不需要 `SetTokenInformation`，因此不需要 `SeTcbPrivilege`。**

这是一个此前完全没看到的解法：绕过特权的方式不是「提升权限去改会话」，
而是「先让一个进程落进目标会话，再在会话内派生」。

#### 本实现新增 `helper/child-session-task.ts`

| 能力 | 说明 |
| --- | --- |
| `registerChildSessionTask` | 注册/覆盖任务（XML 方式，幂等） |
| `queryChildSessionTask` | 查状态 |
| `runChildSessionTask` | 立即触发 |
| `unregisterChildSessionTask` | 注销（幂等） |
| `ensureChildSession` | 注册 + 运行 + 等会话，并区分「新建」与「复用」 |

任务 XML 与 WorkBuddy 逐项对齐（实测导出核对）：

```
✓ RemoteConnect 触发器      ✓ 绑定 UserId
✓ InteractiveToken          ✓ PT0S 不限时
✓ Parallel                  ✓ conhost --headless
✓ 未声明 SYSTEM
```

#### 两个实测踩到的坑

1. **`schtasks` 的输出是 GBK，不是 UTF-8。**
   按 `utf8` 解码得到 `����`，任何基于文本的状态判断全部失效。
   要用 `new TextDecoder("gbk")`。
2. **`SessionStateChange` 必须是 `RemoteConnect`，且触发器要绑 `UserId`。**
   我先用了 `SessionUnlock` 且没绑用户，结果任务跑了但进程落在**主会话 1**，
   会话没有出现。这两个字段缺一不可。

#### 当前边界

`ensureChildSession` 已能注册出完全对齐的任务定义（9/9 项核对通过）。
真正让会话出现还需要 `RemoteConnect` 事件，而那个事件需要
一次真实的远程连接建立——本脚本无法伪造。

也就是说：**代码路径已完整，触发条件需要真实使用场景。**

### 1.13 实现阶段补充实测（P1 / P2）

2026-11-19，实现 P1（观察）与 P2（一级派发）时验证的三条宿主特性：

**① Chromium 的渲染进程无障碍树默认懒构建**

不显式请求时，UIA 只能看到浏览器外壳（菜单栏 + 标题栏，约 15 个节点），
看不到网页内容。需要 `--force-renderer-accessibility` 启动开关（或由辅助功能请求触发）
才能暴露完整树（实测从 15 节点变为 24 节点，复选框可见）。

**产品含义**：对 Chromium 系应用（Chrome / Electron / Tauri）做观察前，
必须确保该开关生效，否则模型会误判「这个应用没有界面内容」。

**② Chromium 的网页元素没有独立 NativeWindowHandle**

整个网页内容区只有**一个** HWND，DOM 元素是渲染出来的、不是原生窗口。
实测复选框元素的 `NativeWindowHandle` 为 0。

**实现要求**：动作解析 HWND 时必须回退到「窗口根 HWND」，再靠坐标做最深子窗口解析。
只在元素自身有 HWND 时用元素句柄。收据里记录 `hwndSource`（`element` / `windowRoot`）
便于诊断。

**③ 消息投递在 Chromium 上端到端可用（P2 验收数据）**

| 项 | 结果 |
| --- | --- |
| 连点 5 次复选框 | `ToggleState` 稳定交替 `On→Off→On→Off→On` |
| 光标位置 | `(1714,632)` → `(1714,632)`，未移动 |
| 前台窗口 | pid 未变化 |
| 过期 `stateId` | 正确拒绝（`state_invalidated`） |
| 越界元素索引 | 正确拒绝（`element_unavailable`） |

**④ P1 观察链路验收数据**

记事本（Win32，44 节点）：枚举 20 个窗口 91ms、采集 106ms、DSL 输出 43 行、
差分无变化正确返回 `(no change) focus=文本编辑器`、预算截断（maxNodes=5）与
deadline（1ms）均正确触发。

### 1.14 COM 互操作的两个致命陷阱（P4 实现实测）

实现二级派发时踩到两个都会导致 **Helper 进程无日志崩溃**（`0xC0000005`
ACCESS_VIOLATION）的问题。它们的共同特征是：第一次调用成功、第二次崩溃，
崩溃点落在后续无辜调用上（因为破坏的是堆），排查成本极高。

**① 虚表必须按需读取单项，不能整表解码**

`vtableEntry` 曾用 `koffi.decode(vtable, koffi.array("void *", 48))` 一次读 48 项。
`IUIAutomationElement` 有 40+ 方法所以没事，但 pattern 接口很短
（`IUIAutomationSelectionItemPattern` 只有 8 项），越界读到未映射内存后
破坏堆，下一次分配即崩。

修法：`koffi.array("void *", index + 1)` 只读到需要的下标。
另需显式判空（`comObject` / `vtable` 都可能为空）。

**② `GetCurrentPattern` 返回的指针必须先过 QueryInterface 才能用**

这是 Electron 环境特有的问题。对照实验（同一进程、同一元素、同一 pattern）：

| 调用序列 | 结果 |
| --- | --- |
| 直接 `Select()` | 崩溃 `0xC0000005` |
| `AddRef()` 后 `Select()` | 崩溃 `0xC0000005` |
| **`QueryInterface(IID_IUnknown)` 后 `Select()`** | **成功 `S_OK`** |
| 纯 Node 环境直接 `Select()` | 成功（不崩） |

推测原因：`GetCurrentPattern` 的 out 参数在 koffi 侧被当作裸值，
该接口指针的 COM 引用未被正确建立；QueryInterface 的调用让 COM 运行时
完成了必要的内部登记。**推测不确证，但结论稳定可复现。**

因此 `getPattern()` 内部强制调用 `stabilizeComInterface()`——这不是可选优化，
是使用 pattern 的必需前置。

**③ 另一个同源陷阱：`GetCurrentPattern` 对不支持的 pattern 返回 S_OK 但空指针**

只判断 HRESULT 会把 `null` 当有效指针传给 `koffi.call`，同样是空指针解引用崩溃。
判断依据必须是「HRESULT 成功 **且** 指针非空」。

**④ `koffi.proto` 按名字全局注册，不能定义在函数内**

同一进程内重复定义同名 proto 抛 `Duplicate type name`。这个坑在开发中出现三次
（每次都是某个函数体内定义 proto，调用两次就炸），最终以
`src/helper/protos.ts` 集中注册解决——所有 proto 在模块加载时定义一次。

### 1.15 P4 预算与降级验收数据

2026-11-19，Electron 测试窗口（Chromium 宿主）：

| 场景 | 路径 | 激活窗口 | 光标 | 动作生效 |
| --- | --- | --- | --- | --- |
| `quiet` 预算 | `post_message` | 否 | 未移动 | 是 |
| `balanced` + `preferPath=ax` | `ax` | **是** | 未移动 | 是 |
| `quiet` 下请求 `ax` | 回落 `post_message` | 否 | 未移动 | 是 |

预算约束生效：`quiet` 下即使显式请求 `ax` 也会回落到一级，不会越权。
二级的语义动作选择正确（复选框 → `select`，普通按钮 → `press`）。

### 1.16 P5 三级物理注入与保活验收数据

2026-11-19，Electron 测试窗口（Chromium 宿主，带可读回状态的复选框）：

| 场景 | 结果 |
| --- | --- |
| 未授权 + `unrestricted` + 强制三级 | 拒绝 `authorization_required`，光标未动，状态未变 |
| 已授权 + `balanced` + 强制三级 | 拒绝 `foreground_required`，光标未动 |
| 上下文 `quiet` + 参数里传 `budget=unrestricted` | **拒绝**，实际预算仍为 `quiet` |
| `unrestricted` + 已授权 + 强制三级 | 执行，复选框 `0→1`，**光标还原**，**前台还原** |
| 重复执行 | 再次翻转 `1→0`，光标仍还原 |

三级路径的关键实测结论：

- **连续两次注入都真实生效且每次都还原**，不是「运气好一次」
- `grabbed_input=true` 与 `cursor_restored=true` 都进收据，用户可追溯
- 收据文本同时给人和给模型：`grab_input=true cursor_restored=true`
- 还原顺序必须先前台后光标——先恢复前台时系统会把光标带进新窗口，
  之后再设光标位置才准确

**模型参数无法提权**这条得到了运行时证明：即使模型在工具参数里写
`budget: "unrestricted"`、`allowPhysicalInjection: true`，实际生效的仍是
会话上下文里的 `quiet`。预算与授权都只从 context 读。

### 1.17 保活的一个致命实现缺陷（P5 实测）

`helper-client` 最初用 `restartAttempted: boolean` 记录「已尝试过重启」，
在 `start()` 入口置 true 且**永不重置**。后果：

```
首次启动成功 → restartAttempted = true
用户杀掉 Helper → ensureReady 探活失败 → 调 start() → 看到 true → 直接熔断
```

**崩溃恢复功能等于不存在**：任何一次崩溃都会立刻熔断，而不是重启。

正确做法是把「一次性」改成「连续失败计数 + 成功清零」：

| 字段 | 语义 |
| --- | --- |
| `consecutiveStartFailures` | 本轮连续启动失败次数，成功启动即归零 |
| `MAX_START_ATTEMPTS = 2` | 连续失败 2 次即熔断 |

另外一条同样重要的语义区分：**探活失败不算启动失败**。
探活发现进程已死是「恢复路径」，此时应清零计数后重新拉起；
把它计入失败会让「用户手动杀进程」直接导致熔断。

修完后的实测：

| 场景 | 结果 |
| --- | --- |
| 空闲 1.2s 后 Helper 自行退出 | ✓ |
| 外部 `taskkill /F` 后自动恢复 | ✓ 新 pid，uptime 归零 |
| 重启后旧 `stateId` | ✓ `state_invalidated` |
| 入口不存在时连续 3 次调用 | 失败 3/3，第 3 次 0ms（已熔断不再尝试） |
| 探活延迟（10 次） | 平均 0.26ms，最大 0.54ms |

### 1.18 强制路径必须是硬性要求，不能静默回落

P5 验收发现：`preferPath` 最初只做「偏好」处理——请求的路径不可用时
静默回落到其他候选。这违反了 spec §3.3 的「不静默切换路径」。

后果很具体：调用方明确要求走三级（抢键鼠）但未授权时，如果静默改成一级，
用户看到的是「操作成功了」而实际上没有任何窗口被激活、目标也没被点中，
「为什么没生效」变得无法解释，同时掩盖了权限配置错误。

修正后的规则：

| 情况 | 行为 |
| --- | --- |
| 未指定 `preferPath` | 按优先级挑最不打扰的可行路径 |
| 指定了且可行 | 走指定路径 |
| 指定了但不可行 | **报错**，说明原因，不回落 |

错误文本要区分三种原因，因为模型的下一步动作完全不同：

| 原因 | code | 模型该做什么 |
| --- | --- | --- |
| 未授权 | `authorization_required` | 告知用户去设置里开，不要重试 |
| 预算不足 | `foreground_required` | 换等效操作，或告知用户需放宽预算 |
| 无坐标/无语义动作 | `foreground_required` | 重新观察或换目标元素 |

错误收据里还要带 `requested_path` 与 `budget`，否则审计时说不清
「我是按哪条路走的、为什么被拒」。

## 9. 待定项

| 项 | 说明 |
| --- | --- |
| 成功路径披露粒度 | 是否告知「本次通过物理注入完成」，或只进元数据 |
| 应用能力画像的生成方式 | 静态表 vs 首次遇到时探测并缓存 |
| 四级（提权注入）的 UAC 时机 | 按需启动 vs 任务开始前预启动 |
| 权限预算的 UI 形态 | 输入框旁开关 vs 设置项 vs 每任务询问 |
| macOS | 本规格不含。设置页需改为明确「暂不支持」，避免假开关 |

## 10. 未覆盖

| 情况 | 原因 |
| --- | --- |
| 屏幕锁定 / 已注销 | 无交互桌面，输入无处可去 |
| UAC 弹窗 / Winlogon 桌面 | 独立安全桌面，设计上禁止自动化 |
| 跨用户会话 | 会话隔离（§1.3 同理） |
| DRM 保护内容 | 截图与读屏均不可得 |
| 远程 / SSH 工作区 | 目标不在本机，两条链路均只作用本机 |
| Linux | 不在本规格范围 |
| macOS | 不在本规格范围 |
| 越会话操作（含 RDP 子会话） | 本机缺 `SeTcbPrivilege`，无法改令牌会话 ID；见 §1.23 的边界说明 |

上述情况一律**明确报告**，不重试。
