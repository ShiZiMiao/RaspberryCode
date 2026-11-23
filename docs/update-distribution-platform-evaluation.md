# 客户端更新分发平台选型测评

> 测评时间：2026-11-23
> 测评动机：现有 GitHub Releases + 镜像方案在国内普通用户（无代理）环境下，检查更新稳定报
> `net::ERR_CONNECTION_TIMED_OUT`。需评估国内平台作为更新分发源。
> 测评方式：**本机实测**（无代理直连，模拟普通用户），非文档推断。
>
> 覆盖范围（五轮迭代）：
> 1. 代码托管 / Release 型：Gitee、GitCode、AtomGit、Codeberg、GitLab.com、CNB
> 2. DevOps 一体化（制品库型）：腾讯 CODING、阿里云云效 Codeup、华为云 CodeArts
> 3. 对象存储 / CDN：腾讯云 COS、阿里云 OSS、七牛云
> 4. GitHub 加速镜像站（7 家）、npm 通道、公共 CDN、边缘托管、自建 VPS
> 5. **产品生命周期核查（第六章）——此项曾推翻前序推荐**
>
> 六、产品生命周期核查 · 七、选型建议 · 八、零改造救急方案 · 九、实施结果 · 十、剩余决策
>
> **当前状态（2026-11-23）**：已实施镜像方案（gh-proxy.com，前缀可配置），
> CNB 作为备用路线记录、暂未接入。见第九章。

## 一、硬指标定义

客户端自更新对分发平台有四条不可妥协的要求，缺任一条都会导致用户更新失败：

| 指标 | 为什么是硬要求 |
| --- | --- |
| **匿名下载** | 普通用户不会有平台账号/token。需求登录即为不可用。 |
| **Range 支持（206）** | 决定能否差量更新。不支持则每版都要下 183MB 整包。 |
| **单文件 > 183MB** | 当前安装包实测 183MB（191,467,906 字节）。超标即无法上传。 |
| **国内直连速度** | 用户无代理。速度 < 500KB/s 时 183MB 需 6 分钟以上，体验不可接受。 |

附带的次要要求：URL 形态能否被 electron-updater 直接使用（减少改造量）、总量能否留存历史版本。

## 二、实测结果总表

### 2.1 代码托管 / Release 型平台

| 平台 | 匿名下载 | Range | 单文件上限 | 免费总量 | 实测速度 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **腾讯云 CNB**<br>`cnb.cool` | ✅ 200 | ✅ **206** | ✅ 实测 246MB 通过 | **100 GiB** | **5.0 MB/s** | ✅ **可用** |
| **Gitee**<br>`gitee.com` | ✅ 200 | ❌ 忽略 | ❌ **50MB**（个人）/ 100MB（标准版 ¥299/人/年） | ❌ 1 GB | 1.7–2.0 MB/s | ⚠️ 需瘦身+放弃差量 |
| **GitLab.com**<br>`gitlab.com` | ✅ 200 | ✅ **206** | ✅ 无限 | 10 GB | 2.6 MB/s | ✅ 可用（境外） |
| **Codeberg**<br>`codeberg.org` | ✅ 200 | ✅ 206 | ✅ 无限 | 无限 | ❌ **94 KB/s** | ❌ 速度不可用 |
| **GitCode**<br>`gitcode.com` | ❌ **401** | — | — | — | — | ❌ 排除 |
| **AtomGit**<br>`atomgit.com` | ❌ **401** | — | — | — | — | ❌ 排除 |
| **jsDelivr**<br>`cdn.jsdelivr.net` | ❌ 403 | — | 20 MB | — | — | ❌ 只代理仓库内文件 |
| GitHub + 镜像<br>（现状） | ✅ | ✅ 206 | 2 GB | 不限 | 镜像 1.3MB/s / 直连 34KB/s | ❌ 检查阶段不可靠 |
| **GitHub + gh-proxy.com**<br>（换镜像，零改造） | ✅ 200 | ✅ **206** | 2 GB | 不限 | **9.6 MB/s** | ✅ **可救急，但第三方稳定性不可控** |

### 2.2 DevOps 一体化平台（制品库形态）

这类平台的二进制走「制品库」而非 Release，需单独评估。

| 平台 | 匿名下载 | Range | 单文件上限 | 免费额度 | 实测速度 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **腾讯 CODING**<br>`coding.net` | ✅ 200 | ✅ **206**（跟随 307） | ✅ **5 GB** | 5 GB 存储 / 20GB 月流量 | **5.4 MB/s** | ❌ **技术达标但产品退市（2028-09-30 停服），排除** |
| **阿里云云效**<br>`codeup.aliyun.com` | ❌ 默认私有 | — | ❌ **50 MB**（Release 附件） | 制品 10 GiB | — | ❌ 双重硬伤 |
| **华为云 CodeArts**<br>`devcloud.huaweicloud.com` | ❌ 需鉴权 | — | — | — | — | ❌ 排除 |

### 2.3 对象存储 / CDN（自建分发）

不依赖代码托管平台，直接把安装包当静态对象分发。

| 方案 | 匿名下载 | Range | 单文件上限 | 成本 | 结论 |
| --- | --- | --- | --- | --- | --- |
| **腾讯云 COS** | ✅ 需配公共读 | ✅ 206 | 无（分片上传 48.8TB） | 存储 0.118 元/GB/月 + 外网下行 0.5 元/GB | ✅ 技术最优，需自建发布流程 |
| **阿里云 OSS** | ✅ 需配公共读 | ✅ 206 | 无 | 存储 0.12 元/GB/月 + 外网下行 0.5 元/GB | ✅ 同上 |
| **七牛云 / 又拍云** | ✅ 需配公开 | ✅ 206 | 无 | 有免费额度，按量计费 | ✅ 同上 |

## 三、逐平台实测证据

### 3.1 腾讯云 CNB — 代码托管型里的最佳

**匿名下载**（腾讯官方 CubeSandbox 公开仓库）：

