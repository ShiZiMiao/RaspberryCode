# RaspberryCode 0.2.6 发版前人工确认清单（第二版）

- 生成时间：2026-11-20 14:10
- 产物：`D:\projects\RaspberryCode\packages\desktop\dist\RaspberryCode-0.2.6-win-x64.exe`
  - 大小 **191,469,851 bytes（182.6 MB）**
  - 构建时间 11-20 13:58
- 代码：HEAD `e4fe8806`，工作区干净，**未打 tag、未建 Release**
- 当前状态：**已安装并运行**（主程序 mtime 13:58，与产物一致）

> 上一版清单已作废——那一版打包漏了 `prepare:agent-bundle`，  
> 产物里的插件资产是 11 月 2 日的旧内容。本版对应重新打包后的产物。

---

## 0. 我已经验证过的（你不用重复，但可以抽查）

| 项                    | 结果                   | 证据                                                                              |
| -------------------- | -------------------- | ------------------------------------------------------------------------------- |
| 产物与源码一致              | PASS                 | 主程序 size 246,346,240，dist 与安装态一致                                                |
| 修复标记进包               | PASS                 | 安装态 `raspberrycode.cjs` 含 `cuaHelperEntry`×2、`RASPBERRYCODE_CUA_HELPER_ENTRY`×4 |
| 宿主资产进包               | PASS                 | `agent/packages/node-repl-host`：manifest `0.7.0`、koffi 就位                       |
| CUA Helper 进包        | PASS                 | `agent/packages/raspberrycode-cua/dist/helper/windows-helper.js`                |
| **安装目录 CUA 端到端**     | **10 PASS / 0 FAIL** | 连续两次复现（`cua-verify-installed.mjs`）                                              |
| **插件缓存路径 CUA**       | PASS                 | `getApp` + `getAXState` 读出 `@state s-2 ... showing 0-23 of 24`                  |
| **插件缓存路径浏览器控制**      | PASS                 | 同宿主内 `agent keys: browsers,documentation`                                       |
| 升级后旧缓存自动修复           | PASS                 | 实测 `0.7.0` 由「koffi 无 / manifest 0.6.1」变为「有 / 0.7.0」                             |
| `release-gate` 六项自动化 | 全绿                   | typecheck / lint / audit-neutrality 均 OK                                        |
| 快捷方式                 | 两个都在                 | 桌面 + 开始菜单                                                                       |
| UI 渲染                | 正常                   | 截图确认导航、任务列表、输入框齐全                                                               |

**你仍需亲自做的**：真实双击启动、升级全程、远程连接、Agent 实际使用 CUA/浏览器、功能页点验。

---

## 1. 卸载重装 + 快捷方式双击（门禁第 1、2 项）

我只验证了「装上去版本对」，没验证「卸载后能干净装回来」。

1. 卸载：`设置 → 应用 → RaspberryCode → 卸载`  
   或跑 `C:\Users\lecoo\AppData\Local\Programs\RaspberryCode\Uninstall RaspberryCode.exe`
2. 确认卸载干净：
   ```powershell
   Test-Path "C:\Users\lecoo\AppData\Local\Programs\RaspberryCode"
   Test-Path "C:\Users\lecoo\Desktop\RaspberryCode.lnk"
   Test-Path "C:\Users\lecoo\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\RaspberryCode.lnk"
   ```
   期望：程序目录 `False`（或只剩空壳），两个快捷方式 `False`。
   > `C:\Users\lecoo\.raspberrycode` **应该保留**（配置与任务历史），不清它是正常的。
3. 安装 `RaspberryCode-0.2.6-win-x64.exe`
4. 确认：
   ```powershell
   (Get-Item "C:\Users\lecoo\AppData\Local\Programs\RaspberryCode\RaspberryCode.exe").VersionInfo.ProductVersion
   Test-Path "C:\Users\lecoo\Desktop\RaspberryCode.lnk"
   ```
5. **双击桌面快捷方式**启动（不要用命令行带参数）

- [x] 卸载成功，无报错
- [x] 安装成功，版本 `0.2.6.0`
- [x] 桌面快捷方式存在且**双击**能启动
- [ ] 开始菜单快捷方式存在且能启动
- [x] 启动后界面完整，能看到历史任务

