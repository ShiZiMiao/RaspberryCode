# Desktop 开发会话退出码

## 背景

`pnpm dev:desktop` 经 `dev-desktop-env.mjs` 进入 `@zcode/desktop` 的 `dev:runtime`，由
`concurrently -k` 并行运行 `tsup --watch`、`vite dev` 和 `node scripts/dev.mjs`（Electron 会话）。

应用从托盘"退出"是正常结束：main 走 `markExplicitQuit + app.quit()`，在 `prepareAppQuit`
清理屏障完成后由 `exitPreparedApp` 以 `app.exit(0)` 结束，`dev.mjs` 把该退出码原样透传。
但 `concurrently -k` 随后用 SIGTERM 杀掉仍在运行的 tsup/vite watch，这两个命令在 Windows
上被记为退出码 1；concurrently 默认 `--success all`（要求所有命令都退出 0），于是整体退出 1，
pnpm 打印 `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` 和 `ELIFECYCLE`。开发者会把这段收尾噪声
误判为应用退出失败。

## 规则与所有者

- `dev:runtime` 与 `dev:local-cli` 的整体退出码由第一个退出的命令决定
  （`concurrently --success first`）：
  - `node scripts/dev.mjs`（Electron 会话）先退出时，其退出码就是 dev 会话的退出码。
    托盘退出、正常关闭都走 `app.exit(0)`，dev 会话随之以 0 结束，不再输出 `ELIFECYCLE`。
  - `tsup --watch` 或 `vite dev` 先失败退出时，dev 会话退出非 0，并由 `-k` 结束其余进程。
- `packages/desktop/scripts/dev.mjs` 是退出码的唯一来源，继续把 Electron 退出码透传给
  concurrently（signal 结束记 1）。
- `scripts/dev-desktop-env.mjs` 继续按子进程退出码决定成败，不做兜底吞错。

## 事件顺序

正常退出（托盘"退出"）：

```text
托盘"退出" -> main: markExplicitQuit + app.quit()
  -> before-quit: prepareAppQuit（host/agent 清理屏障）
  -> exitPreparedApp: app.exit(0)
  -> dev.mjs: electron close(code=0) -> process.exit(0)     [第一个退出的命令]
  -> concurrently -k: SIGTERM tsup watch / vite dev          [记为 code 1，汇总时忽略]
  -> concurrently: 按 --success first 返回 0
  -> pnpm dev:runtime / dev:desktop 以 0 结束，无 ELIFECYCLE
```

失败对照：

```text
tsup / vite 先崩溃(非 0) -> 先退出的命令失败
  -> concurrently 返回非 0（-k 结束其余进程）
  -> pnpm 报 ELIFECYCLE，真实失败仍然暴露
```

## 约束

1. `dev:runtime` 和 `dev:local-cli` 使用同一份退出码契约，避免标准桌面和远控 local-cli
   启动路径行为漂移（与 watch 范围约束同源，见 [dev-build-watch](./dev-build-watch.md)）。
2. 不吞掉真实失败：`dev.mjs` 启动失败、Electron 非 0 退出、tsup/vite 先行崩溃仍必须让
   dev 会话退出非 0。
3. `--success first` 只改变 concurrently 的汇总退出码，不改变 `-k` 的互杀行为、watch 范围
   或 Electron 启动门禁。
4. 根 `dev:web`、`dev:web-remote-control` 等其它 concurrently 入口不在本契约范围内。

## 验收

- 两个 Desktop watch 入口的 concurrently 调用都带 `--success first`。
- 静态测试覆盖两个入口的退出码契约。
- 应用从托盘正常退出后，`pnpm dev:desktop` 以 0 结束且不再输出 `ELIFECYCLE`。
- tsup/vite 先行失败时 dev 会话仍退出非 0。
- `pnpm typecheck`、`pnpm lint` 与受影响单测通过。
