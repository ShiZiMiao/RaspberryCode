# Windows CUA 干扰预算与焦点语义探针报告

> 状态：已完成取证（2026-11-21）。被测版本：computer-use 0.6.5。
> 环境：Windows 11 Pro 26H2（NT 10.0.26300.9974）x64。
> 相关实现：[dispatch-plan.ts](../../packages/raspberrycode-cua/src/helper/dispatch-plan.ts)、
> [handlers.ts](../../packages/raspberrycode-cua/src/runtime/handlers.ts)、
> [screenshot.ts](../../packages/raspberrycode-cua/src/helper/screenshot.ts)。

## 1. 目的与方法

三档干扰预算（`quiet` / `balanced` / `unrestricted`）是 CUA 的核心安全边界，但接入
文档长期把它简化成「不抢焦点」，没有区分**读取**和**动作**、也没有说明档位差异。
本探针取证三件事，为文档与实现提供事实依据：

1. 各档位下元素级动作对系统前台/键盘焦点/鼠标的真实影响；
2. `quiet` 档下动作失败的实际原因（是否等同于「目标不支持」）；
3. `include_screenshot=true` 对最小化窗口的行为。

**方法**：受控目标 + 独立只读探针 + 前后状态对拍。

- 目标 A：自建最小化 WinForms 窗口（TextBox `TargetBox` + Button `PingButton` +
  事件日志），用 `WM_GETTEXT` 读控件真实文本（`GetWindowText` 跨进程读不到子控件）。
- 目标 B：最小化 Notepad 的「添加新标签页」按钮，用于跨应用复核。
- 探针（独立进程，不参与 UI 自动化）：`GetForegroundWindow()`、
  `GetGUIThreadInfo()` 的 `hwndActive`/`hwndFocus`/`flags`、`GetCursorPos()`、
  `IsIconic()` 与窗口矩形。
- 每批次操作前恢复用户前台并采样，操作后立即采样。恢复前台用
  `AttachThreadInput` + `SetForegroundWindow`（裸调用会被前台锁拒绝），这是清理
  步骤，不是被测行为。

**档位生效的判据**：改 `setting.json` → **完整退出应用** → 重启，再用会被预算拒绝的
路径（如 `pressKey`）触发一次，读错误里的 `budget=` 字段确认实际派发档位。仅改设置
不重启时，已运行的 Host 仍用旧值。

## 2. 结论总表

| 档位 | 元素级动作对前台/键盘焦点 | 鼠标 | 动作结果 |
| ---- | ------------------------ | ---- | -------- |
| `balanced`（默认） | **改变**：前台切到目标隐藏子控件，`hwndFocus` 同步跟随，`flags` 含光标闪烁位 | 不动 | 成功 |
| `quiet` | **不变** | 不动 | 多数失败（见 §3.2） |
| `unrestricted` | 未取证（需显式授权物理注入，本次未开启） | — | — |

三档下**鼠标位置均不变**，`allow_physical_injection=false` 时 `event` / `pressKey`
均返回 `actionSent=false`。

## 3. 关键发现

### 3.1 UIA 动作 pattern 必然激活窗口，这不是实现选择

`balanced` 下对最小化窗口执行 `set_value`（bound 默认策略，以及显式
`strategy:"a11y"` 各一次）与 `left_click`（显式 a11y）：

- 动作**确实生效**：EDIT 真实文本改变（`WM_GETTEXT` 确认）；按钮日志新增
  `BUTTON_CLICKED`；Notepad 新标签页创建成功。
- 但 `GetForegroundWindow()` 变为目标控件的隐藏子窗口
  （`WindowsForms10.EDIT...` / `WindowsForms10.BUTTON...` / Notepad 的
  `InputSiteWindowClass`），`hwndActive`/`hwndFocus` 同为该子窗口，
  `flags=1`（光标闪烁）。
- 目标窗口 AX 树仍标 `offscreen`，WinForms 的 `Form.Activated` 未触发 ——
  不是常规整窗激活，而是**子窗口级焦点转移**，所以应用自己的激活日志看不到。
- 鼠标坐标与操作前一致。

这与 `patterns.ts` 文件头的既有记录一致：`Invoke` / `Toggle` / `ExpandCollapse` /
`SetFocus` 四个 pattern 全部会激活窗口，在 UWP 计算器、Win32 资源管理器、
agent-desktop 三个独立来源上一致复现。**读路径**（`getAXState` / `list_windows`）
不改变前台与焦点，已单独验证。

**结论**：元素级动作「语义精确、不动鼠标、不发输入」成立；「不动焦点」不成立。
Windows 上不存在「不要求焦点」的 UIA 动作 pattern，因此该副作用不可消除，
只能由预算档位决定是否允许发生。

### 3.2 `quiet` 下动作失败有两种不同原因，不能混为一谈

`quiet` 只允许 `POST_MESSAGE`（消息投递）。实测两类失败，错误文案不同，
**根因也不同**：

