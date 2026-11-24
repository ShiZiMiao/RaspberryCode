# RaspberryCode 实机验收清单（需真实凭据/外部环境的项目）

> 生成时间：2026-11-05。自动化可覆盖的部分已完成（构建/打包/单测/桌面启动冒烟/发行物运行冒烟）；
> 以下项目需要真实 API Key 或外部机器，请在真实使用场景下逐项勾选。
> 任何一项失败，把现象（截图/日志）发回即可，我来定位。

## A. BYOK 真实模型任务（约 5 分钟）

* [x] A1 启动应用后进入 设置 → 模型/服务端点，填入你的服务端点（自托管）或厂商端点 + API Key
* [x] A2 新建任务，发一条真实提示词（例如「读一下 README 并总结」），确认模型回复正常
* [x] A3 让它执行一个真实工具调用（读文件/跑命令），确认工具结果回传与展示正常
* [x] A4 会话内查看用量/额度展示（如有），确认数字与厂商后台大致吻合
* [x] A5 重启应用后再次发任务，确认 Key 与端点配置持久化

## B. SSH 远程工作区（约 10 分钟，需一台可达 Linux 机器）

* [x] B1 新建远程工作区，填入 SSH 主机/端口/用户/密钥（或密码）
* [x] B2 首连自动部署 Agent（观察部署进度与日志无报错）
* [x] B3 在远程工作区发一条真实任务，确认流式输出与工具调用正常
* [x] B4 断开重连，确认会话/任务列表恢复（web-remote-replayable 语义）
* [x] B5 （可选）WSL/Docker 场景各跑一次 B2-B3——**双后端部署链冒烟全过**（scripts/remote-backend-smoke.mjs：
  probe→发布物 sha 校验→installOrUpdate→ensureDaemon ready→exec version/status 全通，执行位修复链实机生效；
  WSL=Ubuntu WSL2 / Docker=python:3.11-slim 容器，均 detached fallback 符合预期）。

## C. 发行包装机（我先构建+静默安装，你只需验收应用本体）

* [x] C1 安装器静默安装成功（由我执行并回报）
* [x] C2 从开始菜单/桌面快捷方式启动，应用窗口正常、数据目录落在预期位置
* [x] C3 卸载一次并确认「保留用户数据」行为符合预期——已自动验证：安装目录与卸载注册表清理完整、
  `%%APPDATA%%\RaspberryCode` 与 `~/.raspberrycode` 保留（主断言通过）；发现卸载后桌面/开始菜单快捷方式残留
  （上游 NSIS 模板 `isKeepShortcuts` 无定义致删除段恒跳过），已修复并复验删除生效。

## D. 已知观察项（非阻塞，暂不需勾选）

1. 首次启动的 community 插件配置拉取会报 `ERR_NAME_NOT_RESOLVED` ——占位端点期的预期告警，不影响功能。
2. 你本机任务索引里有 1 条旧数据 `session_dd83419799465977e8ada8ae6c7f47d9` 的 meta\_json 不合新 schema
   （启动日志会 warn 后跳过）。需要的话我可以出一份数据修复/清理方案。

## E. 测试环境模拟度（每次验收前必查，2026-11-24 用户要求）

**原则：验收必须尽可能模拟真实用户环境。开发机独有的覆盖变量会让缺陷"消失"。**

### E1 必须为空的变量

| 变量 | 若设置会发生什么 |
| --- | --- |
| `RASPBERRYCODE_REMOTE_ASSET_LOCAL_RELEASE_DIR` | 绕过 HTTP 链路改读本地目录，**发布根拼接类缺陷完全测不出来** |
| `RASPBERRYCODE_REMOTE_ASSET_CDN_BASE_URL` | 覆盖构建期注入的发布根，验的不是发布版真实行为 |
| `RASPBERRYCODE_DEV_REMOTE_ASSET_USE_CDN` | dev 态强制走公网 CDN，与默认路径不同 |

`node scripts/release-gate.mjs` 开头已内置该检查（`== 测试环境模拟度 ==`），有残留会打 WARN。

### E2 删除变量后必须开新终端

**这是最容易踩的坑**：删除用户环境变量只对**之后新启动的进程**生效。
已经在运行的终端、IDE、构建代理会继续持有旧值并向子进程传播，
表现为「注册表里已经没有了，但构建/运行出来的东西仍然走本地目录」。

自查（当前进程是否还带旧值）：

```powershell
[Environment]::GetEnvironmentVariable('RASPBERRYCODE_REMOTE_ASSET_LOCAL_RELEASE_DIR','Process')
```

### E3 远程连接（B 节）的等价性判据

远程连接必须验证到**真实 HTTP 下载链路**。判定方法：连接日志里出现
`no local release dir configured (RASPBERRYCODE_REMOTE_ASSET_LOCAL_RELEASE_DIR)`
才说明走的是 HTTP；若出现 `local release dir missing ...: 'D:/.../mock-cdn'`，
说明仍在读本地目录，**这次验证对用户无效**。

> 0.2.7 的远程连接缺陷（URL 版本号双拼成 `.../download/v0.2.7/0.2.7` → 404）
> 正是因为开发机配了本地发布目录，全程绕过 HTTP 拼接逻辑，才被漏到线上。

## 通过标准

A、B 两节全部勾选且无阻塞性现象，即可认定「常用功能路径可正常使用」。
C 节覆盖安装/卸载闭环后，分发链路验收完成。
**E 节未通过时，B 节的勾选无效。**
