# SYNC-DRIFT-UNIT：App 单测执行入口与上游规范漂移

> 内部代号：**SYNC-DRIFT-UNIT**（Sync Drift · Unit project）
> 记录日期：2026-11-19
> 状态：`待决` —— 需要产品/仓库治理层面决定方向，不阻塞当前功能开发
> 关联：`docs/testing/unit-test-quality.md`、`docs/testing/pre-push-hook.md`、`AGENTS.md`

## 一句话

仓库的**规范**说 App 业务单测已退役，但仓库的**执行入口**（`vitest.config.ts` 的
`unit` / `fork-isolated` 两个 project 与根 `test` / `test:unit` 脚本）仍然存在，
让 892 个 desktop + 714 个 ui 测试持续执行。**两者都与上游不一致，且这一状态已存在约 3 周未被发现。**

## 为什么叫“漂移”

不是有人违规、也不是有人决定恢复，而是**分叉后的同步没跟上**：

```
上游早期版本（含 unit project）
   │
   ├── 我们在此分叉，继续开发（分叉点 a9fe401e，2026-11-03，此时上游已无 unit）
   │        └── 我们这条线上 unit project 一直在（来自更早的 3c5b2276）
   │
   └── 上游 2026-10-26 决定退役 App 单测
            └── 删掉 unit project、删掉根 test/test:unit
```

双方各自的代码与文档都是自洽的，只是**版本不同步**。所以拿规范对照代码的人觉得代码违规，
看代码的人觉得规范过时。

## 已核实的事实

均以 Git 拓扑（父链）为准，不采信提交日期——本仓库存在日期与拓扑不一致的提交。

| 事实 | 证据 |
|---|---|
| 上游 `AGENTS.md` 与本仓库**一字不差**，同样写「不新增或恢复 App 业务单测」 | `git show upstream/main:AGENTS.md` |
| 上游 `docs/testing/unit-test-quality.md` 与本仓库**一字不差**（2026-10-26 退役） | `git show upstream/main:docs/testing/unit-test-quality.md` |
| 上游 `vitest.config.ts` **只有** `engineering` + cua 两个 project | 同上 |
| 上游根 `package.json` **没有** `test`、`test:unit`，只有 `test:engineering` | `git show upstream/main:package.json` |
| 上游 `engineering-test-files.json` 共 158 条，与本仓库**完全一致** | 同上 |
| 上游仍有 **805** 个 `packages/desktop/test/*.test.ts` 文件 | `git ls-tree -r upstream/main packages/desktop/test/` |
| 本仓库有 **892** 个 desktop、**714** 个 ui 测试文件 | `find` 统计 |
| 本仓库 `unit` project 来自 `3c5b2276`（早于退役决定），**从未被删除** | 父链核验：`git show 3c5b2276:vitest.config.ts` → 1 |
| 分叉点 `a9fe401e`（2026-11-03 同步 v3.17.2）时上游已无 unit | `git show a9fe401e:vitest.config.ts` → 0 |
| `desktopHostProcess.test.ts` **不在** 158 条工程清单中 | 清单检索 → 0 命中 |

### 上游的真实策略

**文件留在磁盘，但不给执行入口。**

805 个 desktop 测试文件确实存在，但 `vitest.config.ts` 只注册 `engineering` 和 cua，
根脚本也不提供 `test` —— 那些文件永不被执行。这是**深思熟虑的取舍**，不是疏漏：
`unit-test-quality.md` 明确写了「工程 Vitest 文件使用显式清单注册，
禁止重新使用 `packages/*/test` 的业务单测通配符」。

### 同一问题的第二次显现

`26a18d40`（2026-11-16）「test(ui): 恢复 jsdom 测试环境，此前 151 个 ui 测试文件从未真正执行」：

> `@testing-library/react` 与 `jsdom` 两个依赖长期缺失，导致 packages/ui 下大量测试文件
> 在加载阶段就失败，报 `(0 test)` —— 它们从未真正跑过，因此其中的断言早已失效也无人发现。

该提交补齐依赖、给 154 个文件加 `// @vitest-environment jsdom`、修 4 个真实失败。

**它不是有人违背规范，而是 SYNC-DRIFT-UNIT 的直接后果**：在仍带着 `unit` project 的环境里，
有人发现“测试在跑但全绿是假的”，于是去修。做那件事的人眼里没有“这些测试该退役”这个前提。

## 影响面

### 现状（当前生效）

- `pnpm test` 会执行 892 + 714 = **1606 个文件**，与上游行为不同
- `pre-push` 的 `verify:pre-push` 只跑 engineering，**不跑这些**（这点与上游一致）
- 因此这 1606 个测试**只在手动 `pnpm test` 时执行**，不在推送门禁里
- 每次与上游同步，`vitest.config.ts` 都会产生同类冲突，需人工判断保留哪边

### 两种处理方向的影响

| 方向 | 好处 | 代价 |
|---|---|---|
| **A 保留并改规范** | `26a18d40` 的工作有效；1606 个测试继续提供保护 | 明确背离上游；每次同步需维护偏离说明 |
| **B 对齐上游删入口** | 与上游完全一致，同步无摩擦 | `26a18d40` 的工作失效；1606 个测试停摆；后续验证 desktop 行为缺工具 |

### 关键权衡

`26a18d40` 的观察值得慎重对待：**退役不等于测试消失，只是让它们腐烂而无人知。**
上游能接受 805 个死文件，但我们已用一次真实故障证明——一旦有人想用它们，它们就是坏的。

反过来，保留入口意味着**长期承担一份与上游不同的配置**，而每次同步都可能再触发同类问题。

## 待决事项

1. **方向选择**：A / B / 折中（保留但登记为受控偏离）
2. 若选 B，删之前是否先跑一遍这批测试、把已知失败修掉或标记（避免删的瞬间把真实故障一起埋掉）
3. 若选 A，需同步更新 `AGENTS.md` 与 4 份 coverage matrix 的退役表述
4. **无论选哪个**：`vitest.config.ts` 里 `unit` / `fork-isolated` 两个 project
   目前**没有任何注释说明它们为何存在**，下一个同步的人会再犯同样的错。
   建议至少补一段说明指向本文件。

## 与本次 CUA 工作的关系

本次 CUA 改造需要新增回归测试，按规范落在 `packages/raspberrycode-cua/test/`
（CUA 是规范明确保留的归属，有独立入口）。**没有**往 `packages/desktop/test/` 新增任何文件，
以避免扩大本漂移的影响面。

## 处理记录

- 2026-11-19：发现并归因。曾误判为「规范落后于代码 9 天」，经与上游逐项对比后纠正为
  **「同步漂移」**。同日核对父链，纠正了「unit 被删后又恢复」的错误推断——
  实际是我们这条线**从未删除**过它。
