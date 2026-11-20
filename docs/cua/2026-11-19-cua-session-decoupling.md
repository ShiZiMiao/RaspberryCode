# CUA 与 UI 会话解耦

## 状态

Draft — 基于 2026-11-19 对现有架构的核查。

## 需求

> A 任务启动了电脑控制，右侧显示画面。
> 切到 B 任务，A 的电脑控制不会断，可以继续执行自动化任务。

三条明确约束（用户确认）：

1. **同一窗口内切换任务**（点左侧任务列表），不是多窗口
2. **允许真并发**：A 在跑时切到 B，A 继续执行
3. **画面跟随当前任务**：右侧显示当前选中任务的桌面

## 现状核查结论

### 好消息：CUA 不在 renderer 里

CUA runtime 创建在 `node-repl-host` 进程的 `main()`：

```ts
// apps/raspberrycode-cli/packages/node-repl-host/src/server.ts:403
const computerUseRuntime = captureComputerUseRuntimeFromEnvironment();
```

它不依赖任何 BrowserWindow。**切换任务不会销毁 Host，因此 CUA 不会因 UI 切换而断。**

### 好消息：快照按窗口分桶，并发不会互相失效

`SnapshotStore` 以 `windowKey` 为桶，每窗口保留最近 8 份历史，
`findByStateId` 遍历所有历史查找。所以：

- 任务 A 观察窗口 X，任务 B 观察窗口 Y → **互不干扰**
- 任务 A 观察 X 后切走，B 操作 Y，再切回 A 操作 X → **A 的 stateId 仍有效**

这条能力是早前为「观察 A → 观察 B → 回去操作 A」实现的，
正好满足并发场景。

### 风险一：窗口关闭时 Host 被销毁

```ts
// packages/desktop/src/main/desktopWindowLifecycle.ts:264
win.on("closed", () => {
  options.disposeHostProcess(child, `${label}:window-closed`);
});
```

CUA 跟着 Host 一起没了。

**但这条对「同一窗口内切任务」不成立**——那个窗口不会关。

### 风险二：同窗口竞争（真实风险）

两个任务操作**同一个窗口**时共享同一份快照桶：

- A 观察 → 拿到 `state-5`
- B 观察同一窗口 → `state-5` 被新快照顶到历史里
- A 用 `state-5` 操作 → 仍能查到（历史里），但元素索引可能已变

现在的 `stateId` 校验能挡住「索引错位」，代价是 A 收到
`state_invalidated` 而失败。这不是数据损坏，是失败重试。

**结论：同窗口并发需要串行化，但不需要新的隔离层。**

## 设计

### 核心判断：不需要把 CUA 从 Host 里搬出去

考虑过「把 CUA 提到主进程或独立常驻进程」，理由是让 CUA 独立于窗口生命周期。
**核查后判定不需要**：

- 用户的需求是「同窗口内切换任务」，窗口不关闭，Host 不销毁
- CUA runtime 已经不在 renderer，与 UI 生命周期无关
- 搬出去会失去 `helper-registry` 的同进程复用（多一个 Helper、快照分裂）

**为一个不存在的问题引入常驻进程，是过度设计。**

### 需要补的三件事

#### 1. 操作串行化：同窗口的 CUA 请求必须排队

现状：无排队。两个任务的 `left_click` 可能交错发出。

设计：在 `helper-client` 的请求层加**按窗口的串行队列**。

```
任务 A 操作窗口 X  ─┐
                    ├─→ 窗口 X 的队列 → 逐个发出
任务 B 操作窗口 X  ─┘
任务 B 操作窗口 Y  ────→ 窗口 Y 的队列（与 X 并行）
```

**为什么按窗口而不是全局**：全局串行会让「A 操作窗口 X、B 操作窗口 Y」
也互相等待，那是没必要的。按窗口分隔既保证安全，又保留并发。

**为什么不能靠 stateId 校验代替排队**：校验只能事后拒绝，
不能防止「A 的点击和 B 的输入交错到同一次快照周期里」。