**其一：消息投递需要屏幕坐标，最小化窗口没有。**

`left_click` 最小化 WinForms BUTTON 与最小化 Notepad 均返回：

```
消息投递不可用（不在可用路径: 无）。可能该元素没有屏幕坐标。
requested_path=post_message
budget=quiet
```

对应 `dispatch-plan.ts` 的候选条件 `context.hasBounds`，而
`hasBounds: node.bounds !== undefined` —— 最小化窗口的 AX 元素不提供 bounds，
所以一级路径根本不进候选。

**其二：写值意图从不列入一级路径，与坐标无关。**

`setValue` 最小化 WinForms EDIT 返回：

```
当前预算（quiet）下该元素没有可用路径。可用语义动作: set_value。
budget=quiet
```

注意它**承认元素支持 `set_value`**，只是当前预算下无路径。原因是
`dispatch-plan.ts` 的设计：消息投递只能表达「在某坐标按下鼠标」，**无法写值**；
把一级排进写值候选会让模型拿到「动作已发出」的回执而文本框纹丝不动，属静默失败。
因此 `isWriteIntent` 为真时一级压根不列入候选。

**这意味着：`quiet` 下 `setValue` 在非最小化窗口上同样无路径**，不是「窗口最小化」
导致的。排查时按「坐标缺失」去还原窗口，不会让 `setValue` 变可用。

两种失败都是预算在按设计工作，不是故障：`actionSent=false`，动作未执行，
不应重试，也不应改走坐标路径绕过。

### 3.3 `include_screenshot=true` 不恢复最小化窗口

实测最小化 WinForms，两种预算下一致：

```json
{
  "hasImage": false,
  "blockTypes": ["text", "text"],
  "textTail": "...\n[screenshot unavailable: 窗口已最小化：客户区被销毁（ClientRect=0x0），无法采集画面。…]"
}
```

窗口矩形、前台、焦点、鼠标全部不变。对应 `screenshot.ts` 的 `IsIconic` 分支直接
返回 `ok:false`，不调用任何 `ShowWindow` / `SetWindowPlacement`。

同处注释记录了判据依据：最小化时 `ClientRect` 变成 `0x0`，客户区不再有绘图表面；
`PrintWindow` 仍返回成功但画出来只有标题栏。判据必须用客户区尺寸，不能用采样非黑
比例——最小化时按原尺寸采样会被桌面上别的窗口填充，比例反而更高（假阳性）。

## 4. 对文档与实现的修正

| # | 问题 | 处置 |
| - | ---- | ---- |
| 1 | 文档承诺动作「不抢焦点」 | 改为「会激活目标窗口并转移键盘焦点，但不移动鼠标、不发输入」 |
| 2 | 文档称 `include_screenshot` 会恢复最小化窗口 | 改为「不恢复，追加 `[screenshot unavailable: …]` 且不返回图片」 |
| 3 | 文档未区分三档预算的焦点行为 | 补对照表（`docs/computer-use.md` 新增 “Interference budget” 一节） |
| 4 | 文档未说明改预算需重启 | 同上，并说明「已运行的 Host 仍用旧值」 |
| 5 | bound API `list_windows` 只能拿到渲染文本 | `unwrapEnvelope` 在 text 非 JSON 时回退 `structuredContent` |
| 6 | `listApps()` 恒返回空 | `inventory` 在无 `apps` 字段时读 `structuredContent.windows` |

第 5、6 项的根因与回归：观察类工具的 `content` 是给人看的渲染行，结构化数据只在
`structuredContent`；`buildTextResult(text, structured)` 仅在传入第二参时才有后者。
`unwrapEnvelope` 原实现解析 JSON 失败即返回纯文本，把结构整份丢弃。
`inventory` 原实现只看 `parsed.apps` 与裸数组，而 Windows 自研 helper 上
`list_apps` 复用 `handleListWindows`，结构化字段名是 `windows` 而非 `apps`。
回归测试：`apps/raspberrycode-cli/packages/node-repl-host/test/cua-structured-envelope.test.ts`。

## 5. 未覆盖

- **`unrestricted` 档**：需显式授权物理注入，本次未开启，未取证。
- **非最小化后台窗口的 `quiet` 动作**：仅有坐标时 `POST_MESSAGE` 才进候选，
  本次最小化目标无坐标，未验证「有坐标但后台」的 WinForms/Win32 控件是否消费消息
  并成功执行。
- **Chromium 系目标的 `quiet` 行为**：未对宿主自身窗口取证，避免干扰取证环境。
- **`GetForegroundWindow` 的毫秒级时序**：批次内先观察再动作，采样在批次前后而非
  紧邻动作的毫秒级；纯观察不改焦点已由读路径用例单独验证。
- **键盘焦点转移后的实际按键落点**：结论基于 Win32 焦点状态
  （`GetForegroundWindow` + `GetGUIThreadInfo.hwndFocus`），未注入真实按键验证。
