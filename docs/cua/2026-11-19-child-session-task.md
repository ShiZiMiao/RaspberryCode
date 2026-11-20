# 子会话创建：计划任务方案

## 状态

Draft — 基于 2026-11-19 对 WorkBuddy 运行时状态的实测。

## 背景

前序结论（`2026-11-19-windows-cua-self-hosted-spec.md` §1.34）确认了两件事：

1. `WinStationCreateChildSessionTransport` 返回的管道**可写但服务端不响应**
   （X.224 Connection Request 写进去 19 字节，15 秒零响应）
2. FreeRDP 的 `childsession.c` 用**同一根管道**，因此同样无解

但 WorkBuddy 的电脑控制在本机**实际可用**。观察运行后的系统状态，机制清楚了。

## 实测到的机制

```
计划任务 wincua-child-host-autorun
  Principal:  lecoo / LogonType=Interactive / RunLevel=Limited   ← 不是 SYSTEM
  Action:     C:\WINDOWS\System32\conhost.exe --headless
              <...>\bin\workbuddy-cu.exe --child-host-launcher
  Triggers:   MSFT_TaskLogonTrigger              （登录时）
              MSFT_TaskSessionStateChangeTrigger （StateChange=3）
  Settings:   MultipleInstances=Parallel
              ExecutionTimeLimit=PT0S（不限时）
              DisallowStartIfOnBatteries=False
```

运行后的状态：

| 观测项 | 值 |
| --- | --- |
| `WTSGetChildSessionId` | `6` |
| 会话 #6 状态 | `Disconnected` |
| 会话 #6 的 `UserName` | `lecoo`（与主会话同账户） |
| 会话 #6 的 `ClientProtocolType` | `0`（**非 RDP 协议**） |
| `workbuddy-cu-child-host` 进程 | PID 33548，`SessionId=6` |
| 3389 监听 | **始终未监听** |

## 核心结论

**子会话不是靠 RDP 登录创建的，是靠「在会话里跑起一个进程」创建的。**

`MSFT_TaskSessionStateChangeTrigger` 在会话状态变化时触发任务，
任务动作把 `host` 进程拉进该会话；会话因此存在并在
`WTSEnumerateSessions` 里出现。

这解释了为什么 3389 不必监听、`ClientProtocolType=0`。

## 设计

### 三层职责分离

```
┌─────────────────────────────────────────────────────┐
│ child-session-task.ts（本规格）                      │
│   注册/查询/注销计划任务；创建子会话                  │
│   唯一所有者：计划任务的定义与生命周期                 │
└─────────────────────────────────────────────────────┘
              ↓ 会话出现后
┌─────────────────────────────────────────────────────┐
│ rdp-child-session.ts（已有）                         │
│   用 ActiveX 连到已存在的子会话                       │
│   唯一所有者：控件连接与凭据                          │
└─────────────────────────────────────────────────────┘
              ↓ 会话内需要进程时
┌─────────────────────────────────────────────────────┐
│ session-spawn.ts（已有）                             │
│   在指定会话内启动助手进程                            │
└─────────────────────────────────────────────────────┘
```

**为什么分三层**：创建会话、连接会话、在会话里起进程是三件不同的事，
失败原因、权限要求、生命周期都不同。混在一起会让「为什么起不来」
无法归因。

### 计划任务的定义

| 字段 | 值 | 理由 |
| --- | --- | --- |
| 主体 | 当前用户 |**不需要 SYSTEM**，实测 WorkBuddy 也是用户身份 |
| `LogonType` | `Interactive` | 需要交互式令牌才能有桌面 |
| `RunLevel` | `LeastPrivilege` | 最小权限；不要求提权 |
| 动作 | `conhost.exe --headless <exe> <args>` | 见下 |
| 触发器 | 登录时 + `SessionStateChange` | 双触发保证会话存在后能起 |
| `MultipleInstances` | `Parallel` | 允许与已有实例并存 |
| `ExecutionTimeLimit` | `PT0S`（不限） | host 需要长期驻留 |