#### 2. 任务归属：每个动作要能追溯到发起它的任务

现状：`context.sessionId` 传进来了，但只用于日志。

设计：把它作为**队列的归属键**之一，并在失败时回报：

```ts
{
  path: "post_message",
  sessionId: "task-a",        // ← 新增：哪个任务发起的
  stateId: "state-5",
  queuedMs: 120,              // ← 新增：排队等了多久
}
```

`queuedMs` 很关键：用户问「为什么 B 操作变慢了」时，
能直接指向「在等 A 的同窗口操作」，而不是含糊的「性能问题」。

#### 3. 画面归属：右侧显示当前任务的桌面

这是 UI 层的事，但需要 CUA 暴露一个前提：**当前任务绑定的窗口是哪个**。

设计：`context` 增加 `targetWindow`（可选）。省略时按元素所在窗口推断。
右侧面板按当前任务的 `targetWindow` 决定渲染谁。

### 不做的事

| 不做的 | 理由 |
| --- | --- |
| 把 CUA 搬到常驻进程 | 同窗口切任务不触发窗口关闭，没必要 |
| 每个任务一个 Helper 进程 | 会让桌面出现多个助手进程、快照分裂 |
| 跨会话（子会话）操作 | 见 `2026-11-19-windows-cua-self-hosted-spec.md` §1.35，那是独立议题 |
| 全局串行 | 会牺牲不同窗口之间的并发，没必要 |

## 验收场景

1. **同窗口切任务，CUA 不断**
   A 启动 CUA → 观察窗口 X → 切到 B → 切回 A → **不出现 `helper_unavailable`**

2. **真并发：不同窗口不互相阻塞**
   A 操作窗口 X，B 操作窗口 Y，两者同时发出 → 都成功，且 `queuedMs` 都很小

3. **同窗口串行：不交错**
   A 和 B 同时操作窗口 X → 一个排队等待，`queuedMs > 0`，两者都成功

4. **快照不互相失效（不同窗口）**
   A 观察 X 拿 `state-1`，B 观察 Y 拿 `state-2`，A 用 `state-1` 操作 → 成功

5. **快照失效时原因明确（同窗口）**
   A 观察 X 拿 `state-1`，B 也观察 X，A 用 `state-1` → 返回
   `state_invalidated` 并说明「窗口已被另一次观察刷新」

6. **窗口关闭 → CUA 明确不可用**
   关掉承载任务的窗口 → 后续操作返回 `helper_unavailable`，
   不是静默失败

## 实施记录（2026-11-19）

### 已完成：串行化队列

新增 `runtime/window-lanes.ts`：

| 导出 | 作用 |
| --- | --- |
| `WindowLaneScheduler` | 跨窗口并发、同窗口串行 |
| `windowLanes` | 进程级单例（必须跨 runtime 实例共享） |
| `rememberStateWindow` / `windowKeyOfState` | `stateId → windowKey` 簿记 |

接入点在 `runtime/index.ts`：**写操作排队，读操作直连**。

```
写（排队）：left_click / type / key / scroll / left_click_drag /
            set_value / paste / perform_action / select_text
读（直连）：list_windows / get_app_state / capture
```

分界依据是「是否改变目标窗口的状态」。排队读操作只会让「两个任务同时观察」
变成串行，白等且没有正确性收益。

### 两处实现细节值得记下

**① `windowKey` 原本是 undefined（既有缺陷）**

`handlers.ts` 引用了 `snapshot.windowKey`，但 `UiaSnapshot` 接口里**没有这个字段**，
`tree.ts` 也从未赋过值。类型层面靠 `as` 蒙过去了。

修法：在 `UiaSnapshot` 加字段，构造时填。取值顺序：

1. 根元素的 `NativeWindowHandle` → `hwnd-0x...`
2. 取不到则退到 `pid-<pid>:<标题>`

