# RaspberryCode 0.2.6 发版前人工确认清单

- 版本：0.2.6
- 产物：`D:\projects\RaspberryCode\packages\desktop\dist\RaspberryCode-0.2.6-win-x64.exe`（177,666,386 bytes）
- 当前状态：**已安装并运行**（安装时间 10:10，版本 0.2.6.0）
- 背景：自动化门禁已全绿。本清单是脚本无法替代的部分，**未完成不得发版**。

> 说明：`release-gate` 输出的清单是 7 条，其中第 1、2 条本轮我已代跑（见 §0），  
> 你实际需要动手的是 §1–§5 共 5 组。为对齐门禁脚本，本文按 7 项编号列出。

---

## 0. 我已经代跑并确认的（供你核对）

| 项                 | 证据                                                          |
| ----------------- | ----------------------------------------------------------- |
| 安装本产物，版本号显示 0.2.6 | 安装器退出码 0；`ProductVersion = 0.2.6.0`；exe 时间从 09:35 更新到 10:10 |
| 桌面 + 开始菜单快捷方式存在   | 两个 `.lnk` 均已确认存在                                            |
| 应用能启动             | 7 个进程 / 1 个主窗口                                              |
| UI 渲染正常           | 截图 `.unattended/rebuilt-026.png`：导航、任务列表、输入框、模型名均正常         |
| CUA 在安装目录可用       | `cua-verify-installed.mjs`：**10 PASS / 0 FAIL**             |

**仍需你亲自做**的：双击快捷方式真启动（我只验证了进程存在）、升级路径、远程连接、  
新建对话收回复、各功能页点验、以及 §5 的 CUA 实际使用。

---

## 1. 卸载重装 + 快捷方式双击启动（门禁第 1、2 项）

我只验证了「装上去版本号对」，没验证「卸载后能干净装回来」。这一步会验证：  
卸载器工作正常、安装目录清干净、快捷方式重建、双击真能启动。

### 步骤

1. **卸载当前版本**
   ```
   设置 → 应用 → 已安装的应用 → RaspberryCode → 卸载
   ```
   或直接跑卸载器：
   ```
   C:\Users\lecoo\AppData\Local\Programs\RaspberryCode\Uninstall RaspberryCode.exe
   ```
2. **确认卸载干净**（PowerShell）
   ```powershell
   Test-Path "C:\Users\lecoo\AppData\Local\Programs\RaspberryCode"
   Test-Path "C:\Users\lecoo\Desktop\RaspberryCode.lnk"
   Test-Path "C:\Users\lecoo\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\RaspberryCode.lnk"
   ```
   期望：程序目录为 `False`（或只剩空壳），两个快捷方式为 `False`。
   > 数据目录 `C:\Users\lecoo\.raspberrycode` **应该保留** —— 那里是配置与任务历史，  
   > 卸载不清它是正常的。如果你想测全新安装体验，另说。
3. **安装**
   ```
   D:\projects\RaspberryCode\packages\desktop\dist\RaspberryCode-0.2.6-win-x64.exe
   ```
4. **确认版本与快捷方式**
   ```powershell
   (Get-Item "C:\Users\lecoo\AppData\Local\Programs\RaspberryCode\RaspberryCode.exe").VersionInfo.ProductVersion
   Test-Path "C:\Users\lecoo\Desktop\RaspberryCode.lnk"
   Test-Path "C:\Users\lecoo\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\RaspberryCode.lnk"
   ```
5. **双击桌面快捷方式启动**，确认窗口出现、界面正常。

- [x] 卸载成功，无报错
- [x] 安装成功，版本 `0.2.6.0`
- [x] 桌面快捷方式存在且双击能启动
- [x] 开始菜单快捷方式存在且能启动
- [x] 启动后界面正常，能看到历史任务

---

## 2. 升级路径（门禁第 3 项）

**这是最容易出问题的一项，也是最容易被跳过的一项。**

### 前置条件

