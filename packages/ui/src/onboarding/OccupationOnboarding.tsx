import { useOnboardingTelemetry } from "@/onboarding/useOnboardingTelemetry.js";
import { OnboardingHeader } from "@/onboarding/OnboardingHeader.js";
import { OccupationOnboardingVisual } from "@/onboarding/OccupationOnboardingVisual.js";
import { OnboardingModeSelector } from "@/onboarding/OnboardingModeSelector.js";
import { useOnboardingTrigger } from "@/onboarding/useOnboardingTrigger.js";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSettings } from "@/hooks/useSettingService.js";
import { useOnboardingRecordService } from "@/hooks/useOnboardingRecordService.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useEffectiveShortcutBindings } from "@/shortcuts/useShortcutBindings.js";
import { matchesShortcutBinding } from "@/shortcuts/bindings.js";
import { useRaspberryCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { cn } from "@/components/lib/utils.js";
import {
  SESSION_MIGRATION_SOURCES,
  type SessionMigrationSource,
} from "@/hooks/useClaudeSessionMigration.js";
import { useRaspberryCodeStore } from "@/store/StoreProvider.js";
import type { InterfaceMode } from "@/lib/interfaceMode.js";
import { logger } from "@/logger.js";
import { DesktopWindowControls } from "@/DesktopWindowControls.js";
import type { OnboardingRecordEntry } from "@raspberrycode/shared";

/** 追加本地引导记录（userId 由 host 补全）；channel 缺失挂起时 5 秒超时按写失败处理。 */
async function appendOnboardingRecord(
  service: NonNullable<ReturnType<typeof useOnboardingRecordService>>,
  deviceMid: string,
  entry: Parameters<typeof service.appendRecord>[1],
): Promise<void> {
  await Promise.race([
    service.appendRecord(deviceMid, entry),
    new Promise((_, reject) => setTimeout(() => reject(new Error("appendRecord timeout")), 5000)),
  ]);
}

export function OccupationOnboarding({
  children,
  showWindowControls = false,
  showChildrenWhileLoading = false,
  isMacDesktop,
  isWindowsDesktop,
}: {
  children: ReactNode;
  /** Windows/Linux 自绘窗控：引导全屏覆盖主界面（含标题栏），需在此补最小化/最大化/关闭。 */
  showWindowControls?: boolean;
  /** 独立设置页不依赖引导设置加载，避免应用级引导外层遮住设置内容。 */
  showChildrenWhileLoading?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
}) {
  const { settings, update } = useSettings();
  const platform = usePlatform();
  const onboardingRecord = useOnboardingRecordService();
  const shortcutBindings = useEffectiveShortcutBindings();
  const requested = useRaspberryCodeStore((state) => state.newUserOnboardingOpen);
  const setRequested = useRaspberryCodeStore((state) => state.setNewUserOnboardingOpen);
  // 按 userId 重新判定是否触发引导；无登录启动后 userId 恒为 null（specs/no-login-startup.md）。
  const userId = useRaspberryCodeStore((state) => state.user?.id) ?? null;
  const { intl } = useRaspberryCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `occupationOnboarding.${key}` });
  const savedInterfaceMode = useRaspberryCodeStore((state) => state.interfaceMode);
  const setInterfaceMode = useRaspberryCodeStore((state) => state.setInterfaceMode);
  // mode 为 null 表示模式页被"跳过"（跳过是显式答案，记录里保留 null 而非兜底值）。
  const [mode, setMode] = useState<InterfaceMode | null>(savedInterfaceMode);
  // 引导已收敛为两步：0 = UI 模式，1 = 助手偏好。
  const [step, setStep] = useState<0 | 1>(0);
  const preferences = step === 1;
  const requestOnboardingDialog = useRaspberryCodeStore((state) => state.requestOnboardingDialog);
  // 迁移来源支持多选：用户勾选几个就只导这几个，空数组表示「不迁移」。
  const [migrationSources, setMigrationSources] = useState<SessionMigrationSource[]>([]);
  // 唯一的「是否迁移」事实源由来源集合派生，避免两个 state 互相打架。
  const migration = migrationSources.length > 0;
  const [memory, setMemory] = useState(savedInterfaceMode === "office");
  const [suggestions, setSuggestions] = useState(savedInterfaceMode === "office");
  const suggestionsEditedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const loadDeviceMid = useCallback(() => platform.getDeviceId(), [platform]);
  const [needsOnboarding, markOnboarded] = useOnboardingTrigger({
    onboardingRecord,
    userId,
    loadDeviceMid,
    update,
  });
  const onboardingVisible = requested || (needsOnboarding === true && !dismissed);
  const captureEnd = useOnboardingTelemetry({
    platform,
    visible: Boolean(settings) && onboardingVisible && (requested || needsOnboarding !== null),
    step,
    mode,
    memory,
    suggestions,
    migration,
  });
  const closeOnboarding = useCallback(() => {
    if (savingRef.current) return;
    captureEnd("close", intl.formatMessage({ id: "occupationOnboarding.close" }))();
    setStep(0);
    setDismissed(true);
    setRequested(false);
    if (onboardingRecord) {
      void onboardingRecord.dismissOnboarding(platform.getDeviceId()).catch((cause: unknown) => {
        logger.warn("[occupation-onboarding] 写入关闭决策失败", { error: String(cause) });
      });
    }
  }, [captureEnd, intl, onboardingRecord, platform, setRequested]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        shortcutBindings.toggleInterfaceMode.some((binding) =>
          matchesShortcutBinding(event, binding),
        )
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (saving) return;
        const nextMode = savedInterfaceMode === "office" ? "coding" : "office";
        setInterfaceMode(nextMode);
        setMode(nextMode);
        if (nextMode !== mode) {
          setMemory(nextMode === "office");
          if (nextMode === "office" && !suggestionsEditedRef.current) setSuggestions(true);
        }
        return;
      }
      if (event.key === "Escape" && onboardingVisible && !saving) {
        // 直接退出不改偏好；首次引导会持久化 dismissed，避免下次启动重复展示。
        event.preventDefault();
        event.stopImmediatePropagation();
        closeOnboarding();
        return;
      }
      if (
        !shortcutBindings.openOnboarding.some((binding) => matchesShortcutBinding(event, binding))
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (saving) return;
      // 关闭调试引导不保存偏好，也不把首次引导标记为已完成。
      if (onboardingVisible) {
        closeOnboarding();
      } else {
        setRequested(true);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    closeOnboarding,
    shortcutBindings,
    setRequested,
    onboardingVisible,
    saving,
    savedInterfaceMode,
    setInterfaceMode,
    mode,
  ]);
  // 引导再次打开（换账号触发 / 快捷键手动打开）时，用该用户在 record 里的最近作答预填，
  // 而不是每次都从写死的默认选项开始；跳过页记 null 的字段落默认值。
  const [latestEntry, setLatestEntry] = useState<OnboardingRecordEntry | null>(null);
  // 预填异步后到时不得覆盖用户已经做出的选择。
  const userEditedRef = useRef(false);
  useEffect(() => {
    if (!onboardingRecord) return;
    let cancelled = false;
    onboardingRecord.getLatestEntry().then(
      (entry) => {
        if (!cancelled) setLatestEntry(entry);
      },
      (cause) => {
        logger.warn("[occupation-onboarding] 读取预填作答失败", { error: String(cause) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [onboardingRecord, userId]);
  const markUserEdited = () => {
    userEditedRef.current = true;
  };

  const applyLatestEntry = () => {
    const entry = latestEntry;
    setStep(0);
    const initialMode = entry?.interfaceMode ?? savedInterfaceMode;
    setMode(initialMode);
    // 编程模式默认关闭主动工作记忆；办公模式才恢复该用户之前的勾选。
    setMemory(initialMode === "office" && (entry?.memoryEnabled ?? true));
    setSuggestions(entry?.proactiveSuggestionsEnabled ?? initialMode === "office");
    // 迁移来源不做预填：每次打开引导都要用户重新确认从哪些软件导入。
    setMigrationSources([]);
    setError(false);
  };
  useEffect(() => {
    if (!requested) return;
    userEditedRef.current = false;
    suggestionsEditedRef.current = false;
    applyLatestEntry();
    // latestEntry 异步到达时若引导已打开，重新预填一次（用户未交互前覆盖默认值）。
  }, [requested]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!onboardingVisible || userEditedRef.current) return;
    applyLatestEntry();
    // eslint-disable-line react-hooks/exhaustive-deps
  }, [latestEntry]);
  if (!settings) return showChildrenWhileLoading ? <>{children}</> : null;
  // 判定进行中先不渲染，避免引导闪现后立即消失（判定为需引导）或先闪引导再进主界面。
  // 存量用户（settings 已标记完成过引导）不等记录判定直接进主界面，杜绝黑屏；
  // 引导不再采集职业，因此改用独立的 onboardingCompleted 标记，不再借用职业字段。
  if (!requested && needsOnboarding === null && !settings.onboardingCompleted) return null;
  if (!onboardingVisible) return <>{children}</>;
  const save = async (skip = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    const reportEnd = captureEnd(skip ? "skip" : "start", t(skip ? "skip" : "start"));
    setSaving(true);
    setError(false);
    try {
      if (mode) setInterfaceMode(mode);
      logger.info("[occupation-onboarding] 保存偏好", { interfaceMode: mode });
      await update({
        // settings 侧保持既有语义：跳过落保守默认值（偏好关），
        // "跳过也算答案"的区分度只体现在 onboarding-record.json 里。
        // onboardingCompleted 是独立标记：它同时代表"老用户免等待记录判定"与
        // "已完整走过引导"，不再借用已删除的职业字段。
        onboardingCompleted: true,
        memoryEnabled: skip ? false : memory,
        proactiveSuggestionsEnabled: !skip && mode === "office" && suggestions,
      });
      reportEnd();
      // 保存成功就是本次引导的终点；本地记录失败不应留下可再次上报的引导页面。
      setStep(0);
      setDismissed(true);
      setRequested(false);
      if (!skip && migration) requestOnboardingDialog("migration", migrationSources);
      logger.info("[occupation-onboarding] 偏好保存完成", { interfaceMode: mode });
      if (onboardingRecord) {
        try {
          // 追加本地引导记录（userId 由 host 按登录态补全），后续上传服务器。
          // appendRecord 走 RPC，channel 缺失时会挂起导致保存按钮永远转圈，加超时保护。
          // 跳过是显式答案：模式页跳过记 null，偏好页整体跳过时两个布尔记 null。
          await appendOnboardingRecord(onboardingRecord, platform.getDeviceId(), {
            interfaceMode: mode,
            memoryEnabled: skip ? null : memory,
            proactiveSuggestionsEnabled: skip ? null : mode === "office" && suggestions,
            completedAt: new Date().toISOString(),
          });
          markOnboarded();
        } catch (cause) {
          // 偏好已保存成功，记录写失败只留 warn 日志，不打断用户；下次启动按记录会再次触发引导。
          logger.warn("[occupation-onboarding] 写入引导记录失败", { error: String(cause) });
        }
      }
    } catch (cause) {
      logger.warn("[occupation-onboarding] 保存偏好失败", { error: String(cause) });
      setError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <main
      aria-label={t("modeTitle")}
      data-testid="onboarding-page"
      className="relative flex h-dvh w-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-12 [app-region:drag]" />
      {/* 与 Settings 相同，计入 Workspace 的 4px 外层留白、1px 边框和 8px 内边距。 */}
      {showWindowControls ? (
        <div className="absolute right-1 top-1 z-30 mt-px mr-px flex h-12 items-center px-2">
          <DesktopWindowControls />
        </div>
      ) : null}
      <div className="relative grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-2 lg:gap-1 lg:p-1">
        <div className="flex min-h-0 flex-col pt-12 [@media(max-height:740px)]:pt-10">
          <OnboardingHeader
            step={step}
            saving={saving}
            t={t}
            onBack={() => setStep(0)}
            onClose={closeOnboarding}
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4 sm:px-10">
            {/* 自动外边距让短内容居中，长内容从顶部正常滚动，不影响固定导航。 */}
            <div className="mx-auto my-auto w-full max-w-lg shrink-0">
              <section className="flex w-full flex-col">
                <div className="w-full">
                  <h1 className="text-ui-xl font-semibold tracking-tight text-center">
                    {t(preferences ? "preferences" : "modeTitle")}
                  </h1>
                  <p className="mx-auto mt-3 max-w-md text-center text-ui-base leading-relaxed text-foreground-subtle">
                    {t(preferences ? "preferencesDescription" : "modeDescription")}
                  </p>
                  {preferences ? (
                    <div className="mt-8 space-y-3">
                      {(["suggestions", "memory"] as const)
                        .filter((key) => key !== "suggestions" || mode === "office")
                        .map((key) => (
                          <label
                            key={key}
                            className="grid cursor-pointer grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-xl border border-card-border bg-card dark:bg-surface/40 p-5 text-ui-base transition-colors hover:bg-surface-hover"
                          >
                            <Checkbox
                              checked={key === "memory" ? memory : suggestions}
                              disabled={saving}
                              onCheckedChange={(checked) => {
                                markUserEdited();
                                if (key === "memory") setMemory(checked === true);
                                else {
                                  suggestionsEditedRef.current = true;
                                  setSuggestions(checked === true);
                                }
                              }}
                            />
                            <span className="font-medium">{t(key)}</span>
                            <span className="col-start-2 text-ui-sm font-normal text-foreground-subtle">
                              {t(`${key}Description`)}
                            </span>
                          </label>
                        ))}
                      {/*
                        迁移来源为多选：勾选几个就只导这几个，全不勾即不迁移。
                      */}
                      <fieldset
                        disabled={saving}
                        className="rounded-xl border border-card-border bg-card p-5 dark:bg-surface/40"
                      >
                        <legend className="px-1 text-ui-base font-medium">{t("migration")}</legend>
                        <p className="mt-1 text-ui-sm font-normal text-foreground-subtle">
                          {t("migrationDescription")}
                        </p>
                        <div className="mt-3 grid gap-2">
                          {SESSION_MIGRATION_SOURCES.map((source) => {
                            const checked = migrationSources.includes(source);
                            return (
                              <label
                                key={source}
                                className={cn(
                                  "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-ui-base transition-colors",
                                  checked
                                    ? "border-primary bg-accent"
                                    : "border-border bg-background hover:bg-surface-hover",
                                )}
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(next) => {
                                    markUserEdited();
                                    setMigrationSources((previous) =>
                                      next === true
                                        ? [...new Set([...previous, source])]
                                        : previous.filter((item) => item !== source),
                                    );
                                  }}
                                />
                                <span className="font-medium">
                                  {t(`migrationSource_${source}`)}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    </div>
                  ) : (
                    <OnboardingModeSelector
                      mode={mode}
                      saving={saving}
                      onSelect={(value) => {
                        markUserEdited();
                        // 重选当前编程模式也应清除旧记录带来的默认勾选。
                        setMemory(value === "office");
                        if (value !== mode) {
                          if (value === "office" && !suggestionsEditedRef.current)
                            setSuggestions(true);
                        }
                        setMode(value);
                      }}
                      label={t("modeTitle")}
                      formatLabel={(key) => t(key)}
                    />
                  )}
                  {error ? (
                    <p role="alert" className="mt-4 text-ui-sm text-destructive">
                      {t("error")}
                    </p>
                  ) : null}
                </div>
                <footer className="mt-6 flex flex-col gap-3 [@media(max-height:740px)]:mt-4 [@media(max-height:740px)]:gap-1">
                  <Button
                    variant="link"
                    disabled={saving}
                    className="order-2 h-9 self-center rounded-xl px-3 text-ui-base text-foreground-subtle"
                    onClick={() => {
                      markUserEdited();
                      if (preferences) void save(true);
                      else {
                        // 跳过模式页：显式记 null，再进入偏好页。
                        setMode(null);
                        setStep(1);
                      }
                    }}
                  >
                    {t("skip")}
                  </Button>
                  <div className="flex w-full gap-3">
                    <Button
                      disabled={saving}
                      className="h-11 flex-1 rounded-xl px-5 text-ui-base"
                      onClick={() => {
                        if (!preferences) setStep(1);
                        else void save();
                      }}
                    >
                      {t(saving ? "saving" : preferences ? "start" : "continue")}
                    </Button>
                  </div>
                </footer>
              </section>
            </div>
          </div>
        </div>
        <OccupationOnboardingVisual
          isMacDesktop={isMacDesktop}
          isWindowsDesktop={isWindowsDesktop}
        />
      </div>
    </main>
  );
}