实测 Electron 窗口走的是**第三层**——UIA 直接给出了 RuntimeId 形式的键
（如 `42.1181988`），比 HWND 和 pid 都更精确。

**② 队列必须在动作层，不能在请求层**

「这个动作属于哪个窗口」是动作的知识。请求层只看到 `method` 和 `params`，
在请求层排队会退化成全局串行——那就失去了跨窗口并发。

### 验收结果

```
调度器语义（单元级）        15/15
两任务并发（端到端）        13/13
既有能力回归                7/7
切任务不断（遮挡场景）      18/18
最小化能力边界              9/9
```

端到端验证了需求的核心场景：

| 场景 | 结果 |
| --- | --- |
| A、B 同时操作各自窗口 | 48ms 完成，未翻倍（真并发） |
| A 与 B 的 windowKey 不同 | `42.1181988` vs `42.2626236` |
| **切到 B 后 A 用旧 stateId 仍成功** | 通过（这是原问题） |
| A 的写入生效、B 的也没被覆盖 | `A写入` / `B写入` |
| 同窗口两次点击都成功 | 原地排队，不交错 |

#### 真实切任务形态（B 完全遮挡 A）

切任务的真实形态是**窗口被遮挡**，不是最小化。专门验证了这一场景：

| 验证项 | 结果 |
| --- | --- |
| B 覆盖 A 达 100% | ✓ |
| **被遮挡时 A 的点击仍生效** | `post_message`，零干扰 |
| 被遮挡时 A 的 set_value 仍生效 | `path=ax` |
| **被遮挡时仍能截图** | 11KB，有实际内容 |
| A、B 并发操作都完成 | ✓ |
| **释放 A 的 runtime 后 B 仍可用** | ✓（模拟 UI 销毁任务） |

最后一项很重要：它证明 CUA 不依赖某个 runtime 实例存在，
只要同进程还有使用者，Helper 就继续服务。

### 顺带修掉一个静默失败

**最小化后点击会「既没生效也没报错」** —— 这是验证时发现的真问题。

根因：窗口最小化时客户区被销毁（`ClientRect=0x0`），
`PostMessage` 仍然返回成功（进了队列），但那个窗口没有消息循环在处理它。
调用方看到 `dispatched: true`，以为成功了。

修法（`helper/dispatch.ts` + `action-handlers.ts`）：

1. `postClick` 在派发前用 `IsIconic` 检查根窗口
2. 最小化时返回 `dispatched: false, reason: "target_minimized"`
3. 动作层收到该原因后**改走 UIA 语义动作**（那才是真把事做成）
4. 若元素没有可用语义动作，抛明确错误并说明「还原窗口或换支持 UIA 的目标」
5. 降级时在回执里标 `degradedFrom: "post_message"`、
   `degradedReason: "target_minimized"`——用户需要知道这次不是零干扰路径

修复前后的实测对比：

```
修复前：path=post_message  false->false   静默失败
修复后：path=ax            false->true    真的生效
```

### 最小化时的能力边界（实测）

| 能力 | 最小化时 | 说明 |
| --- | --- | --- |
| 读树（get_app_state） | ✅ 可用 | 不受客户区销毁影响 |
| `set_value` | ✅ 可用（`path=ax`） | UIA 路径 |
| 点击 | ✅ 可用（自动降级到 `ax`） | 修复后 |
| 截图 | ❌ 不可用 | `ClientRect=0x0`，明确报错 |

截图的失败信息是有用的：

```
[screenshot unavailable: 窗口已最小化：客户区被销毁（ClientRect=0x0），
无法采集画面。元素级操作（读树、set_value、Toggle）不受影响，仍可继续；
只有需要画面的场景才需要还原窗口。]
```

这句话直接告诉模型「不要因为这个去抢焦点」，避免它用错误的补救动作。

## 剩余工作

1. UI 层：右侧面板按当前任务的 `window.target` 决定渲染谁
2. 画面流：见下节

