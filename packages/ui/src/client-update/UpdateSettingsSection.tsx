import { useEffect, useRef, useState } from "react";
import { DesktopCommandIds, DEFAULT_UPDATE_FEED_GITHUB } from "@raspberrycode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useRaspberryCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";

const GITHUB_SLUG_PATTERN = /^[A-Za-z0-9._-]*$/;

/**
 * 客户端更新设置区块（spec：specs/client-github-self-update.md）。
 * - 检查更新：走 DesktopCommandIds.CheckForUpdates，结果 toast 由 useAppChromeState 统一展示；
 * - 自动下载并安装更新 / 跳过版本 / GitHub 更新源：写入 setting.json（唯一持久化所有者），
 *   并经平台桥同步 main 侧更新器即时偏好（autoInstallOnAppQuit）。
 */
export function UpdateSettingsSection({ isDesktop }: { isDesktop?: boolean }) {
  const { intl } = useRaspberryCodeIntl();
  const platform = usePlatform();
  const { settings, update } = useSettings();
  const [ownerDraft, setOwnerDraft] = useState("");
  const [repoDraft, setRepoDraft] = useState("");
  const [saving, setSaving] = useState(false);
  // 只在生效值真正变化时回填输入框，避免用户逐字编辑被重置；
  // 用 ref 追踪上次回填值，替代对 lint 的依赖抑制。
  const lastAppliedOwnerRef = useRef("");
  const lastAppliedRepoRef = useRef("");

  const effectiveOwner = settings?.updateFeedGithubOwner?.trim() || DEFAULT_UPDATE_FEED_GITHUB.owner;
  const effectiveRepo = settings?.updateFeedGithubRepo?.trim() || DEFAULT_UPDATE_FEED_GITHUB.repo;
  const autoDownloadAndInstallUpdates = settings?.autoDownloadAndInstallUpdates === true;
  const skippedUpdateVersion = settings?.skippedElectronUpdateVersions?.stable?.trim() || null;

  // 外部变更（导入/重置）后同步输入框，不覆盖用户正在编辑的未保存内容。
  useEffect(() => {
    if (lastAppliedOwnerRef.current !== effectiveOwner) {
      lastAppliedOwnerRef.current = effectiveOwner;
      setOwnerDraft(effectiveOwner);
    }
    if (lastAppliedRepoRef.current !== effectiveRepo) {
      lastAppliedRepoRef.current = effectiveRepo;
      setRepoDraft(effectiveRepo);
    }
  }, [effectiveOwner, effectiveRepo]);

  if (!isDesktop) {
    return null;
  }

  const handleCheckForUpdates = () => {
    void platform.executeDesktopCommand(DesktopCommandIds.CheckForUpdates);
  };

  const handleAutoDownloadChange = (enabled: boolean) => {
    void (async () => {
      try {
        await update({ autoDownloadAndInstallUpdates: enabled });
        // main 侧更新器的 autoInstallOnAppQuit 需即时跟随；幂等写入同一字段。
        await platform.setAutoDownloadAndInstallUpdates?.(enabled);
      } catch (error) {
        logger.warn("[settings] 更新自动下载偏好失败", { error: String(error) });
        toast(intl.formatMessage({ id: "settings.update.saveError" }));
      }
    })();
  };

  const handleClearSkippedVersion = () => {
    void (async () => {
      try {
        setSaving(true);
        await update({ skippedElectronUpdateVersions: {} });
      } catch (error) {
        logger.warn("[settings] 清除跳过版本失败", { error: String(error) });
        toast(intl.formatMessage({ id: "settings.update.saveError" }));
      } finally {
        setSaving(false);
      }
    })();
  };

  const handleSaveFeed = async () => {
    const owner = ownerDraft.trim();
    const repo = repoDraft.trim();
    if (!GITHUB_SLUG_PATTERN.test(owner) || !GITHUB_SLUG_PATTERN.test(repo)) {
      toast(intl.formatMessage({ id: "settings.update.feedInvalid" }));
      return;
    }
    try {
      setSaving(true);
      await update({ updateFeedGithubOwner: owner, updateFeedGithubRepo: repo });
    } catch (error) {
      logger.warn("[settings] 保存 GitHub 更新源失败", { error: String(error) });
      toast(intl.formatMessage({ id: "settings.update.saveError" }));
    } finally {
      setSaving(false);
    }
  };

  const handleResetFeed = async () => {
    try {
      setSaving(true);
      await update({ updateFeedGithubOwner: "", updateFeedGithubRepo: "" });
      setOwnerDraft(DEFAULT_UPDATE_FEED_GITHUB.owner);
      setRepoDraft(DEFAULT_UPDATE_FEED_GITHUB.repo);
    } catch (error) {
      logger.warn("[settings] 恢复默认更新源失败", { error: String(error) });
      toast(intl.formatMessage({ id: "settings.update.saveError" }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.update.autoUpdate" })}
        description={intl.formatMessage({ id: "settings.update.autoUpdateDescription" })}
        control={
          <Switch
            aria-label={intl.formatMessage({ id: "settings.update.autoUpdate" })}
            checked={autoDownloadAndInstallUpdates}
            onCheckedChange={(checked) => {
              handleAutoDownloadChange(checked === true);
            }}
          />
        }
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.update.checkForUpdates" })}
        description={intl.formatMessage({ id: "settings.update.checkForUpdatesDescription" })}
        control={
          <Button type="button" variant="outline" size="sm" onClick={handleCheckForUpdates}>
            {intl.formatMessage({ id: "settings.update.checkForUpdates" })}
          </Button>
        }
      />
      {skippedUpdateVersion ? (
        <SettingsRow
          label={intl.formatMessage({ id: "settings.update.skippedVersion" })}
          description={intl.formatMessage(
            { id: "settings.update.skippedVersionDescription" },
            { version: skippedUpdateVersion },
          )}
          control={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={handleClearSkippedVersion}
            >
              {intl.formatMessage({ id: "settings.update.restoreVersion" })}
            </Button>
          }
        />
      ) : null}
      <SettingsRow
        label={intl.formatMessage({ id: "settings.update.githubFeed" })}
        description={intl.formatMessage(
          { id: "settings.update.githubFeedDescription" },
          { owner: DEFAULT_UPDATE_FEED_GITHUB.owner, repo: DEFAULT_UPDATE_FEED_GITHUB.repo },
        )}
        controlLayout="wide"
        control={
          <div className="flex w-full max-w-[420px] items-center gap-2">
            <Input
              aria-label="GitHub owner"
              value={ownerDraft}
              placeholder={DEFAULT_UPDATE_FEED_GITHUB.owner}
              spellCheck={false}
              onChange={(event) => setOwnerDraft(event.target.value)}
              onBlur={() => void handleSaveFeed()}
            />
            <span aria-hidden="true">/</span>
            <Input
              aria-label="GitHub repo"
              value={repoDraft}
              placeholder={DEFAULT_UPDATE_FEED_GITHUB.repo}
              spellCheck={false}
              onChange={(event) => setRepoDraft(event.target.value)}
              onBlur={() => void handleSaveFeed()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSaveFeed();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => void handleResetFeed()}
            >
              {intl.formatMessage({ id: "settings.update.feedReset" })}
            </Button>
          </div>
        }
      />
    </>
  );
}
