# 默认主题

## 当前策略

- 应用首次启动且本地没有 `raspberrycode-theme` 持久化值时，默认主题为 `system`，即跟随操作系统的亮/暗外观。
- 一旦用户主动切换主题，后续仍然优先读取本地保存值，不会被默认值覆盖。
- 运行期 `system` 模式需要持续订阅系统亮暗变化：用户之后切换系统主题时，界面必须同步更新。
- 首帧不接受深色写死：渲染入口与资源管理器独立窗口在解析首帧主题时同样按 `system` 处理，避免浅色系统上出现黑色闪屏。
- 原生窗口侧（Windows 标题栏按钮色、资源管理器窗口底色）同样按系统亮暗取值。

## 实现位置

- 主题偏好归一（无值 → `system`）：`packages/ui/src/useTheme.ts` 的 `normalizeThemePreference`
- Zustand store 默认值：`packages/ui/src/store/index.ts`
- 首帧初始化：`packages/desktop/src/renderer/src/main.tsx`
- 资源管理器窗口首帧：`packages/desktop/src/renderer/src/resource-manager.tsx`
- 原生窗口亮暗：`packages/desktop/src/main/desktopWindowChrome.ts`、`packages/desktop/src/main/resourceManagerWindow.ts`