## 与「右侧显示画面」的关系

画面这条链独立于本规格。现状核查：

- 现有 `screenshot.ts` 走 `PrintWindow(PW_RENDERFULLCONTENT)`
- **实测最小化后 `ClientRect` 变成 `0x0`**，采集会失败并给出明确原因
- 元素级操作（读树、`set_value`、Toggle）**不受最小化影响**

所以「切任务时 CUA 不断」成立（元素级操作全可用），
但「切任务时右侧画面继续刷新」需要额外解决——两条不同的链。

### WGC 调研结论（2026-11-19）

新增 `helper/wgc-capture.ts`，打通到「帧池工厂」为止：

| 步骤 | 结果 |
| --- | --- |
| `RoInitialize(MTA)` | `0x0` |
| `RoGetActivationFactory(GraphicsCaptureItem, ItemInterop)` | `0x0` |
| `CreateForWindow(hwnd)` | `0x0` |
| `item.get_Size()` | `706x513`（与窗口吻合） |
| `D3D11CreateDevice` | `0x0` |
| `QI(IDXGIDevice)` → `CreateDirect3D11DeviceFromDXGIDevice` | `0x0` |
| `RoGetActivationFactory(FramePool, Statics2)` | `0x0` |
| `CreateFreeThreaded(...)` | `0x80070057`（E_INVALIDARG） |

#### 一个推翻预期的实测发现

**WGC 的 `item.get_Size()` 返回的是窗口「当前」尺寸，不是初始客户区。**

```
正常:    706x513
最小化:  146x28      ← 只剩标题栏
```

也就是说：**WGC 也无法在最小化时拿到完整画面。** 它和 PrintWindow 的差别
不在「能否绕过最小化」，而在于：

| 差别 | PrintWindow | WGC |
| --- | --- | --- |
| 需要窗口客户区存在 | ✅ 需要 | ✅ 需要 |
| 硬件加速窗口 | 可能空白 | 可靠 |
| 逐帧连续采集 | ❌ 每次独立调用 | ✅ 帧池可连续 |
| 采集开销 | 阻塞调用方 | 异步，不阻塞 |

**WGC 的真实价值是「连续帧」与「不阻塞」，不是「绕过最小化」。**
这一点修正了我原先的判断。

#### 为什么停在 CreateFreeThreaded

`SizeInt32` 是按值结构体（8 字节），三种写法都试过：

| 写法 | 结果 |
| --- | --- |
| 声明 `const void*`、传 Buffer | `E_INVALIDARG` |
| 声明结构体类型、传对象 | **`0xC0000005` 崩进程** |
| 声明 `const void*`、传外部内存 | 未试 |

按本规格的硬规矩：**不猜参数传递方式**。猜错的后果是进程直接死，
错误码完全不指向根因——这在虚表索引上已栽过多次。

正确做法是查 koffi 文档里「结构体按值传参」的规范写法，或用
`koffi.struct` + `koffi.as()` 组合。这属于查文档能解决的事，不该靠试。

#### 已交付的能力

`probeWgcCapture(hwnd)` —— 判断某窗口能否被 WGC 采集并返回其尺寸。
已验证：正常窗口 `706x513`、最小化 `146x28`、无效句柄明确失败不崩溃。

`isWgcAvailable()` —— 环境级能力探测。

#### WGC 完整取帧已打通（2026-11-19）

`helper/wgc-capture.ts` + `helper/d3d11-readback.ts`（拆分是因为单文件超过
700 行，且 D3D11 回读是独立知识，将来 DXGI Desktop Duplication 也能复用）。

完整链路实测全 `0x0`：

