# 上下文来源占比持久化

上下文容量弹窗的**来源明细**冷恢复后消失的问题域。

```text
主链路模型请求完成（ModelComplete，querySource=main_turn）
  → contextUsageBreakdown（本地估算：system_prompt/system_tool_schemas/mcp_tool_schemas/
    skills/tool_prompt/messages/meta_user_context 各自的 chars）
  → 随事件下发（内存事件存储，进程退出即丢）
  └→ persistContextUsageBreakdown：落 session entry（最近一次，覆盖写）

冷恢复 / 重新打开历史会话
  → readSessionContextUsageBreakdownEvents（事件，通常为空）
  └→ 空则 readPersistedContextUsageBreakdown（session entry 兜底）
```

## 为什么需要落盘

事件存储默认是 `createInMemorySessionEventStore()`，**纯进程内内存态**。冷启动后：

| 弹窗元素 | 冷恢复后 | 来源 |
| --- | --- | --- |
| 容量条与百分比 | 正常 | projection 的 contextUsed / contextWindow |
| 平均缓存命中率 | 正常 | 持久化的 model_usage |
| **来源明细各行** | **消失** | 只存在于内存事件里 |

用户看到的是「详细信息怎么没有了」，而不是任何错误——所以必须靠落盘修，不能靠 UI 兜底。

## 纪律

- **只存 facts**：`source` + `chars`，不存百分比。分母由读取方按统一口径重算，避免两套百分比漂移。
- **只认主链路**：只有 `querySource === "main_turn"` 的请求才代表当前可见上下文。标题、压缩、
  prompt enhance 等 sidecar 请求的规模与可见上下文无关，落盘会让明细凭空偏移。
- **最近一次，不累积**：用固定 entry id 覆盖写。它描述「当前上下文构成」，不是使用历史曲线。
- **best-effort**：读写失败只记 `warn`，绝不改变模型请求与冷恢复主流程的结果
  （与 `session-features` 同一处置）。
- **读失败 ≠ 没数据**：`parseContextUsageBreakdownEntryData` 解析失败返回 `undefined`，
  与「解析成功但为空」区分开，避免上层把损坏数据当成空明细。
- **`touchSession: false`**：这是上下文构成快照，不是用户/工具活动，不能把任务时间伪装成「刚刚」。
- 词表外来源（更高版本写入的新 source）在读取时忽略，不报错、不中断恢复。

## 口径对齐

冷恢复的 session entry 兜底与事件路径共用 `applyContextUsageBreakdown` 的对齐规则：
候选的 `used` / `size` 必须与当前 projection 一致才采用，避免把旧分支或旧窗口的构成挂到当前 meter 上。
