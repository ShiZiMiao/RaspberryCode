# RaspberryCode 0.2.6 发版前人工确认清单（第三版）

- 生成时间：2026-11-20 16:45
- 产物：`packages\desktop\dist\RaspberryCode-0.2.6-win-x64.exe`
  - **191,463,587 bytes（182.59 MB）**，构建 11-20 16:35
- 代码：HEAD `170f482b`，工作区干净，**未打 tag、未建 Release**
- 已安装：主程序 size 246,346,240，mtime 16:35，与产物一致

---

## 这一版和 v2 的区别（重要）

你在 v2 上打了钩，但**那些钩是在 13:58 的旧包上打的**。16:35 的新包多了一个修复：

| 提交         | 内容          | 影响                |
| ---------- | ----------- | ----------------- |
| `f02833e3` | 草稿目录失效时自动重建 | **修掉"永久无法创建新任务"** |

所以 §1（新建任务）**必须重测**。其余勾选过的项可以沿用，但如果时间方便，建议整轮再过一遍——毕竟换了包。

---

## 0. 我已经验证完的（不用重复）

| 项                      | 结果                   | 证据                                                             |
| ---------------------- | -------------------- | -------------------------------------------------------------- |
| 产物与源码一致                | PASS                 | 主程序 size 246,346,240，dist 与安装态一致                               |
| 自愈修复进包                 | PASS                 | 安装态 bundle 里 `project.directory-required` 出现 **0 次**（旧抛错点已删）   |
| CUA 宿主资产               | PASS                 | 宿主编译 `0.7.0`、koffi 就位、Helper 存在                                |
| CUA 修复标记               | PASS                 | bundle 含 `cuaHelperEntry`×2、`RASPBERRYCODE_CUA_HELPER_ENTRY`×4 |
| **安装版 CUA 端到端**        | **10 PASS / 0 FAIL** | `cua-verify-installed.mjs`，**连续三次**复现                          |
| 自愈回归测试                 | **3 passed**         | 含"目录已消失 + reuseDraft=true → 应重建"                               |
| 旧缓存自动修复                | PASS                 | 缓存 `0.7.0` 的 koffi 与 manifest 均已就位                             |
| 脏 draft 记录已清           | PASS                 | localStorage 里已无 `pending-task-draft` 残留                       |
| 16:00 后 prepareSession | **0 失败**             | 日志统计                                                           |
| 快捷方式                   | 两个都在                 | 桌面 + 开始菜单                                                      |
| 图标资源                   | 正常                   | `icon.ico` 含 7 个尺寸（16→256），32bpp                               |
| 远程 Source Server       | **已升到 0.2.6**        | 两个 profile 均 `installed`                                       |

**仍需你亲自验的**：新建任务（新包）、功能页逐项、升级全程、Agent 实际使用感受。

---

## 1. 新建任务（本轮必测，因为换了包）

这是上一版卡死你的地方，新包修的就是它。

1. 打开应用（正常双击，**不要加任何命令行参数**）
2. 点左侧「新建任务」
3. 在输入框发一句：`只回复两个字：收到`
4. 确认：
   - 没有出现 `project.directory-required` 红框
   - 真的收到模型回复
   - 左侧任务列表新增了这一条

- [x] 点「新建任务」没有报错
- [x] 能发出消息
- [x] 收到真实模型回复
- [x] 任务出现在左侧列表

### 如果还报 `project.directory-required`

请把这条命令的输出发我：

```bash
python -c "
import glob,re
for p in glob.glob('C:/Users/lecoo/.raspberrycode/session/Local Storage/leveldb/*.log'):
    s=open(p,'rb').read().decode('utf-8','ignore')
    for m in re.finditer(r'pending-task-draft:v1:[^\x00]{0,220}', s): print(m.group(0)[:200])
"
```

---

## 2. 卸载重装（你 v2 勾过，新包建议再走一次）

1. 卸载 → 确认程序目录与快捷方式都消失（`~/.raspberrycode` 应保留）
2. 安装 `RaspberryCode-0.2.6-win-x64.exe`
3. 确认版本 `0.2.6.0`
4. **双击桌面快捷方式**启动

- [x] 卸载干净
- [x] 安装成功，版本 `0.2.6.0`
- [x] 桌面快捷方式可双击启动
- [x] 开始菜单快捷方式可启动
- [x] 界面完整，历史任务还在

---

## 3. CUA 电脑控制（你 v2 勾过，可用新包抽查一次）

### 前提：必须本地 Windows 项目，三个开关要开

当前你的机器状态（我已确认）：

```
computerUseInterferenceBudget      = unrestricted
computerUseAllowPhysicalInjection  = true
enabledPlugins[computer-use]       = true
```

> 改过设置必须**重启应用**才生效——这些是 runtime 创建时一次性读取的。

### 步骤

新建任务（本地目录）→ 发：

```
打开记事本，把内容改成 hello-from-cua-2，然后读回来确认
```

- [x] Agent 真的操作了记事本
- [x] 读回内容与实际一致
- [x] **用的是电脑控制，不是 shell 命令绕过**

> 判断"绕过"：如果它用 `powershell` / `Set-Content` 改文件，不算 CUA 生效。  
> 真 CUA 会说"我看到窗口树 / 我点击了 / 我设置了元素值"。

- [x] 键盘输入也能用（`type` / `key`）

### 已知的假失败（别被误导）

我实测遇到过两种**看起来像 CUA 坏了、其实是环境问题**的情况：

1. **残留记事本进程**：Win11 会留下无窗口的记事本进程，或上一个用例的窗口标题还含 `.txt`，  
   导致 `getApp` 抓错窗口 → 报「未找到 document 行」。  
   **处理**：先 `taskkill /IM notepad.exe /F` 再试。