**为什么用 `conhost.exe --headless` 包一层**：会话里的进程需要一个控制台宿主。
直接起 GUI 进程在某些情况下会因为没有 console 而失败。
`--headless` 让 conhost 不显示窗口但提供 console 环境。

### 接口

```ts
/** 注册（或更新）子会话计划任务。幂等。 */
export function registerChildSessionTask(options: {
  taskName: string;
  hostExePath: string;
  hostArgs: string[];
}): TaskOperationResult;

/** 查询任务状态。 */
export function queryChildSessionTask(taskName: string): TaskStatus;

/** 立即运行任务（不等待会话出现）。 */
export function runChildSessionTask(taskName: string): TaskOperationResult;

/** 注销任务。 */
export function unregisterChildSessionTask(taskName: string): TaskOperationResult;

/**
 * 确保子会话存在：注册任务 → 运行 → 等待会话出现。
 *
 * 这是上层应该用的唯一入口。
 */
export function ensureChildSession(options: {
  taskName: string;
  hostExePath: string;
  hostArgs: string[];
  timeoutMs: number;
}): EnsureResult;
```

### 状态与失败分类

`TaskOperationResult` 必须区分失败原因，不能只说「失败」：

| code | 含义 | 处置 |
| --- | --- | --- |
| `ok` | 成功 | — |
| `schtasks_unavailable` | 找不到 `schtasks.exe` | 环境异常，换 API 路径 |
| `access_denied` | 权限不足 | 需用户提权或改策略 |
| `task_not_found` | 任务不存在 | 先注册 |
| `invalid_definition` | 参数不合法 | 检查路径与参数 |
| `timeout` | 等待会话超时 | 看 host 是否真的起来 |

### `EnsureResult`

```ts
{
  ok: boolean;
  sessionId?: number;
  /** 本次是否新建。false 表示复用了已有会话。 */
  created: boolean;
  reason?: "task_register_failed" | "task_run_failed" | "session_timeout" | "session_preexisting";
  message: string;
}
```

`created` 字段是关键：复用的会话不该被当作本次产物。

## 前提与限制

### 必须成立的三个条件

1. **`schtasks.exe` 可用**（本机现已解除拦截）
2. **当前用户有创建计划任务的权限**（普通用户可创建自己的任务，不需要管理员）
3. **`SessionStateChange` 触发器在目标系统上有效**

### 不做什么

- **不提权到 SYSTEM**：实测不需要，用户身份足够
- **不改系统服务**：不需要 `restart TermService`（那是我原先基于
  §1.34 的错误推断——管道无响应不是服务没重启，是会话根本不存在）
- **不引 FreeRDP**：这条路不需要第三方协议栈

### 已验证与待验证

| 项目 | 状态 |
| --- | --- |
| WorkBuddy 的计划任务定义 | ✅ 实测读到完整定义 |
| 会话 #6 由该任务创建 | ✅ 实测 host 进程在 SessionId=6 |
| 不需要 SYSTEM | ✅ 主体是 `lecoo` + `Limited` |
| 不需要 3389 | ✅ 始终未监听 |
| **我们自己注册任务能否成功** | ⏳ 待实现验证 |
| **注册后会话是否出现** | ⏳ 待实现验证 |

## 验收场景

1. **注册任务** → 查询应返回 `Ready`，主体是当前用户、`RunLevel=Limited`
2. **运行任务** → 30 秒内 `WTSGetChildSessionId` 返回非 `0xFFFFFFFF`
3. **重复注册** → 幂等，不报错、不产生重复任务
4. **注销任务** → 查询返回 `task_not_found`
5. **会话已存在时调用 `ensureChildSession`** → `created: false`，不重复创建
6. **`schtasks` 不可用时** → 返回 `schtasks_unavailable`，不抛异常