```
RoInitialize(MTA)                                      → 0x0
RoGetActivationFactory(Item, ItemInterop)              → 0x0
CreateForWindow(hwnd)                                  → 0x0   item
D3D11CreateDevice + QI(IDXGIDevice) + 转 WinRT 设备     → 0x0
CreateFreeThreaded(dev, 87, 3, {w,h})                  → 0x0   pool
pool.CreateCaptureSession(item)          [vt10]        → 0x0   session
session.StartCapture()                   [vt6]         → 0x0
pool.TryGetNextFrame()                   [vt7]         → 0x0   frame
frame.get_Surface()                      [vt6]         → 0x0
QI(IDirect3DDxgiInterfaceAccess) → GetInterface        → 0x0   纹理
context.CopyResource(staging, src)       [vt47]        → 0x0
context.Map(staging, 0, READ)            [vt14]        → 0x0   RowPitch=2752
```

像素验证：四段色块 `(197,48,48) (56,161,105) (43,108,176) (214,158,46)`
与页面设置**完全一致**。

##### 三个曾经踩空的索引

| 位置 | 最初用的 | 正确值 | 后果 |
| --- | --- | --- | --- |
| `pool.CreateCaptureSession` | 8 | **10** | 8 是 `add_FrameArrived` |
| `context.Map` | — | **14** | 传 null 资源会崩（内部解引用） |
| `context.CopyResource` | 49 | **47** | 49 会崩 |

第一个最阴险：`add_FrameArrived` 的签名恰好也能收下 `(item, &out)`，
返回 `0x0` 并往 out 里写一个 **EventRegistrationToken**。
那个 token 被当成 session 指针，**下一次调用才崩**——错误现场远离根因。

第二个的教训：判断 `Map` 索引对不对**必须传真实资源**看能否读出合理
`RowPitch`。用「传 null 崩不崩」当判据是错的——正确的 14 传 null 也崩，
我因此一度把 14 判成错的，转去扫出 29（那其实是别的方法）。

##### 关键语义：一个池只能可靠取有限帧

同一个池连续取帧时，**前 1~3 帧之后就频繁返回空帧**
（`hr=0x0` 但 `frame=NULL`）。释放 frame **不能**让缓冲回到池——
WGC 靠 `FrameArrived` 事件循环复用缓冲，没有消费者就不循环。

正确用法是**一池一帧**：建池 → 取一帧 → 全释放。

```
连续 10 次「一池一帧」：10/10 成功，每次颜色都不同，平均 34.9ms
```

作为对照，同池连续取 40 次只有 1 次成功——那不是「池坏了」，是用法不对。

##### 但 WGC 也不能绕过离屏

这是本轮最重要的修正。用持续变化的 hue 动画实测：

```
屏内:  8 次采样 8 个不同颜色
离屏:  8 次采样 1 个颜色（完全不变）
```

**Chromium 在窗口完全离开屏幕后停止渲染**（省电行为）。
WGC 忠实反映窗口内容——内容不更新，它自然采不到新帧。

| 状态 | PrintWindow | WGC |
| --- | --- | --- |
| 窗口正常 | ✅ | ✅ |
| 被遮挡 | ✅ | ✅ |
| 屏边留 1px | ✅ | ✅ |
| **完全离屏** | 能采但**冻结** | 能采但**同样冻结** |
| 最小化 | `ClientRect=0x0` 失败 | `item.Size` 缩成 `146x28` 失败 |

所以「后台持续出画面」仍然只能靠**屏边留 1px**，WGC 不能替代它。

##### WGC 的真实价值

| 维度 | PrintWindow | WGC |
| --- | --- | --- |
| 单帧耗时 | ~16ms 同步阻塞 | **~14ms（一池一帧含建池）** |
| 是否阻塞调用方 | 是 | 否（帧池异步） |
| 硬件加速窗口 | 可能空白 | 可靠 |
| 连续流 | 不支持 | 支持（需实现 FrameArrived 订阅） |

##### 交付的接口

```ts
openWgcCapture(hwnd)          // 开会话（建池 + StartCapture）
grabFrame(session, timeoutMs) // 取一帧，可反复调（但受限于池语义）
captureWindowOnce(hwnd)       // **推荐**：一池一帧，直接拿一张
probeWgcCapture(hwnd)         // 只探测能否采集 + 尺寸
isWgcAvailable()              // 环境级探测
```