```
GET https://cnb.cool/CubeSandbox/CubeSandbox/-/releases/download/v0.6.0/cube-sandbox-one-click-v0.6.0-amd64.tar.gz
→ HTTP/1.1 302 Found
→ Location: https://asset.cnb.cool/assets/t/<token>
→ 跟随: HTTP 200
```

**Range 支持**（决定性指标，在签名地址 `asset.cnb.cool` 上测）：

```
Range: bytes=0-1023          → 206, size=1024   ← 精确
Range: bytes=1000000-1001023 → 206, size=1024   ← 精确
```

**容量**：完整下载 258,285,119 字节（246 MiB）单文件成功，远超 183MB 需求。
官方免费额度：对象存储（制品/LFS/附件）**100 GiB**，按 183MB/版可存 500+ 个版本。

**速度**：

```
完整下载 258MB / 48.7 秒 = 5,307,017 B/s ≈ 5.0 MB/s
并发 3 路：各 5.0 MB/s，合计 15 MB/s（不降速）
```

**URL 稳定性**：两次间隔请求均 200（每次重新签发临时 URL，`cnb.cool` 入口地址长期有效）。

**已知限制**：

- ❌ **没有可用的 `latest` 别名**。`.../releases/download/latest/<file>` 会 302 到一个无效签名，
  最终 **404**（官方文档亦确认「There is no anonymous `latest` alias」）。
  → 清单文件不能依赖别名，必须把具体 tag 写进客户端，或用 raw 文件承载清单。
- ❌ **API 需鉴权**。`https://api.cnb.cool/<owner>/<repo>/-/releases/latest` 返回 **401**。
  → 客户端不能靠 API 查最新版本号。
- ✅ 替代方案：`/-/git/raw/<branch>/<path>` **匿名可读**（实测 200），可把 `latest.yml`
  放在仓库里，客户端从 raw 读取版本号，再从 Release 取包。

---

### 3.1.1 CNB 深度调研（2026-11-23 追加，针对「是否真的符合需求」）

前几轮只验证了「能不能下载」。本轮按 electron-updater 的实际请求路径逐环验证。

#### A. API 鉴权 vs 网页路径 —— 关键区分

CNB 的 OpenAPI（`api.cnb.cool/swagger.json`，201 个端点）里**所有 Release 端点都标了
`security: YES`**。若只看文档会得出「必须登录」的错误结论。实测区分：

```
API 端点（api.cnb.cool）：
  GET /CubeSandbox/CubeSandbox/-/releases/latest  → 401
  GET /CubeSandbox/CubeSandbox/-/releases          → 401

网页路径（cnb.cool，用户浏览器/客户端实际访问）：
  GET /CubeSandbox/CubeSandbox/-/releases                                  → 200
  GET /CubeSandbox/CubeSandbox/-/releases/download/v0.6.0/<file>            → 200 → 302 → 200
```

→ **结论：API 要 token，但分发路径匿名可用。** 这正是自动更新需要的形态。

#### B. 断点/差量下载的关键验证 —— 签名 URL 一次性

发现签名地址**复用会失效**：

```
从 cnb.cool 入口取到签名 URL：https://asset.cnb.cool/assets/t/<token>
直接复用该签名 URL        → 404（一次性）
```

这看起来会阻断差量更新（`singleRangePatch` 需要多次 Range 请求）。但实测：

```
同一 cnb.cool 入口连续三次不同区间 Range：
  bytes=1000000-1001023 → 206, size=1024
  bytes=2000000-2001023 → 206, size=1024
  bytes=3000000-3001023 → 206, size=1024
```

→ **每次都从入口重新签发，因此差量更新可行。** 前提是客户端始终请求 `cnb.cool` 入口，
绝不能缓存 `asset.cnb.cool` 的签名地址。electron-updater 天然如此（它只认清单里的 URL）。

#### C. 302 + Range 的交互（是否丢 Range 头）

```
不跟随：HTTP/1.1 302 → Location: https://asset.cnb.cool/assets/t/<token>
跟随：  206, size=1024
```

electron-updater 用 `redirect: "manual"` + `addRedirectHandlers` 自行跟随，
经 `prepareRedirectUrlOptions` 处理跨域重定向。已核对 `builder-util-runtime` 源码：

```js
SENSITIVE_REDIRECT_HEADERS = ["authorization","proxyauthorization","privatetoken",
  "xapikey","xauthtoken","xaccesstoken","xgitlabtoken","cookie","xcsrftoken"]
```

`range` 不在清单内 → **跨域重定向保留 Range 头，差量不丢**。

#### D. 无 `latest` 别名时，清单如何落地（核心设计约束）

CNB 无可用 `latest` 别名（`.../download/latest/<file>` → 404）。两种绕法，第二种更优：

**绕法 1（不推荐）**：把 `latest.yml` 也作为 Release 附件。但 tag 一变 URL 就变，
客户端不知道新 tag，死循环。

**绕法 2（推荐，已验证可行）**：清单放仓库 raw，资产 URL 在清单里写**绝对地址**。

```
base（客户端 feedURL）= https://cnb.cool/<owner>/<repo>/-/git/raw/<branch>/updates
步骤 1：GET {base}/latest.yml                    → 200（raw 匿名可读，~200ms）
步骤 2：清单内 url 写绝对地址，由 newUrlFromBase 解析
        → https://cnb.cool/<owner>/<repo>/-/releases/download/v0.2.8/<file>
步骤 3：对该资产发 Range → 206
```

已用 Node 实测 `newUrlFromBase` 对三种 url 写法的解析：

| 清单里 url 字段 | 解析结果 | 可用性 |
| --- | --- | --- |
| `RaspberryCode-0.2.8-win-x64.exe` | `{raw}/updates/<file>`（错误地点） | ❌ 会 404 |
| `https://cnb.cool/<o>/<r>/-/releases/download/v0.2.8/<file>` | 原样保留 | ✅ |
| `/<o>/<r>/-/releases/download/v0.2.8/<file>` | 解析为 cnb.cool 根路径 | ✅ |

