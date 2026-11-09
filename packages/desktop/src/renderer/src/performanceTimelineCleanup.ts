const PERFORMANCE_TIMELINE_CLEANUP_INTERVAL_MS = 10_000;

// 修复：DOM 与 @types/node 的全局 setInterval 在同一工程内重载交叠，
// `ReturnType<typeof window.setInterval>` 会取到 Node 的 Timeout 而调用按 DOM 重载返回 number，
// 跨类型赋值触发 TS2322。改存取消闭包，句柄类型由调用点自行推断，不做跨类型赋值。
let cleanupTimer: (() => void) | undefined;

export function startPerformanceTimelineCleanup(): void {
  if (!import.meta.env.DEV || cleanupTimer != null) {
    return;
  }

  // React 19.2 的 development build 会把组件渲染写入 Performance timeline。
  // 这些 PerformanceMeasure 由 window.performance 原生列表强引用，长时间开发会堆到 GB 级；
  // 这里定时清理只影响 DevTools 性能轨迹，不影响业务逻辑和生产包。
  const timerHandle = window.setInterval(() => {
    window.performance.clearMeasures();
    window.performance.clearMarks();
  }, PERFORMANCE_TIMELINE_CLEANUP_INTERVAL_MS);
  cleanupTimer = () => window.clearInterval(timerHandle);
}