升级链路依赖 GitHub Release 真的存在。**必须先把 0.2.6 发布出去**（或至少先发一个  
pre-release）才能测这一项。所以顺序是：

```
先发 Release → 再回到旧版测升级
```

或者用 `dev-app-update.yml` 指向本地 mock，但那验证的是「更新逻辑」不是「真实链路」。  
建议按真实链路测。

### 步骤（Release 发布后）

1. 装回 **0.2.5**（用上一次的安装包，或从 Release 下载）
2. 启动，确认版本是 `0.2.5.0`
3. 触发检查更新：菜单 / 设置里的「检查更新」，或等自动检查
4. 确认出现新版本提示（0.2.6）
5. **下载** —— 观察进度条，确认不是卡在 0% 或报网络错
   > 下载走镜像重定向，实测镜像 1301KB/s vs 直连 57KB/s。如果这里很慢，  
   > 说明镜像没生效，需要排查。
6. **安装并重启**
7. 重启后确认版本变成 `0.2.6.0`
8. 确认 0.2.5 的数据（任务历史、设置）还在

- [ ] 0.2.5 装得上
- [ ] 能检测到 0.2.6
- [ ] 下载成功且速度正常
- [ ] 安装后重启，版本变 0.2.6
- [ ] 数据未丢失

---

## 3. 远程连接（门禁第 4 项）

> **0.2.5 就是漏了这项才出的全量故障**（发布根缺失 → 所有 SSH/WSL/Docker 全挂）。  
> 这项不能跳。

### 步骤

1. 新建任务 → 选择「远程连接 / SSH」
2. 选一台**真实可达的远端**（`~/.ssh/config` 里已有的 alias 最省事）
3. 连接，观察：
   - 是否识别出远端设备
   - 是否自动安装 / 升级 **Source Server**
   - 是否成功进入远端工作区
4. 在远端工作区里跑一个简单命令（如 `pwd`、`ls`），确认真的连上了
5. **额外验一次**：在远端工作区里看设置 → 电脑控制，应显示  
   「当前环境暂不支持电脑控制」+「Computer Use 暂不支持 SSH、WSL、Docker 或其他远端环境」

- [x] 能连上远端
- [x] Source Server 安装/升级成功（**不是**报 `Unable to resolve Source Server release descriptor`）
- [x] 能进入远端工作区
- [x] 远端能执行命令
- [x] 远端工作区里 CUA 显示为不支持（这是正确的）

> ⚠ 若第 2 步报 `Unable to resolve Source Server release descriptor`：  
> 说明发布根或远程资产有问题。**立刻停下来告诉我**，别继续 —— 这正是 0.2.5 的故障。

---

## 4. 新建对话 + 功能点验（门禁第 5、6、7 项）

### 4.1 新建对话收回复

1. 新建任务，选一个**本地项目目录**
2. 发一句简单的话，例如：`只回复两个字：收到`
3. **确认真的收到模型回复**（不是只看界面有没有回显、不是看"正在思考"一直转）

- [x] 收到真实模型回复

> 如果一直转圈或报错，先检查模型配置（BYOK 的 key / endpoint）。这不一定是 0.2.6 的问题，  
> 但必须确认能用才能发版。

### 4.2 文件编辑 / 终端

1. 让 Agent 创建一个文件（如 `只新建一个 hello.txt，内容写 hello`）
2. 确认文件真的出现在项目目录里
3. 打开终端面板，跑 `echo test`
4. 确认输出正常

- [x] Agent 能创建/修改文件
- [x] 终端能执行命令

### 4.3 设置页逐项点过

按顺序打开每个分区，确认**没有白屏、没有报错、能保存**：

- [x] 常规 / 外观
- [x] 模型 / Provider（确认你的 BYOK 配置还在）
- [x] **电脑控制**（见 §5）
- [x] MCP 服务器
- [x] 技能
- [x] 插件（含插件市场能打开）

### 4.4 UI 截图

- [x] 至少截一张主界面 + 一张设置页，确认无错位/重叠/文字截断

---