→ **判定：可行，但发布脚本必须把绝对 URL 写进清单**（不能沿用 electron-builder
默认生成的相对文件名）。这是接入 CNB 唯一需要定制的环节。

#### E. 制品的另一条路（不推荐）

CNB 还有「制品库（packages）」，但实测：

```
GET api.cnb.cool/<repo>/-/packages                    → 401
GET api.cnb.cool/<repo>/-/packages/generic/<name>     → 401
GET cnb.cool/<repo>/-/packages/generic/...（下载形态） → 400（无明确匿名下载路径）
```

→ 制品库没有可用的匿名下载路径。**Release 附件是 CNB 上唯一验证过可匿名分发的通道。**

#### F. 并发与限流

```
并发 6 路：各 5.12–5.16 MB/s，合计约 30 MB/s（无降速）
连续 10 次 raw 请求：10/10 全部 200（未触发限流）
raw 响应时间：0.20–0.23s
```

#### G. 发布 API 完整性（发版可自动化）

`swagger.json` 里的 `PostReleaseForm` / `PostReleaseAssetUploadURLForm`：

```
创建 Release：tag_name, name, body, draft, make_latest, prerelease, target_commitish
取上传地址：  asset_name, size, overwrite, ttl
两步上传：    POST asset-upload-url → 上传到 upload_url → POST asset-upload-confirmation
```

→ 字段齐全（含 `overwrite` 覆盖与 `ttl`），发版脚本可完整自动化，
不依赖网页手工操作。

#### H. 与 electron-updater 的集成度

```
setFeedURL("https://cnb.cool/<o>/<r>/-/git/raw/<branch>/updates")
→ 走 GenericProvider（electron-updater 对字符串参直接选 generic）
→ 只发 1 条清单请求，不再有 atom / releases/latest 两条
→ noCache 查询参数对 CNB raw 无影响（实测带 ?noCache=abc 仍 200）
```

→ **反而比现在的 github provider 更简单**：检查阶段从 3 条请求降到 1 条，
且这条请求是验证过匿名可用的。原有的镜像重写、按阶段切代理全部可以删掉。

#### I. CNB 的不足之处（如实记录）

| 项目 | 情况 |
| --- | --- |
| `latest` 别名 | ❌ 无，必须靠 raw 清单承载版本 |
| API 查版本 | ❌ 需 token，客户端不能用 |
| 制品库匿名 | ❌ 无可用路径，只能用 Release 附件 |
| 清单需定制 | ⚠️ 发布脚本必须写绝对 URL，不能直接用 electron-builder 产物 |
| 流量政策 | ✅ 计费项只有存储+计算，不含下载流量（政策可能调整） |
| 平台定位 | ⚠️ 腾讯云新产品（2024-11 公测），生态与工具链仍在成熟中 |

### 3.2 Gitee — 可用但两项硬伤

**匿名下载**：`foruda.gitee.com` CDN，Release 附件免登录（实测 200）。

**Range 不支持**（在最终 CDN 上测，排除跳转干扰）：

```
Range: bytes=0-1023 → 200, size=15,777,884  ← 返回整个文件
```

**上限硬伤**：

- 单附件 **100MB**（GVP 项目 200MB）→ 当前 183MB 包 **无法直接上传**
- 单仓库附件总量 **1GB** → 按 183MB 算仅够 5 个版本

**速度**：单路约 2.0MB/s；并发 3 路各降至 1.7–2.0MB/s（无明显增益）。

### 3.3 GitLab.com — 境外但意外可用

用 **Packages Generic Registry** 存二进制（正规做法，非 Release 附件）：

```
Accept-Ranges: bytes
Range: bytes=0-1023 → 206, size=1024
实测速度 2,615,962 B/s ≈ 2.6 MB/s（托管在 Google Cloud Storage）
```

限制：境外服务，国内部分地区可能不稳；免费 10GB 存储。

### 3.4 Codeberg — Range 支持但速度致命

```
accept-ranges: bytes
Range: bytes=0-1023 → 206, size=1024
实测速度 94,682 B/s ≈ 94 KB/s  ← 183MB 需约 32 分钟
```

### 3.5 腾讯 CODING — 技术上曾是最佳，但已退市

> ⚠️ **结论先行**：本节的技术实测数据全部有效（证明了它的能力），但该产品已进入退市
> 阶段（2028-09-30 全面停服），**不可选用**。详见第六章生命周期核查。
> 保留本节是为了说明「为什么它曾经看起来最合适」，以及记录 CNB 的技术血缘。

二进制走**制品库 Generic**（不是 Release 附件）。公开制品库可匿名下载：

```
GET https://coding-public-generic.pkg.coding.net/public/downloads/helm-linux-amd64.tar.gz?version=v3.7.1
→ HTTP/1.1 200 OK, Content-Length: 13862382（匿名可下）
```

**Range 需要跟随一次 307**（`coding-public-generic` → 腾讯云 COS）：

```
不带 -L：Range: bytes=0-1023 → 307, Location: artifacts-production-*.file.myqcloud.com/...
带 -L ：Range: bytes=0-1023        → 206, size=1024   ← 精确
         Range: bytes=1000000-1001023 → 206, size=1024   ← 精确
```

→ **关键要求：electron-updater 必须跟随重定向**（它默认跟随，因此可用）。

**容量与成本**（官方文档）：

- Generic 制品单文件上限 **5 GB**（远超 183MB）
- 标准版**免费**：5 GB 制品存储 + 20 GB/月流量
- 支持**公开制品库**（这是它相对阿里云云效的决定性优势）

**速度**：`13,862,382 字节 / 2.58 秒 = 5,377,090 B/s ≈ 5.4 MB/s`（托管在腾讯云 COS）。

### 3.6 阿里云云效 — 双重硬伤，排除

