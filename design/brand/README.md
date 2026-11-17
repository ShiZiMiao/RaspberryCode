# RaspberryCode 品牌图标资产库

本目录是产品图标与品牌标识的**设计源文件归档**。它不是运行时资源：应用实际加载的
图标在 `packages/desktop/build/`（打包母版）与 `packages/ui/src/assets/`（界面内矢量）。

## 当前生效版本：粉彩（pastel）

2026-11-17 起使用粉彩透明版。设计语言与上一版完全不同：

- **粉彩配色**：粉红树莓 + 薄荷绿叶片 + 蓝紫星环，中心是深紫 `#6B4E9E` 圆角胶囊里的 `< />`
- **透明无背板**：应用图标不含深色/浅色底板，四周完全透明
- **核心内容撑满 100%**：标记裁到真实 alpha 边界后，宽度方向撑满整个正方形画布

## 目录结构

```
design/brand/
├── brand-sheet.png              # 当前版（粉彩）品牌总览 2304×1536
├── brand-sheet-pastel.png       # 同上（源目录内的副本，保留以备对照）
├── readme-icon.png              # 仓库 README 头部图标 512×512（裁边后撑满，勿直接当应用图标用）
├── icon-set/                    # 当前生效：粉彩版
│   ├── apple-touch-icon.png     # 180×180
│   ├── favicon.ico              # 内含 16/32/48/64 四档
│   ├── png/                     # 45 个分档导出的位图
│   └── svg/                     # 11 个矢量源
└── icon-set-navy-v1/            # 历史版本：深蓝底板版（2026-11-17 之前）
    ├── apple-touch-icon.png
    ├── favicon.ico
    ├── png/
    └── svg/
```

## 资产族与用途（粉彩版）

| 资产族                  | 档位                          | 形态说明                                              |
| ----------------------- | ----------------------------- | ----------------------------------------------------- |
| `app-icon-dark`         | 16/32/64/128/180/256/512/1024 | 深色圆角底板 `#17132B` + 粉彩标记。**当前未用于打包** |
| `app-icon-light`        | 同上                          | 浅色圆角底板 `#FAF7FB` + 粉彩标记。**当前未用于打包** |
| `mark-color`            | 256/512/1024                  | 粉彩标记，**无背板、全透明**。当前应用图标的来源      |
| `mark-mono-dark`        | 256/512/1024                  | 单色深紫 `#2B2145` 标记，无背板                       |
| `mark-mono-white`       | 256/512/1024                  | 单色白标记，无背板                                    |
| `icon-code`             | 16/32/64/128/180/256/512/1024 | 纯 `< />` 符号，带浅色背板，用于极简场景              |
| `badge-mark-dark`       | 600/1200/2400                 | 深底横向徽标（2:1），用于头图/横幅                    |
| `logo-horizontal-dark`  | 600/1200/2400                 | 横向组合标（标记 + 文字），深底版                     |
| `logo-horizontal-light` | 600/1200/2400                 | 横向组合标，浅底版                                    |
| `logo-primary`          | 600/1200/2400                 | 主组合标                                              |

`mark-color` 原始画布**不是正方形**（1024×902，宽高比 1.135），归档时保持原样未改。

## 与打包资源的关系

| 本目录文件                          | 项目内对应位置                                                                                                                       | 当前状态                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `svg/mark-mono-white.svg`           | `packages/ui/src/assets/brand-mark-white.svg`                                                                                        | 字节完全相同                     |
| `svg/mark-mono-dark.svg`            | `packages/ui/src/assets/brand-mark-black.svg`                                                                                        | 字节完全相同（文件名保留 black） |
| `svg/logo-horizontal-light.svg`     | `packages/ui/src/assets/brand-wordmark.svg`                                                                                          | 字节完全相同                     |
| `svg/mark-color.svg`                | `packages/ui/src/assets/app-logo.svg`<br>`packages/desktop/build/brand-mark-color.svg`                                               | 两处**字节完全相同**             |
| `png/mark-color-{256,512,1024}.png` | `packages/desktop/build/icon.png`<br>`icon_windows.png`<br>`icon_installer.png`<br>`icons/1024x1024.png`<br>`public/icon_512@2x.png` | 由它裁边后撑满正方形生成         |
| `png/mark-color-1024.png`           | `packages/desktop/build/icons/{16..512}.png`、两个 `.ico`、两个 `.icns`                                                              | 同上（缺失档位从 1024 缩放）     |
| `png/mark-mono-dark-1024.png`       | `packages/desktop/src/renderer/startup-logo.png`                                                                                     | 裁边后缩到 336×293（2x）         |

### UI 内各处品牌标记的用法（2026-11-17 晚更新）

