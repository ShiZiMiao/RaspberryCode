/**
 * 下一步输入预测设置开关（spec：specs/next-input-suggestions.md）。
 * 默认开启；关闭后渲染层不再发起预测请求。
 */
import { useState } from "react";
import { TID_SETTINGS_NEXT_INPUT_PREDICTION_SWITCH } from "@raspberrycode/shared/test-ids";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useRaspberryCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";

export function NextInputPredictionSetting() {
  const { intl } = useRaspberryCodeIntl();
  const { settings, update } = useSettings();
  const [saving, setSaving] = useState(false);
  const label = intl.formatMessage({ id: "settings.nextInputPrediction" });
  const setEnabled = async (enabled: boolean) => {
    setSaving(true);
    try {
      await update({ nextInputPredictionEnabled: enabled });
    } catch (error) {
      logger.warn("[settings] 更新下一步输入预测失败", { error: String(error) });
      toast(intl.formatMessage({ id: "chat.officeSuggestions.saveError" }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsRow
      label={label}
      description={intl.formatMessage({ id: "settings.nextInputPredictionDescription" })}
      control={
        <Switch
          checked={settings?.nextInputPredictionEnabled === true}
          disabled={saving || !settings}
          data-testid={TID_SETTINGS_NEXT_INPUT_PREDICTION_SWITCH}
          onCheckedChange={(checked) => {
            void setEnabled(checked);
          }}
          aria-label={label}
        />
      }
    />
  );
}
