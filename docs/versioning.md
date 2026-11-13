# 版本号与发版约定

本文件是 RaspberryCode 版本号分配的**唯一事实来源**。发版、改版本号前先读这里。

## 版本号语义

版本形如 `MAJOR.MINOR.PATCH`（`x.y.z`），当前 `0.1.0`。**本项目的三段位含义与 semver 常规不同**，
按「变更来源」而非「API 破坏性」划分：

| 位 | 触发条件 | 例子 |
| --- | --- | --- |
| **MAJOR** `x.0.0` | **仅当用户明确要求**。不得自行判断或提议 | `1.0.0` |
| **MINOR** `0.x.0` | **同步上游 ZCode 更新**（merge upstream） | `0.1.0` → `0.2.0` |
| **PATCH** `0.0.x` | **自有小更新**（功能、修复、优化、品牌调整） | `0.1.0` → `0.1.1` |

### 细则

1. **默认每次发版自增 PATCH 位 1**。即没有特别说明时，发版就是 `0.0.x + 1`。
2. **同步上游归零 PATCH**：同步上游时 MINOR +1、PATCH 归 0。
   例：`0.3.7` 同步上游 v3.18 → `0.4.0`（不是 `0.4.7`）。
3. **MAJOR 必须由用户明确说明**才会变动。任何情况下不得自动升 MAJOR，
   也不要在对话里「建议」升 MAJOR 后直接执行。
4. 一次发版只升一位，不跳号（除同步上游的 PATCH 归零）。

## 版本号写在哪

发版版本由 **`packages/desktop/package.json` 的 `version`** 决定（electron-builder 据此生成
安装包名与 `latest.yml`）。同步修改：

- `packages/desktop/package.json` → `version`（**权威来源**）
- 根 `package.json` → `version`（保持一致）
- Git tag：`v<version>`（与 `version` 严格一致，自更新据此比对）

**不要改** `apps/raspberrycode-cli/package.json` 的版本（`private: true`，跟随上游 ZCode 版本线，
与产品发版无关）。

## 发版铁律：未全面测试禁止发版

**用户 2026-11-13 明确要求。** 这不是建议，是准入门槛。

发版前必须过 `node scripts/release-gate.mjs`（`pnpm release` 已内置该前置步骤，
`release:raw` 才是裸 release-it）。该脚本自动判定版本一致性、产物内容、三份资产；
**但它无法替代真实安装与功能点验**，脚本末尾会打印人工确认清单，逐项做完才算通过。

历史教训（两次都是用户先发现）：
- `0.2.0` / `0.2.1`：更新下载功能实际不可用（镜像重定向装错 session）。
- `0.1.0` / `0.2.0`：装完没有开始菜单与桌面快捷方式。

## 发版检查清单

1. 确认变更类别 → 决定升哪一位（见上表）。
2. 改 `packages/desktop/package.json` 与根 `package.json` 的 `version`。
3. **重新生成构建元数据**：`pnpm --dir packages/desktop run prepare:build-meta`。
   跳过这步会打出旧版本号的包 —— `extraMetadata.version` 读的是
   `out/metadata/build-meta.json` 缓存，不是 package.json。
4. **完整构建**：`pnpm --dir packages/desktop run build`（= 运行时资产 +
   build-meta + `run-production-build.mjs` 真正编译）。
   **只跑 electron-builder 不会编译 TS**，会拿旧 `out/` 打包。
5. 跑门禁：`typecheck` / `lint` / `audit-neutrality`。
6. 构建安装包（见项目记忆的打包定式）。
7. **真实安装与升级实测**（不可跳过）：
   - 卸载旧版 → 装新版 → 版本号正确
   - 开始菜单 + 桌面快捷方式存在且能启动
   - 旧版 → 检查更新 → 下载 → 安装 → 重启 → 版本号变新
8. **主要功能以用户视角逐项点过**：新建对话收发消息、文件编辑、终端、
   设置页、MCP/技能/插件、自动化。UI 改动必须看真实截图。
9. 打 tag `v<version>` 并推送；创建 GitHub Release，**必须上传三个资产**：
   - `RaspberryCode-<version>-win-x64.exe`
   - `RaspberryCode-<version>-win-x64.exe.blockmap`（差量更新用）
   - `latest.yml`（自更新清单）
7. 发布后自查：`latest.yml` 里的 `version` 与 tag 一致、`sha512` 与实际文件匹配。

> 自更新链路依赖以上三个资产齐全。缺 `.blockmap` 会退化为整包下载（功能不受影响）；
> 缺 `latest.yml` 则**完全无法检查更新**。

## 变更记录

| 日期 | 版本 | 类型 | 说明 |
| --- | --- | --- | --- |
| 2026-11-09 | `0.1.0` | 首个版本 | 公开发布 |
| 2026-11-12 | `0.2.0` | MINOR（同步上游） | 同步 ZCode v3.17.2；另含自更新下载镜像三级回退、E2E 锁清理修复、dev 端口改 6174、版本约定确立 |
| 2026-11-13 | `0.2.1` | PATCH（自有修复） | 修复自更新下载链路：镜像重定向改到 updater 自己的 partition session、按阶段切换代理（镜像直连／直连走系统代理）、检查阶段失败也可降级且降级路线不再被重复错误重置；补齐 Electron 44 剪贴板 API |
| 2026-11-13 | `0.2.2` | PATCH（自有修复） | 修复 Windows 安装后不创建快捷方式：安装段强制重置 keepShortcuts，避免重装/升级时开始菜单与桌面快捷方式被清空 |