> ⚠ **启动方式有坑**：不要加 `--force-renderer-accessibility`。  
> 该参数会让这个版本的渲染层停在闪屏（DOM 里只有空 `root`），  
> 看起来像"启动失败"，其实只是那个参数的问题。正常双击是好的。

---

## 2. CUA 实际使用（最需要你亲自验）

自动化只证明了「底层能力可用」，没证明「用户在界面里能用」。

### ⚠ 三个前提

1. **必须是本地 Windows 项目** —— SSH/WSL/Docker 工作区不支持（设计如此）
2. **两个开关必须开** —— 启用电脑控制 + 允许模拟键盘与拖拽
3. **改完设置必须重启应用** —— 预算与授权是 runtime 创建时一次性读取的

### 当前你的机器状态（我已确认）

```
computerUseInterferenceBudget      = unrestricted
computerUseAllowPhysicalInjection  = true
enabledPlugins[computer-use]       = true
```

开关都开着，所以直接测就行。

### 步骤

1. 新建任务 → 选**本地 Windows 目录**
2. 发送：
   ```
   打开记事本，把内容改成 hello-from-cua，然后读回来确认
   ```
3. 观察：
   - Agent 是否调用了电脑控制工具
   - 记事本内容是否真的变成 `hello-from-cua`
   - Agent 读回的结果是否与实际一致

- [x] Agent 真的操作了记事本（内容变了）
- [x] Agent 读回的内容与实际一致
- [x] **Agent 走的是电脑控制，不是用 shell 命令绕过**

> **怎么判断"绕过"**：如果它用 `powershell`、`type`、`Set-Content` 之类改文件，  
> 那不算 CUA 生效。真 CUA 会说"我看到窗口树/我点击了/我设置了元素值"。

### 顺便验键盘能力（本轮未测）

开关已开，可以一起测：

```
打开记事本，在光标处输入 hello-keyboard，然后读回来
```

- [x] 键盘输入生效（`type` / `key`）

---

## 3. 浏览器控制（本轮一并修好的）

和 CUA 共用 `node_repl` 宿主，一起坏的，也一起修好了。

1. 新建任务 → 选本地 Windows 项目
2. 发送：
   ```
   打开内置浏览器，访问 example.com，截图给我看
   ```
3. 观察是否真的打开浏览器并返回截图/页面内容

- [x] 浏览器能打开
- [x] 能访问页面
- [x] 能截图

---

## 4. 升级路径（门禁第 3 项）

**这一项必须等 Release 发布后才能测**，因为升级链路依赖 GitHub Release 真实存在。

### 顺序

```
先发 Release → 再装回 0.2.5 → 测升级
```

### 你发 Release 之后，我会做的事

1. 打 tag `v0.2.6`
2. `gh release create --repo ShiZiMiao/RaspberryCode`
3. 上传 6 个资产：

```
RaspberryCode-0.2.6-win-x64.exe                    191,469,851
RaspberryCode-0.2.6-win-x64.exe.blockmap
latest.yml
raspberrycode-server-linux-x64.tar.gz               92,975,940
raspberrycode-server-linux-arm64.tar.gz             91,915,074
source-server-release.json
```

> **两个 Server 包必须上传。** 你确认过「同版本兼容，升级时本地远端同时升级」，  
> 所以 0.2.6 发布后所有 0.2.5 的远端都会被判「必须升级」。Release 里没有  
> 0.2.6 的 Server 包，老用户远端会卡死。macOS 按你的指示不做。

### 步骤（Release 发布后）

1. 装回 **0.2.5**
2. 启动，确认版本 `0.2.5.0`
3. 触发检查更新
4. 确认出现 0.2.6 提示
5. **下载** —— 观察速度
   > 镜像实测 1301KB/s vs 直连 57KB/s。如果这里很慢，说明镜像没生效。
6. 安装并重启，确认版本变 `0.2.6.0`
7. 确认任务历史/设置还在

- [ ] 0.2.5 装得上
- [ ] 能检测到 0.2.6
- [ ] 下载成功且速度正常
- [ ] 重启后版本变 0.2.6
- [ ] 数据未丢失

### 顺带验：旧缓存自动修复