##### 验收

```
WGC 完整验收（像素/新鲜度/离屏/最小化）  14/14
既有能力回归                            10/10
```

实测数据：

| 项目 | 结果 |
| --- | --- |
| 四段像素 | 完全匹配 |
| 连续 10 次 | 10/10 新鲜，平均 34.9ms |
| 离屏采集 | 能采到（画面冻结，如实记录） |
| 最小化 | 明确 `no_frame`，不崩 |

#### 「移出屏幕」的实测修正：完全离屏会让画面冻结

初版实现把窗口推到屏幕外（负坐标），验证通过「能截到完整图、采样 100% 非黑、
元素操作正常」。**但那次验证漏了一项：画面内容是否还在更新。**

补上这项后结论完全变了：

| 状态 | 客户区 | 能截图 | 尺寸完整 | **画面是否更新** | 元素操作 |
| --- | --- | --- | --- | --- | --- |
| 屏幕内 | `704x481` | ✅ | ✅ | **✅ 40/40** | ✅ |
| 被完全遮挡 | `704x481` | ✅ | ✅ | **✅ 40/40** | ✅ |
| **完全移出屏幕** | `704x481` | ✅ | ✅ | **❌ 1/40 冻结** | ✅ |
| **屏边留 1~2px** | `704x481` | ✅ | ✅ | **✅ 20/20** | ✅ |
| 最小化 | `0x0` | ❌ | — | — | ✅ |

**最要命的是「操作后画面不更新」**：

```
完全移出 → set_value 生效（UIA 读回 "v45777" → "v48350"）
         → 截图哈希 c1edef52d1bf → c1edef52d1bf   ← 字节完全一致
```

操作成功、回执正确，但画面停在旧状态。**这比看不见更糟**——用户看到的是一张过期信息。

补充排查：

| 手段 | 结果 |
| --- | --- |
| `RedrawWindow(RDW_INVALIDATE\|ERASE\|ALLCHILDREN\|UPDATENOW)` × 10 | **救不回**（唯一帧仍 1/20） |
| `IsWindowVisible` | 仍为 1（不是 hide） |
| `DWMWA_CLOAKED` | 仍为 0（DWM 没标记为隐藏） |
| 截图内容完整性 | 四段颜色齐全，**是完整画面**（不是只截到可见那条） |

也就是说：DWM 在窗口完全离开屏幕后不再为它合成新帧，但 `PrintWindow`
仍能返回**结构完整**的最后一帧。这正是难以察觉的原因——图看着完全正常。

#### 正确的做法：屏边留 1px

实测逐档收紧可见宽度（`2560` 宽屏，窗口推到右缘）：

```
可见px | 采集   | 唯一帧  | 判定
   300 | 16/16 | 16/16  | 在动
    16 | 16/16 | 16/16  | 在动
     4 | 16/16 | 16/16  | 在动
     1 | 16/16 | 16/16  | 在动
     0 | 16/16 |  1/16  | 冻结
```

**临界点非常锐利：>0 就更新，=0 就冻结。**

#### 1px 的稳定性（专项验证）

1px 是首选（比 2px 更不可见），但必须确认它**不是偶然能渲染**——
偶发冻结是最难发现的问题。测 3 个纵向位置 × 5 轮 × 20 帧：

```
[顶部 y=40]  5 轮全部 20/20 唯一帧
[中部 y=490] 5 轮全部 20/20 唯一帧
[底部 y=920] 第 1 轮 15/20，其余 4 轮 20/20
统计: 15 轮，最低 15，平均 19.7，最高 20（满分 20）
```

**15 轮无一次冻结。** 底部第 1 轮的 15/20 是采样时刻恰逢动画换相，
不是冻结（冻结会是 1/20 级别）。