## 5. CUA 实际使用（本轮新增，最需要你亲自验）

自动化只证明了「底层能力可用」，没证明「用户在界面里能用」。

### ⚠ 三个前提，缺一不可

1. **必须是本地 Windows 项目** —— SSH/WSL/Docker 工作区不支持（设计如此）
2. **必须打开两个开关** —— 启用电脑控制 + 允许模拟键盘与拖拽
3. **改完设置必须重启应用** —— 预算与授权是 runtime 创建时一次性读取的

### 步骤

1. 新建任务 → 选**本地 Windows 目录**的项目
2. 打开设置 → **电脑控制**
3. 确认页面上**没有**显示「当前环境暂不支持电脑控制」
4. 打开「**启用电脑控制**」
5. 打开「**允许模拟键盘与拖拽**」
   > 打开它会自动把干扰预算提到 `unrestricted`。这是刻意的：只授权不提预算  
   > 等于什么都不开，用户点了开关却仍不能输入会被当成坏了。
6. **完全退出应用并重新启动**（不是关窗口，要退进程）
7. 回到任务，让 Agent 操作记事本。可以用这句：
   ```
   打开记事本，把内容改成 hello-from-cua，然后读回来确认
   ```
8. 观察：
   - Agent 是否真的调用了电脑控制工具
   - 记事本内容是否真的变成 `hello-from-cua`
   - Agent 是否把读回的结果告诉你

- [ ] 设置页不显示「当前环境暂不支持电脑控制」
- [ ] 两个开关都能打开并保存
- [ ] 重启后开关状态还在
- [ ] Agent 真的操作了记事本（内容变了）
- [ ] Agent 读回的内容与实际一致
- [ ] Agent 用的是电脑控制工具，**不是**用 shell 命令绕过

> **额外注意**：如果 Agent 用 `powershell`、`type` 之类命令改文件来"作弊"，  
> 那不算 CUA 生效。要确认它走的是「电脑控制」。

---

## 6. 全部确认完，告诉我结果

回一句「7 项都过了」或指出哪项有问题。我会：

1. 打 tag `v0.2.6`
2. 创建 GitHub Release（**显式 `--repo ShiZiMiao/RaspberryCode`**）
3. 上传 6 个资产：
   ```
   RaspberryCode-0.2.6-win-x64.exe              177,666,386
   RaspberryCode-0.2.6-win-x64.exe.blockmap       184,731
   latest.yml                                         359
   raspberrycode-server-linux-x64.tar.gz       92,975,940
   raspberrycode-server-linux-arm64.tar.gz     91,915,074
   source-server-release.json                         697
   ```
4. 推送代码

> **两个 Server 包必须上传。** 你确认过「同版本兼容，升级时本地和远端同时升级」，  
> 所以 0.2.6 发布后所有 0.2.5 的远端都会被判「必须升级」。若 Release 里没有  
> 0.2.6 的 Server 包，老用户的远端会卡死。
>
> macOS 按你的指示不做。0.2.6 的 descriptor 只含 Linux 两个平台。

---

## 附：出问题时的排查入口

| 现象                              | 先看哪里                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| 远程连接报「无法解析 Source Server 发布描述符」 | 发布根是否真的可下载；`docs/cua/2026-11-20-release-026-verification.md` §四 |
| 升级下载很慢                          | 镜像重定向是否生效（`autoUpdate/updateMirror.ts`）                         |
| 设置页显示「当前环境暂不支持电脑控制」             | 是否在远程工作区；`workspaceIdentity` 是否 `remote:ssh:...`                |
| CUA 开关打开了但 Agent 不会用            | 是否**重启过应用**；是否本地项目                                              |
| Agent 说操作成功但记事本没变               | 记事本改内存文档不自动保存，让它读回树里的 `document value`                          |

日志位置：

```
C:\Users\lecoo\.raspberrycode\v2\logs\        ← 主程序日志，按日期分文件
C:\Users\lecoo\.raspberrycode\cli\log\        ← CLI / Agent 日志
```