**硬伤一：Release 附件上限 50MB**（官方文档原文）：

> 同一个发行版最多支持10个附件，单个附件大小需<50M，单库总附件大小需<1G，
> 组织附件总容量需<20G。

→ 比 Gitee 的 100MB 还低，183MB 完全不可能。

**硬伤二：Codeup 默认私有，不支持完全公开**（阿里云开发者社区答复）：

> 云效Codeup默认是私有仓库，不支持公有仓库。

→ 且其制品库「设置公开性只有两个选项：私有和企业内可见」（第三方选型实测记录）。
→ 匿名用户无法下载，普通用户更新不可用。

### 3.7 华为云 CodeArts — 需鉴权，排除

```
GET https://devcloud.cn-north-4.huaweicloud.com          → 200（首页）
GET https://devcloud.cn-north-4.huaweicloud.com/v1/repositories → 需鉴权
GET https://repo.huaweicloud.com/repository/maven/       → 403
```

→ 制品仓库需账号鉴权，无法匿名分发给普通用户。

### 3.8 对象存储 / CDN — 技术最优但需自建

在已知公开桶的最终 CDN 地址上验证：

```
Accept-Ranges: bytes
Range: bytes=0-1023 → 206, size=1024
```

能力上完全满足（Range、无限单文件、无限总量、可上 CDN）。
代价是需要自己搭发布流程（上传 + 写清单 + 生成 URL），且**必须显式配置「公共读」**，
否则默认私有（实测 COS/OSS/OBS 裸域名均返回 403）。

成本（腾讯云 COS 官方定价）：

- 存储：0.118 元/GB/月 → 存 10 个历史版本（1.83GB）约 **0.22 元/月**
- 外网下行流量：0.5 元/GB → 每次完整更新 183MB 约 **0.09 元/次**
- 免费额度：新用户 50GB 存储 6 个月 + 每月 10GB 外网流量

按每月 1000 次更新估算：183MB × 1000 = 183GB → 流量费约 **91 元/月**。
若走 CDN 加速则另算（CDN 流量 + 回源 0.15 元/GB）。

### 3.9 GitHub 加速镜像站的批量实测（32 家榜单筛查）

来源：`git.hiwiki.org/zh-CN/mirrors` 镜像榜单（66 家，其中 32 家标记「正常」）。
榜单只有延迟/速度，**不足以判断能否用于自动更新**。实测按三条硬条件逐家筛：
① 能代理 `releases.atom` 且**内容是真实 Atom XML**；② 支持单 Range（206）；
③ 能正确返回 `latest.yml`。

#### 筛选结果：32 家「正常」→ 仅 5 家全过

| 镜像 | atom 状态 | atom 内容 | Range | 结论 |
| --- | --- | --- | --- | --- |
| **`gh-proxy.com`** | 200 | ✅ 21,349B 真实 XML | ✅ 206 | ✅ **首选** |
| **`g.z321.cc.cd`** | 200 | ✅ 21,349B | ✅ 206 | ✅ 入选 |
| **`gitproxy.127731.xyz`** | 200 | ✅ 21,349B | ✅ 206 | ✅ 入选 |
| **`cdn.akaere.online`** | 200 | ✅ 21,349B | ✅ 206 | ✅ 入选 |
| **`xsadwsd.kdns.fr`** | 200 | ✅ 21,349B | ✅ 206 | ✅ 入选（速度最慢） |
| `gh.acmsz.top` | 200 | ❌ **仅 2 字节 "ok"** | ✅ 206 | ❌ **假成功** |
| `777.z321.cc.cd` | 200（10s 勉强） | ✅ | ❌ 回 200 全量 | ❌ 无差量 |
| `gh.ddlc.top` | ❌ 429 | — | — | 限流 |
| `gh.idayer.com` | ❌ 402 | — | — | 付费墙 |
| `ghproxy.imciel.com` / `fastgit.cc` / `gg.z321.cc.cd` / `down.mxw.xx.kg` / `gh.my-website.ccwu.cc` / `gh.monlor.com` / `gh.dpik.top` / `ghproxy.monkeyray.net` | ❌ 404 | — | — | 不支持该路径 |
| `ghfast.top` / `github.tbap.top` / `gh.sixyin.com` / `free.cn.eu.org` / `git.669966.xyz` / `github.ednovas.xyz` / `ghproxy.net` / `github.xxlab.tech` / `g.blfrp.cn` | ❌ 403 | — | — | 拒绝代理 |
| `ghfile.geekertao.top` / `gh.07150721.xyz` / `ghproxy.felicity.land` | ❌ 530 | — | — | 源站/Cloudflare 错误 |
| `tvv.tw` / `cdn.gh-proxy.com` | ⚠️ 302 | — | — | 需看跳转目标是否有效 |

#### 最重要的发现：状态码 200 ≠ 可用

`gh.acmsz.top` 是这一批里**下载速度最快的（14.8MB/s）**，`releases.atom` 也返回 200。
但响应体只有 **2 字节，内容为 `ok`**——不是 Atom XML。electron-updater 拿到它会
`parseXml` 失败，报 `ERR_UPDATER_INVALID_RELEASE_FEED`。

**这类「假成功」比直接 403 更危险**：状态码看着正常，排查时容易误判成客户端问题。
因此候选镜像的入选判据必须包含**内容校验**，不能只看 HTTP 状态。

#### 速度不可作为排序依据（实测整段拥塞）

同一天不同时段，多家镜像速度差异极大，且会出现**同步塌陷**：

```
gh-proxy.com      9.6 MB/s（11:00 测） → 0.11–0.22 MB/s（13:15 测）
gh.acmsz.top      14.8 MB/s
g.z321.cc.cd      0.04–0.38 MB/s
gitproxy.127731   0.12–0.22 MB/s
直连 github.com   0.15 MB/s
CNB（对照组）      5.11 MB/s  ← 同期仍正常
```