截图完整性同样确认：1px 下四段色块颜色全对得上
`(197,48,48) (56,161,105) (43,108,176) (214,158,46)`，
说明 `PrintWindow` 给的是完整客户区，不是可见的那一像素。

#### 一个判据上的教训

早期用「PNG 字节前 4KB 的哈希」判断画面是否更新，得出过
「恢复后唯一帧 1/12」的错误结论，差点误判 1px 不可用。

原因：那个测试页面是**静态色块 + 小面积移动元素**，PNG 压缩后
前 4KB 可能只覆盖静态区，哈希恒定。

**判断画面是否更新，必须直接读像素（`GetPixel`），不要用压缩后的字节哈希。**
换用像素判据后，同一场景是 29/30 色变化——完全正常。

对照实验证明像素判据有效：

| 位置 | 30 次采样不同颜色数 | 判定 |
| --- | --- | --- |
| 屏幕内 | 29/30 | 在动 |
| 露 2px | 30/30 | 在动 |
| **露 1px** | **30/30** | **在动** |
| 完全离屏 | **1/30** | 冻结 |

#### 为什么不用 `ShowWindow(SW_HIDE)`

隐藏窗口会让 `IsWindowVisible` 为 false，浏览器会降频甚至停止
`requestAnimationFrame`，画面会冻结。留边做法不改变可见性标志。

#### 接口与语义

```ts
hideWindowOffscreen(hwnd): HideOffscreenResult   // mode: "edge_sliver"，返回 previousRect
restoreWindowPosition(hwnd, { x, y }): RestoreResult
isWindowOffscreen(hwnd): boolean                 // 完全离屏（画面会冻结）
visibleWidthOf(hwnd): number                     // 可见宽度，0 = 冻结风险
```

`hideWindowOffscreen` 固定留 `SLIVER_WIDTH = 1` px（1px 已验证稳定，见上一节）。

runtime 侧通过 `window_offscreen` 暴露（`action: "hide" | "restore"`），
**不放进模型面**——模型不该自己决定把用户的窗口移走。

#### 采集侧新增 `mayBeFrozen`

`WindowCapture` 加了这个字段，判据是 `isWindowOffscreen(hwnd)`。
命中时：

- `screenshot` 响应带 `may_be_frozen: true` + `frozen_reason`
- `get_app_state(include_screenshot)` 在图片前插入一句警告：
  `[screenshot may be stale: ...] The tree above is current — act on element indices. Do not trust pixel details in this image for verification.`

**仍然把图交出去**（它有结构信息，比没有好），但明说它可能过期。
不改成失败的理由：冻结不等于无内容，模型仍可据它判断界面结构；
真正的问题是「把过期画面当成当前状态」，所以警告而非拒绝。

#### 验收

```
1px 最终验收（像素判据）        20/20
1px 稳定性（3 位置 × 5 轮）     15 轮无冻结
既有能力回归                    10/10
```

实测数据（像素判据，30 次采样）：

| 状态 | 可见宽 | 不同颜色数 | 冻结标记 |
| --- | --- | --- | --- |
| 屏幕内 | — | 29/30 | 不标记 |
| 露 2px | 2px | 30/30 | 不标记 |
| **露 1px** | **1px** | **30/30** | **不标记**（不误报） |
| 完全离屏 | 0px | **1/30** | **10/10 全标记**（不漏报） |

单帧耗时 ~15–17ms（≈ 58–65fps 上限），移出屏幕反而更快（但内容是旧的）。
**PrintWindow 每次是同步阻塞调用，这是它相对 WGC 帧池的固有劣势。**

## 一个需要澄清的前提

**「切到 B 任务」时，A 的窗口是保持打开的吗？**

- 若保持打开（只是内容区切换）→ 本方案直接成立
- 若关闭 → CUA 会随 Host 销毁，需要额外处理

用户描述的是「点击左侧任务列表切换任务」，属于前者。
若未来支持「关任务时保留后台运行」，需要把 CUA 提到独立进程——
那是另一次架构决策，不在本规格范围。