2. **系统资源紧张**：实测 CPU 43% / 可用内存 4.3GB 时，Helper 会偶发  
   `helper 请求超时` 或 `helper 已熔断，需要重建 runtime`。  
   **处理**：关掉些程序，**重启应用**，再试。干净环境下我连续三次 10/0。

---

## 4. 浏览器控制（你 v2 勾过）

发：`打开内置浏览器，访问 example.com，截图给我看`

- [x] 浏览器能打开
- [x] 能访问页面
- [x] 能截图

---

## 5. 远程连接（你 v2 勾过，状态已确认变好）

我核实过：两个 profile 的 Source Server **都已升到 0.2.6**（`installed`）。

日志里最后一次 `must be upgraded to at least 0.2.6` 是 **14:59**，之后没有了。

- [x] 能连上远端
- [x] Source Server 版本显示 0.2.6
- [x] 能进入远端工作区
- [x] 远端能执行命令
- [x] 远端工作区里「电脑控制」显示暂不支持（这是设计如此，不是 bug）

> ⚠ 若再出现 `Unable to resolve Source Server release descriptor` 或  
> `must be upgraded to at least 0.2.6`，**立刻停下告诉我**——这是 0.2.5 的故障形态。

---

## 6. 功能页逐项点过

- [x] 常规 / 外观
- [x] 模型 / Provider（BYOK 配置还在）
- [x] 电脑控制
- [x] MCP 服务器
- [x] 技能
- [x] 插件（插件市场能打开）
- [x] 文件编辑：让 Agent 建个文件，确认真的出现
- [x] 终端：跑 `echo test`
- [x] 至少截一张主界面 + 一张设置页

---

## 7. 升级路径（**必须等 Release 发布后**）

升级链路依赖 GitHub Release 真实存在，现在测不了。

### 发 Release 时上传这 6 个

```
RaspberryCode-0.2.6-win-x64.exe              191,463,587
RaspberryCode-0.2.6-win-x64.exe.blockmap
latest.yml
raspberrycode-server-linux-x64.tar.gz         92,975,940
raspberrycode-server-linux-arm64.tar.gz       91,915,074
source-server-release.json
```

> 两个 Server 包**必须上传**。你确认过「升级时本地远端同时升级」，  
> 0.2.6 发布后所有旧版远端都会被判必须升级，Release 里没有 0.2.6 的  
> Server 包，老用户远端会卡死。macOS 按你的指示不做。

### 步骤（Release 之后）

1. 装回 **0.2.5**
2. 启动，确认版本 `0.2.5.0`
3. 触发检查更新 → 应出现 0.2.6
4. **下载** —— 留意速度（镜像实测 1301KB/s vs 直连 57KB/s；很慢说明镜像没生效）
5. 安装并重启 → 版本变 `0.2.6.0`
6. 确认任务历史 / 设置还在

- [ ] 0.2.5 装得上
- [ ] 能检测到 0.2.6
- [ ] 下载成功，速度正常
- [ ] 重启后版本变 0.2.6
- [ ] 数据未丢失

---

## 8. 图标（已定位：你的电脑问题，不是打包缺陷）

我验证过：`icon.ico` 含 7 个尺寸（16/24/32/48/64/128/256），32bpp，文件完全正常；  
快捷方式指向也正确。

这是 **Windows 图标缓存**问题。我已清了 13 个 `iconcache*.db`，4 个被 explorer 占用。

**如果还看不到图标**，跑这个（会重启资源管理器）：

```powershell
taskkill /f /im explorer.exe
Start-Sleep 2
Remove-Item "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache*" -Force -ErrorAction SilentlyContinue
start explorer.exe
```

- [ ] 开始菜单能看到图标  
  （如果清了缓存还是没有，告诉我，我再查是不是 ico 编码兼容问题）

---

## 9. 全部确认后告诉我

回「都过了」或指出问题。我会打 tag、建 Release、上传 6 个资产、推送代码。

---

## 附：排查入口

| 现象                             | 先看                                                                   |
| ------------------------------ | -------------------------------------------------------------------- |
| 界面停闪屏                          | 是否加了 `--force-renderer-accessibility`（去掉）                            |
| 报 `project.directory-required` | 见 §1 的 localStorage 检查命令                                             |
| Agent 说没有 node_repl            | `cache/.../node-repl-host/0.7.0/node_modules/koffi` 是否存在             |
| CUA 报 `helper 启动前退出 code=1`    | 安装态 `agent/packages/raspberrycode-cua/dist/helper/windows-helper.js` |
| CUA 报 `helper 已熔断`             | **重启应用**（进程级熔断状态）                                                    |
| CUA 报「未找到 document 行」          | 残留记事本 → `taskkill /IM notepad.exe /F`                                |
| 设置页显示"当前环境暂不支持"                | 是否在远程工作区（设计如此）                                                       |
| 远程报"无法解析发布描述符"                 | 发布根可下载性；Release 是否传了资产                                               |

### 验证脚本（我可以跑，你也可以）

```bash
cd D:\projects\RaspberryCode
node scripts/cua-verify-installed.mjs        # 期望 10 PASS / 0 FAIL
```

> 跑之前先关掉记事本，并确保系统不太卡（内存 > 8GB 可用、CPU < 30%），  
> 否则会假失败。

### 日志位置

```
C:\Users\lecoo\.raspberrycode\v2\logs\     ← 主程序日志（按日期）
C:\Users\lecoo\.raspberrycode\cli\log\     ← Agent 日志
```
