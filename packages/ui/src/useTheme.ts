import { useEffect, useState, useCallback } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
// 历史版本 localStorage 里存过 zai-* 主题旧代号，读取时映射到中性值，写入只写新值。
const LEGACY_THEME_MAP: Record<string, Theme> = {
  "zai-light": "light",
  "zai-dark": "dark",
};

const STORAGE_KEY = "raspberrycode-theme";
const BROWSER_THEME_SURFACE_ATTRIBUTE = "data-raspberrycode-browser-theme-surface";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") {
    return getSystemTheme();
  }

  return theme === "dark" ? "dark" : "light";
}

export function normalizeThemePreference(theme: Theme | string | null | undefined): Theme {
  if (theme === "dark" || theme === "light" || theme === "system") return theme;
  const legacy = theme ? LEGACY_THEME_MAP[theme] : undefined;
  // 无持久化值（首次启动）/无法识别时统一落到 system：界面主题默认跟随操作系统亮暗，
  // 不再把深色写死成产品默认值（见 docs/ui/default-theme.md）。
  return legacy ?? "system";
}

function setThemeMetaContent(name: "theme-color" | "color-scheme", content: string) {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.append(meta);
  }
  meta.content = content;
}

function syncBrowserThemeSurface(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (
    typeof root.hasAttribute !== "function" ||
    !root.hasAttribute(BROWSER_THEME_SURFACE_ATTRIBUTE)
  ) {
    return;
  }

  // Electron 为 vibrancy 保持透明根背景，但普通浏览器需要从文档根和标准 meta
  // 获得页面主题。只切换 React 的 dark class 会让浏览器工具栏、原生控件和 overscroll 留在旧主题。
  root.setAttribute(BROWSER_THEME_SURFACE_ATTRIBUTE, resolved);
  root.style.colorScheme = resolved;
  setThemeMetaContent("color-scheme", resolved);

  const background = getComputedStyle(root).getPropertyValue("--color-background").trim();
  if (background) {
    setThemeMetaContent("theme-color", background);
  }
}

export function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme);
  // appliedTheme 必须落到确定的 light/dark：normalizeThemePreference 在无值/无法识别时
  // 返回 system，若原样用于 class 判断会让 theme-light/theme-dark 同时缺失。
  const normalized = normalizeThemePreference(theme);
  const appliedTheme = normalized === "system" ? resolved : normalized;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("theme-light", appliedTheme === "light");
  document.documentElement.classList.toggle("theme-dark", appliedTheme === "dark");
  syncBrowserThemeSurface(resolved);
}

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function readStoredTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  // 迁移：旧版本存的 zai-* 值读取时归一为中性值，用户偏好不丢。
  return normalizeThemePreference(saved);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    // 默认主题统一收敛到 dark，避免旧 hook 兜底值和 Zustand store 默认值分叉。
    return readStoredTheme();
  });

  const setTheme = useCallback((t: Theme) => {
    const normalizedTheme = normalizeThemePreference(t);
    localStorage.setItem(STORAGE_KEY, normalizedTheme);
    setThemeState(normalizedTheme);
    applyTheme(normalizedTheme);
  }, []);

  // 初始化 + system 模式下监听系统偏好变化
  useEffect(() => {
    applyTheme(theme);

    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return { theme, setTheme } as const;
}