| 位置                     | 文件                                                                                 | 形态                                                  |
| ------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 标题栏左上角（Windows）  | `packages/ui/src/assets/app-logo.svg`（= `mark-color.svg`）                          | **透明粉彩**，无背板，13px                            |
| HTML 启动壳              | `packages/desktop/src/renderer/startup-logo.png`（= `mark-mono-dark-1024.png` 裁边） | **透明深紫单色**，深色主题下 CSS `invert(1)` 自动反白 |
| 启动动画（数据库启动态） | `packages/ui/src/assets/app-logo.svg`（`bare` 分支）                                 | **透明粉彩**，无背板，56px + 脉冲动画                 |
| 引导页（onboarding）     | `packages/ui/src/assets/brand-mark-white.svg`（= `mark-mono-white.svg`）             | 白色单色 + 深色圆角底板（叠在渐变背景上，有意保留）   |
| 空状态（对话草稿）       | `brand-mark-black.svg` / `brand-mark-white.svg`                                      | 按主题二选一（`dark:hidden` / `dark:block`）          |
| About 弹窗               | `packages/desktop/build/brand-mark-color.svg`（= `mark-color.svg`）                  | **透明粉彩**，30px，无底板                            |

## 打包图标的实际形态

全部为**透明无背板、核心内容撑满**：

- `icon.png` / `icon_windows.png` / `icon_installer.png` / `public/icon_512@2x.png`
  —— 1024×1024，内容宽 1024（100%）、高 893（87.2%），上下各留约 65px 透明
- `icons/{16,24,32,48,64,128,256,512}.png` —— 同比例，
  其中 256/512 直接取设计师逐档导出，其余从 1024 缩放
- `icon.ico` / `icon_installer.ico` —— 7 档（16/24/32/48/64/128/256），每档内嵌独立 PNG
- `icon.icns` / `icon_installer.icns` —— 11 档（icp4..ic14）

**已知取舍**：透明无背板的粉彩图标在 Windows 浅色任务栏上对比度偏低，
16px 时细节偏糊（32px 以上清晰）。这是选择「无背板」形态的固有代价；
`app-icon-light` / `app-icon-dark` 带背板版本已归档但未启用，需要时可切换。

### macOS DMG 安装背景 `build/dmg_background{,@2x}.png`

画布 540×380 / 1080×760，浅灰底 `#F4F5F7`，四周是浅灰线稿装饰图标，
中央是粉彩标记 + `RaspberryCode` 文字（Segoe UI Bold，深紫 `#2B2145`），
下方箭头指向右侧 Applications 目录（对应 dmg 配置里 `{x:410,y:220}` 的 link 位置）。

**这处曾长期遗漏**：原图中央印的是上游品牌 `ZCODE` 大字（2026-10-26 首次品牌替换时漏改），
因为只发 Windows 包所以一直没暴露。**中立性审计扫不到它** —— 审计只按文本读字节，
PNG 里画出来的字不在其覆盖范围。换品牌时务必单独核对这张图。

## 更换图标的操作步骤

1. 替换 `packages/desktop/build/` 的打包母版（`icon.png`、`icon_windows.png`、
   `icon_installer.png`、`icon.ico`、`icon.icns`、`icon_installer.ico/.icns`、
   `icons/{16..1024}.png`）。
2. 同步 `public/icon_512@2x.png`（更新弹窗的 macOS Dock 图标，
   `packages/ui/src/components/client-update/UpdateStatusDialog.tsx` 直接引用）。
3. 若图形本身变了，同步 UI 内三处标记：`packages/ui/src/assets/` 的四个 SVG、
   标题栏用的 `app-logo.svg`，以及启动页的 `packages/desktop/src/renderer/startup-logo.png`
   （从 `mark-mono-dark-1024.png` 裁边后缩到 336×293）。
4. 必须重打完整安装包验证；只编译不重打包看不到图标变化。

### 生成细节（下次改图标可直接复用）

- 设计源缺 24/48 档，用 `npx @resvg/resvg-js-cli --fit-width N <svg> out.png` 渲染补齐
- **ICO/ICNS 是手写容器**：ICO 每档内嵌独立 PNG；ICNS 为 `icns` + 大端长度 + 11 个 chunk。
  不要用 Pillow 的默认 ICO 保存，它会从首图重采样，导致小尺寸模糊
- 裁边用 alpha `getbbox()`，再按宽度等比缩放到目标尺寸，居中放进正方形画布

## 溯源

- 粉彩版交付：`RaspberryCode-icon-set-pastel-new/`（2026-11-17 14:39）
- 深蓝版交付：`RaspberryCode_Source/`（2026-10-26），已归档为 `icon-set-navy-v1/`，
  其中的 `png/brand-sheet.png` 与根 `brand-sheet.png` 重复，未重复保留
- `RaspberryCode-logo_assets/`（仓库根，未入库）是更早一轮图像生成的中间产物，
  与本目录无对应关系，不要当作源文件