**关键对照**：所有 GitHub 镜像同时掉到 0.1–0.4MB/s，而 CNB 仍有 5.1MB/s。
说明这不是镜像本身变差，而是「到 GitHub 出口方向」的链路在拥塞。
→ 结论：候选顺序只是「优先尝试」，**真正的可靠性来自轮换机制 + 直连兜底**，
不能寄希望于挑一个「永远快」的镜像。

#### 已落地

4 家合格镜像写进 `DEFAULT_UPDATE_MIRROR_CANDIDATES`（gh-proxy.com 为首）。
`UpdateDownloadFallback` 按顺序轮换，全用尽才降 direct。

### 3.9.1 gh-proxy.com 详细行为（首轮 7 家筛查时测）

前一轮结论是「镜像无法覆盖检查阶段」。补充测试了 7 个镜像站后发现**有例外**：

| 镜像 | atom | latest | latest.yml | 判定 |
| --- | --- | --- | --- | --- |
| `ghfast.top`（原用） | ❌ 403 | — | ✅ 200 | 检查阶段失效 |
| **`gh-proxy.com`** | ✅ **200（28KB 真实 XML）** | ✅ **200** | ✅ 200 | ✅ **全链路可用** |
| `ghproxy.link` | ⚠️ 307 → **JS 跳转页** | — | — | 机器请求不可用 |
| `gh-proxy.net` | ⚠️ 302 → **JS 跳转页** | — | — | 机器请求不可用 |
| `gh.llkk.cc` | ❌ 超时 | — | — | 不可用 |
| `github.moeyy.xyz` | ❌ 连不上 | — | — | 不可用 |
| `mirror.ghproxy.com` | ❌ 超时 | — | — | 不可用 |

**`gh-proxy.com` 实测（这是本轮最重要的发现）**：

```
检查阶段三条请求全部 200：
  releases.atom                    → 200, size=28,846（真实 Atom XML，非错误页）
  releases/latest                  → 200, size=71,817
  releases/download/v0.2.7/latest.yml → 200, size=359

atom 连续性（5 次）：
  #1 200/1.04s  #2 200/0.30s  #3 200/0.27s  #4 200/0.70s  #5 200/0.71s
  → 全部 200，无抖动

下载链路：
  Accept-Ranges: bytes
  Range: bytes=0-1023 → 206, size=1024
  速度：115,490,816 字节 / 12 秒 ≈ 9.6 MB/s（183MB 约 20 秒）

对比现用 ghfast.top：仅 1.3MB/s，且 atom 返回 403。
```

**意义**：如果只换镜像前缀（`DEFAULT_UPDATE_MIRROR_PREFIX`），并把镜像重写范围从
`/releases/download/` 扩大到全站，就能修复检查失败——**不需要换平台、不需要换 provider**。

**风险**：第三方公益镜像，稳定性与政策不可控（历史上已有多家关停）。
只能作为救急或双源之一，不能作为唯一方案。

### 3.10 其他已排除方案（新增）

**npm / npmmirror 通道**：

```
registry.npmmirror.com → 302 → cdn.npmmirror.com
Accept-Ranges: bytes, Range → 206
响应 191ms（国内快）
```

→ 技术上支持 Range 且快，但 npm registry **只能发布 npm 包**，无法托管 183MB 任意安装包。
且 npm 有单包体积限制。不可行。

**jsDelivr / BootCDN / Staticfile 等国内 CDN**：

```
cdn.staticfile.net  → 301
cdn.bootcdn.net     → 301
lib.baomitu.com     → 404
```

→ 这些是**公共库 CDN**，只镜像预设的开源库，不接受用户上传，不能用。

**Vercel / Netlify / Cloudflare Pages**：

```
vercel.app   → 超时（8s）
netlify.app  → 301（可访问但境外）
pages.dev    → 301（5.2s，慢）
```

→ 境外边缘托管，国内访问不稳；且 Vercel/Netlify 免费版有带宽与构建限制。不推荐。

**自建轻量服务器 + Nginx**：

- Nginx 原生支持 Range、无大小限制，技术可行
- 但带宽是瓶颈：3Mbps 下 183MB 约需 8 分钟，远慢于对象存储+CDN
- 成本 50–90 元/月，与对象存储相当但性能差，且需自行运维
- 结论：不如直接用对象存储

**Gitee 付费版**（补充核实）：

| 套餐 | 单文件上限 | 价格 | 是否解决 Range |
| --- | --- | --- | --- |
| 免费版 | **50MB** | 0 | ❌ |
| 标准版 | 100MB | ¥299/人/年（5 人起） | ❌ |
| 高级版 | 200MB | ¥399/人/年（5 人起） | ❌ |
| 尊享版 | 300MB | ¥499/人/年（5 人起） | ❌ |

→ 即便买到能装下 183MB 的档位（高级版起，年费 ¥1995+），**Range 仍然缺失**，
差量更新依然做不了。付费解决不了核心问题。

### 3.11 排除项证据

**GitCode**（CSDN 系）：

```
GET .../releases/download/v4.0.0/CIDE-4.0.0-x64-Setup.exe → 401 Unauthorized
GET .../releases                                          → 200（页面可看）
GET raw.gitcode.com/.../archive/...zip                    → 200（源码包可下）
```

→ Release 页面能打开、源码能下，唯独**二进制附件强制鉴权**。普通用户不可用。

**AtomGit**（开放原子基金会）：

```
GET .../releases/download/v2.11.0/v2.11.0.zip → 401
```

→ 同样问题，连源码包都需鉴权。

**jsDelivr**：

```
cdn.jsdelivr.net/gh/<repo>@main/package.json           → 200（仓库内文件）
cdn.jsdelivr.net/gh/<repo>@v0.2.7/<183MB exe>          → 403（不代理 Release 资产）
```

→ 只代理仓库内文件且单文件上限 20MB，无法承载安装包。

## 四、现状方案为何失败（作为对照）