装完 0.2.6 后跑这条，确认缓存被刷新（我已实测通过，你可以复核）：

```powershell
$P = "C:\Users\lecoo\.raspberrycode\cli\plugins\cache\raspberrycode-plugins-official\node-repl-host\0.7.0"
Get-Content "$P\.raspberrycode-plugin\plugin.json" | Select-String version
Test-Path "$P\node_modules\koffi\build\koffi\win32_x64\koffi.node"
```

期望：manifest 是 `0.7.0`，koffi 为 `True`。

- [x] 旧缓存自动修复，无需手工清理

---

## 5. 远程连接（门禁第 4 项）

> **0.2.5 就是漏了这项才出的全量故障。这项不能跳。**

### 你当前环境已知问题

日志里有一条：

```
Source Server 0.1.0 must be upgraded to at least 0.2.6
```

你的 WSL 远端 Server 是 **0.1.0**，低于最低要求。所以这一项**本来就该失败**，  
正好可以用来验证「升级链路是否工作」。

### 步骤

1. 新建任务 → 远程连接 / SSH
2. 选一台真实可达的远端
3. 连接，观察：
   - 是否识别设备
   - 是否自动安装/升级 Source Server
   - 是否能进入远端工作区
4. 在远端跑 `pwd`

- [x] 能连上远端
- [x] Source Server 安装/升级成功
- [x] 能进入远端工作区
- [x] 远端能执行命令
- [x] 远端工作区里设置→电脑控制显示"当前环境暂不支持"（这是正确的）

> ⚠ 若报 `Unable to resolve Source Server release descriptor`：  
> 说明发布根或远程资产有问题，**立刻停下告诉我**，别继续——这正是 0.2.5 的故障。

> ⚠ 若报 `must be upgraded to at least 0.2.6`：  
> 说明 Release 里没有 0.2.6 的 Server 包，或远端下载失败。也是阻塞项。

---

## 6. 新建对话 + 功能页点验（门禁第 5、6、7 项）

### 6.1 新建对话收回复

1. 新建任务，选本地项目目录
2. 发：`只回复两个字：收到`
3. **确认真的收到模型回复**（不是只看界面回显、不是一直转圈）

- [ ] 收到真实模型回复

### 6.2 文件编辑 / 终端

1. 让 Agent 创建一个文件
2. 确认文件真的出现
3. 终端面板跑 `echo test`

- [ ] Agent 能创建/修改文件
- [ ] 终端能执行命令

### 6.3 设置页逐项点过

- [ ] 常规 / 外观
- [ ] 模型 / Provider（确认 BYOK 配置还在）
- [ ] 电脑控制
- [ ] MCP 服务器
- [ ] 技能
- [ ] 插件（含插件市场能打开）

### 6.4 UI 截图

- [ ] 至少截一张主界面 + 一张设置页，确认无错位/重叠/截断

---

## 7. 全部确认后告诉我

回「都过了」或指出问题。我会打 tag、建 Release、上传 6 个资产、推送代码。

---

## 附：出问题时的排查入口

| 现象                          | 先看哪里                                                                   |
| --------------------------- | ---------------------------------------------------------------------- |
| 界面停在闪屏                      | 是否加了 `--force-renderer-accessibility`；去掉再试                             |
| Agent 说没有 node_repl         | 检查 `cache/.../node-repl-host/0.7.0/node_modules/koffi` 是否存在            |
| CUA 报 `helper 启动前退出 code=1` | 检查安装态 `agent/packages/raspberrycode-cua/dist/helper/windows-helper.js` |
| 设置页显示"当前环境暂不支持电脑控制"         | 是否在远程工作区                                                               |
| 开关开了但 Agent 不会用             | 是否**重启过应用**；是否本地项目                                                     |
| Agent 说成功但记事本没变             | 记事本改内存文档不自动保存，让它读回树里的 `document value`                                 |
| 远程报"无法解析发布描述符"              | 发布根是否可下载；Release 是否上传了资产                                               |

日志：

```
C:\Users\lecoo\.raspberrycode\v2\logs\        ← 主程序日志（按日期）
C:\Users\lecoo\.raspberrycode\cli\log\        ← Agent 日志
```
