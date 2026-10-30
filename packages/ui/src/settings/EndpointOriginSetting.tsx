import { useEffect, useState } from "react";
import { normalizeZCodeEndpointOrigin, DEFAULT_ZCODE_ENDPOINT_ORIGIN } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { toast } from "@/components/ui/toast.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";

/**
 * 服务端点设置行（C2：端点设置从隐藏弹窗/菜单扶正到设置页）。
 * - 展示当前生效的端点来源（override 缺省时为默认域）；
 * - 保存时按 normalizeZCodeEndpointOrigin 归一成 origin；清空输入即恢复默认（空串经
 *   normalizeSettingsPatch 归一成删除 override）。
 */
export function EndpointOriginSetting() {
  const { intl } = useZCodeIntl();
  const { settings, update } = useSettings();
  const effectiveOrigin = settings?.zcodeEndpointOrigin || DEFAULT_ZCODE_ENDPOINT_ORIGIN;
  const [draft, setDraft] = useState(effectiveOrigin);
  const [saving, setSaving] = useState(false);

  // 外部变更（导入/重置）后同步输入框，不覆盖用户正在编辑的未保存内容。
  useEffect(() => {
    setDraft((prev) => (prev === effectiveOrigin ? prev : effectiveOrigin));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在生效端点变化时回填
  }, [effectiveOrigin]);

  const label = intl.formatMessage({ id: "settings.endpointOrigin" });

  const handleSave = async () => {
    const trimmed = draft.trim();
    try {
      const normalized = trimmed ? normalizeZCodeEndpointOrigin(trimmed) : undefined;
      if ((normalized ?? "") === (settings?.zcodeEndpointOrigin ?? "")) return;
      setSaving(true);
      await update({ zcodeEndpointOrigin: normalized ?? "" });
      setDraft(normalized ?? DEFAULT_ZCODE_ENDPOINT_ORIGIN);
    } catch (error) {
      logger.warn("[settings] 保存服务端点失败", { error: String(error) });
      toast(intl.formatMessage({ id: "settings.endpointOrigin.invalid" }));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!settings?.zcodeEndpointOrigin) return;
    try {
      setSaving(true);
      await update({ zcodeEndpointOrigin: "" });
      setDraft(DEFAULT_ZCODE_ENDPOINT_ORIGIN);
    } catch (error) {
      logger.warn("[settings] 恢复默认服务端点失败", { error: String(error) });
      toast(intl.formatMessage({ id: "settings.endpointOrigin.saveError" }));
    } finally {
      setSaving(false);
    }
  };

  // 不包外层元素：SettingsRow 靠 first:border-t-0 画行间分隔线，包一层会让它成为首行而丢掉上边框。
  return (
    <SettingsRow
      label={label}
      description={intl.formatMessage({ id: "settings.endpointOriginDescription" })}
      controlLayout="wide"
      control={
        <div className="flex w-full max-w-[420px] items-center gap-2">
          <Input
            aria-label={label}
            value={draft}
            placeholder="https://your-server.example"
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void handleSave()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSave();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => void handleReset()}
          >
            {intl.formatMessage({ id: "settings.endpointOrigin.reset" })}
          </Button>
        </div>
      }
    />
  );
}