electron-updater 的 github provider 每次检查发三条请求，而现有镜像重写规则
（`packages/desktop/src/main/autoUpdate/updateMirror.ts:39`）只匹配 `/releases/download/`：

| 请求 | 镜像能否接管 | 实测 |
| --- | --- | --- |
| `releases.atom` | ❌ 403 | 各家镜像支持不一致（ghfast 403 / gh-proxy 200） |
| `releases/latest` | ❌ 仅 302 | 不转发内容 |
| `.../download/<tag>/latest.yml` | ✅ 200 | 唯一被接管的 |

日志佐证：11-22 那次检查中 `atom` 与 `releases/latest` 的重定向记录数为 **0**，
重定向只发生在 `latest.yml` / `.blockmap` / `.exe`。无代理用户第一条就超时。

**结论：镜像方案在检查阶段无效，这是原理性的，不是镜像选得不好。**

## 五、付费与成本对比

各平台「够用」与否，先看免费额度是否覆盖，再看超额单价。按本项目实际用量估算：
183MB/版、假设每月发 2 版、存活 10 个历史版本（约 1.83GB）、每月 1000 次更新下载（约 183GB 流量）。

| 平台 | 免费额度是否够 | 超额单价 | 月成本估算 | 备注 |
| --- | --- | --- | --- | --- |
| ~~**腾讯 CODING**~~ | ❌ **免费版已于 2025-09-01 下线，且全产品 2028-09-30 停服** | — | — | **退市，排除** |
| **腾讯云 CNB** | ✅ 存储够（1.83 < 100GiB） | 存储 ¥1/GiB/月 | **0 元** | **计费项不含下载流量**（仅存储+计算），无流量天花板 |
| **阿里云云效** | ❌ 附件 50MB 上限直接不满足 | 制品存储 1 元/GiB/月 | 不适用 | 排除 |
| **腾讯云 COS** | ✅ 存储够（新用户 50GB×6 月） | 存储 0.118 元/GB/月 + 下行 0.5 元/GB | 存储 0.22 元 + 流量 **91 元** ≈ **91 元/月** | 流量是主要成本，可配 CDN 优化 |
| **阿里云 OSS** | ✅ 类似 COS | 存储 0.12 元/GB/月 + 下行 0.5 元/GB | ≈ **92 元/月**（同量级） | 同上 |
| **GitLab.com** | ✅ 10GB 存储 | 超出需升级 | **0 元** | 境外，速度 2.6MB/s |
| **Gitee** 个人版 | ❌ 单文件 50MB、总量 1GB | 标准版 ¥299/人/年（5 人起） | 年费 ¥1495 起 | 付费到 200MB 也不支持 Range |
| **Gitee** 高级版 | ⚠️ 单文件 200MB 勉强够 | ¥399/人/年 × 5 人起 | **年费 ¥1995 起** | **Range 仍缺失**,不划算 |
| **GitHub + gh-proxy.com** | ✅ 不限 | 免费（第三方公益镜像） | **0 元** | 速度 9.6MB/s，但稳定性不可控 |
| **GitHub**（现状 ghfast） | ✅ 不限 | 免费 | **0 元** | 但国内直连不可靠、镜像只 1.3MB/s |

**关键判断**：

- **零成本可行**：CNB（100GiB 免费额度）、GitLab.com、GitHub + gh-proxy.com（第三方镜像风险）
- **低成本可行**：对象存储约 90 元/月（含 1000 次下载），且带宽/容量无上限、最可控
- **Gitee 是唯一「花钱也解决不了」的**：付费只提升容量额度，不改变 Range 缺失。
- ⚠️ **CODING 已退出候选**：见第六章的产品生命周期核查。

## 六、产品生命周期核查（重要，2026-11-23 追加）

技术指标只能说明「现在能用」，还必须核对「两年后是否还在」。核查结果推翻了此前的推荐顺序。

### 6.1 腾讯 CODING — 已进入退市阶段，必须排除

官方下线公告（coding.net/help/docs/admin/pay/price-adjustment.html）明确时间线：

| 节点 | 日期 | 当前状态（2026-11-23） |
| --- | --- | --- |
| 标准版（免费版）下线 | 2025-09-01 | ❌ 已失效 |
| 所有产品停止新购 | 2025-09-30 | ❌ 已过期 |
| 所有产品停止续购 | 2026-03-30 | ❌ 已过期 |
| **所有产品停止服务** | **2028-09-30** | ⏳ 剩余 22 个月 |

官方原文：

> 由于产品业务调整，【CODING DevOps】系列产品将计划于以下时间停止相关支持：
> 标准版产品下线：2025年9月1日；原免费版客户无法使用
> 所有产品停止服务：2028年9月30日
> 产品下线后数据将会被物理清除掉，不可恢复

实测注册入口也已 404：

```
GET https://coding.net/register → 404
GET https://coding.net/signup   → 404
```

**结论：用户反馈「新用户没有免费入口、产品线在收缩」属实，且实际更严重——整条产品线在退市。
把客户端更新链路建在一个 22 个月后关停、且届时数据物理清除的平台上，是不可接受的。**
本报告此前的「综合推荐 CODING」判断作废。

### 6.2 CNB — 官方指定的继任者，处于上升期

CODING 下线公告直接指向 CNB：

> 若您仍有类似需求，可选购我们下一代产品【云原生构建】（简称 CNB），能力更强、产品更聚焦于开发者。
> 免费用户可以切换到新一代产品【云原生构建】，产品能力更强、提供更大免费额度。

CNB 时间线：

| 节点 | 日期 |
| --- | --- |
| 社区版开放公测 | 2024-11 |
| 上线官网 | 2025-02-26 |
| 公测结束、开放计费（保留免费额度） | 2025-09-01 |

→ 这是腾讯云在开发域（代码、制品、CI/CD）的**战略承接产品**，与被替换的 CODING 是
「下一代 / 上一代」关系。选它等于顺着厂商的产品路线走，而不是逆着走。

**免费额度现状**（2026-11-23 核对官方定价页 `docs.cnb.cool/zh/pricing.html`）：

| 计费项 | 免费额度 | 超额单价 |
| --- | --- | --- |
| 仓库存储（Git 对象） | **100 GiB** | ¥1/GiB/月 |
| 对象存储（**制品、LFS、图片及附件**） | **100 GiB** | ¥1/GiB/月 |
| 云原生构建-CPU | 160 核时/月 | ¥0.125/核时 |
| 云原生开发-CPU | 1600 核时/月 | ¥0.125/核时 |

**关键发现：CNB 的计费项里没有「下载流量」这一项**，只有存储与计算。
这意味着用户更新下载**不产生额外费用**、也没有月度流量天花板——
这比 CODING 免费版 20GB/月、COS 0.5 元/GB 的模式对更新分发更友好。
（注：政策可能调整，上线前建议再核对一次。）

### 6.3 其他候选的生命周期风险

| 平台 | 风险点 | 评估 |
| --- | --- | --- |
| **Gitee** | 已关停 Gitee Pages（非核心业务收缩迹象）；开源仓库需人工审核 | ⚠️ 平台存续但边缘业务在收缩 |
| **GitLab.com** | 母公司 2024 年起停止中国区 SaaS 销售（极狐独立运营）；本方案用 gitlab.com 国际站 | ⚠️ 境外，政策与可达性均有不确定性 |
| **GitCode** | 已因 401 鉴权排除 | — |
| **AtomGit** | 已因 401 鉴权排除 | — |
| **对象存储 COS/OSS** | 云厂商基础服务，存续风险最低 | ✅ 最稳 |
| **GitHub** | 全球最大，无退市风险 | ✅ 稳（问题只在网络可达性） |
| **gh-proxy.com 等公益镜像** | 第三方公益，历史多家关停 | ❌ 只能救急，不能做长期依赖 |

### 6.4 结论修正

按「技术达标 × 生命周期可控 × 成本结构」三重筛，排序变为：

1. **腾讯云 CNB** — 技术达标、官方战略产品、**计费不含下载流量**，综合最优
2. **对象存储（COS/OSS）+ 自建脚本** — 技术满分、生命周期最稳，但按流量计费（约 90 元/月）
3. **GitLab.com** — 技术达标、免费，但境外且政策不确定
4. **GitHub + gh-proxy.com** — 零改造救急，仅作过渡
5. ~~腾讯 CODING~~ — **退市，排除**（2028-09-30 停服，数据物理清除）
6. ~~Gitee~~ — Range 缺失 + 容量小 + 边缘业务收缩

## 七、选型建议

### 首选：腾讯云 CNB

在「生命周期核对」+「深度调研」之后，CNB 确认排第一，理由：

1. **技术四项达标**：匿名 200、Range 206、实测 246MB 单文件、5.0MB/s
2. **生命周期最可控**：腾讯云开发域战略产品，CODING 的官方指定继任者，2025-09 刚开放计费
3. **成本结构最适合更新分发**：计费项只有「存储 + 计算」，**不含下载流量**
   → 用户下载更新包不额外花钱，没有月度流量天花板（COS 是 0.5 元/GB、CODING 免费版是 20GB/月）
4. **免费额度充足**：对象存储 100 GiB ≈ 可存 500+ 个 183MB 版本
5. **接入后反而比现状简单**：检查阶段从 3 条请求（atom/latest/latest.yml）降到 **1 条**，
   现有镜像重写与按阶段切代理逻辑可整块删除

#### 需要配套做的三件事（详见 3.1.1）

1. **manifest 放仓库 raw**：`updates/latest.yml`，客户端 `setFeedURL` 指向
   `https://cnb.cool/<owner>/<repo>/-/git/raw/<branch>/updates`。
2. **发布脚本写绝对 URL**：清单里的 `url` 字段必须是
   `https://cnb.cool/<o>/<r>/-/releases/download/<tag>/<file>`，
   **不能沿用 electron-builder 默认的相对文件名**（实测会解析到 raw 目录导致 404）。
3. **provider 从 github 换 generic**：`setFeedURL` 传字符串即自动走 `GenericProvider`，
   无需引入新依赖。

#### 已验证通过的关键链路（不再有「应该没问题」）

| 环节 | 验证结果 |
| --- | --- |
| 清单读取 | raw 匿名 200，~200ms，连续 10 次无限流 |
| 资产下载 | 入口 200 → 302 签发 → 200 |
| Range / 差量 | 跟随 302 后 206，精确 1024B；连续三次不同区间均 206 |
| 跨域重定向保 Range | 已核对源码，`range` 不在敏感头清单 |
| 并发 | 6 路各 5.1MB/s，合计 30MB/s，不降速 |
| 发版自动化 | API 字段齐全（tag_name/body/overwrite/ttl），两步上传 |

#### 已知不足（接受即可）

- 无 `latest` 别名 → 用 raw 清单替代
- API 查版本需 token → 客户端不依赖 API
- 制品库无匿名下载 → 只用 Release 附件
- 平台较新（2024-11 公测）→ 生态仍在成熟，需关注政策变化

### 次选：对象存储 + 自建发布脚本（腾讯 COS / 阿里云 OSS）

若不想把更新链路绑在任何代码托管平台的产品策略上：

- Range 206、无单文件限制、无总量限制、可挂 CDN
- 云厂商基础服务，存续风险最低
- 成本约 90 元/月（含 1000 次下载），但**下载量越大越贵**（0.5 元/GB）
- 缺点：需要自己写发布脚本（上传 + 生成清单 + 写版本号），没有现成 Release 界面

### 过渡：GitHub + gh-proxy.com（零改造救急）

若想当天止血，见第八章。

### 明确排除

**腾讯 CODING**（退市，2028-09-30 停服，数据物理清除）、
**Gitee**（Range 缺失 + 单文件 50MB + 1GB 总量 + 付费也解决不了 + 边缘业务收缩）、
**GitCode / AtomGit**（二进制附件 401 鉴权）、
**阿里云云效**（50MB 上限 + 不支持公开仓库）、
**华为云 CodeArts**（需鉴权）、
**Codeberg**（94KB/s）、
**npm 通道 / 公共 CDN / 边缘托管**（不能托管任意文件或境外不稳）。

### 附表：GitLab.com（技术可用，未进首选）

四项达标、2.6MB/s、免费 10GB。但境外服务，且母公司中国区业务已调整，
国内稳定性与政策均未做多地区验证，仅作备选记录。

## 八、零改造救急方案（与选型可并行）

若想**先止血再慢慢选平台**，有一条几乎零成本的路：

**只把 `DEFAULT_UPDATE_MIRROR_PREFIX` 从 `ghfast.top` 换成 `gh-proxy.com`，
并把镜像重写范围从 `/releases/download/` 放宽到 `github.com` 全站。**

理由（实测支撑）：

- `gh-proxy.com` 的 `atom` / `latest` / `latest.yml` 三条全 200，能覆盖检查阶段
- Range 可用（206），差量更新不受影响
- 速度 9.6MB/s（现用 ghfast 仅 1.3MB/s）

**放宽重写范围是安全的**（已核对 electron-updater 源码）：

```
GitHubProvider.js 用到的全部 URL 均在 github.com 域下：
  getLatestVersion() → ${basePath}.atom            → github.com/<o>/<r>/releases.atom
  getLatestTagName() → ${basePath}/latest          → github.com/<o>/<r>/releases/latest
  getBaseDownloadPath() → ${basePath}/download/...  → github.com/<o>/<r>/releases/download/...
全程不访问 api.github.com（仅 GitHub Enterprise 自定义 host 才走 API）
```

因此把 `isGithubReleaseDownloadUrl` 的匹配条件从「路径含 `/releases/download/`」
改为「origin 是 github.com」，即可一次性覆盖三条请求，且不影响任何 API 调用。

代价与风险：

- 改动很小：`updateMirror.ts` 一条常量 + 一处正则判断
- 但仍是第三方公益镜像，稳定性与政策不可控（历史上多家已关停）；
  **必须保留直连兜底**，不能把镜像作为唯一候选
- 只能治标：若某天 gh-proxy.com 也停了对 atom 的转发，检查会再失败
- 长期仍建议迁移到自有可控源（对象存储 / CNB）

## 九、实施结果（2026-11-23，镜像为主 / CNB 为备）

### 9.1 已实施：gh-proxy.com 镜像方案（主）

按用户决策「以 gh-proxy.com 为主」，已完成代码实施。**镜像前缀不写死**，
可由 `setting.json` 的 `updateMirrorPrefix` 配置，运行期可切换。

改动清单：

| 文件 | 改动 |
| --- | --- |
| `specs/client-github-self-update.md` | 产品规则 10 重写：重写范围扩到 github.com 全站；镜像必须可配置；新增规则 11 记录 CNB 备选 |
| `updateMirror.ts` | 默认前缀改 `gh-proxy.com`；候选列表扩到 **4 家**（hiwiki 榜单 32 家筛出）；新增 `isGithubMirrorTarget`（全站匹配）；回退状态机加候选轮换 + `beginAttemptKeepingMirror` |
| `updateMirrorSession.ts` | 改用 `isGithubMirrorTarget`；新增 `getMirrorPrefix()` 动态读取前缀 |
| `autoUpdateService.ts` | 读 `updateMirrorPrefix` 配置；新增 `getUpdateMirrorPrefix()` 供 session 回调 |
| `packages/shared` | `AppSettings.updateMirrorPrefix` 类型 + zod 校验（必须是 http(s) origin） |
| `index.ts` | 接线 `getMirrorPrefix: getUpdateMirrorPrefix` |
| 测试 | 断言改为常量；新增用例覆盖候选轮换、下标保留/夹紧、重复设置不重置、候选列表约束、检查阶段重写 |

**配置语义**（三态，重要）：

| `updateMirrorPrefix` 值 | 行为 |
| --- | --- |
| 未设置（undefined） | 用内置候选列表（便于未来追加候选而不改代码） |
| `""`（空串） | 禁用镜像，只走直连 |
| `"https://xxx/"` | 只用这一家 |

**端到端验证**（新实现的重写行为，实机）：

```
releases.atom            原地址 200 → 重写后 200, 28846 字节（真实 XML）
releases/latest          原地址 302 → 重写后 200, 71817 字节  ← 原地址不转发内容
releases/download/...latest.yml  原地址 302 → 重写后 200, 359 字节
```

第二行是关键：原地址只回 302 不转发内容，重写后拿到完整内容。

**门禁结果**：`pnpm typecheck` 通过（0 error）、`pnpm lint` 0 error
（293 warning 均为既有 test 文件问题，与本次无关）、autoUpdate 目录 52 个测试全通过。

### 9.2 备用：CNB 通道（未实现，仅记录）

见 3.1.1 节的完整调研。接入时需要的三处定制已写进 spec 产品规则 11：
改 generic provider、清单放仓库 raw、发布脚本写绝对 URL。

触发切换的条件：镜像方案连续失效（候选全部不可用）且直连也不可用的网络环境。
届时按 3.1.1 的验证结论实施，无需重新调研。

## 十、待用户决策（剩余）

镜像方案已落地。剩下的是**长期是否迁移到自控源**：

1. **维持现状**：继续用 gh-proxy.com 镜像（0 成本，但依赖第三方公益服务）
2. **迁移 CNB**：接受「清单放 raw + 绝对 URL」的定制，换取不依赖第三方
3. **迁移对象存储**：约 90 元/月，最可控但要自建发布脚本

短期建议先观察：镜像方案的失败已有三级回退（候选 → 直连 → 手动下载）兜底，
不会像之前那样一失败就完全不可用。

