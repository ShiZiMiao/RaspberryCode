import type { UiLocale, SupportedLocale } from "@raspberrycode/contracts";
import { enUS } from "./locales/en-US.js";
import { zhCN } from "./locales/zh-CN.js";
import {
  DEFAULT_LOCALE,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
} from "./locale.js";
import type { RaspberryCodeCopy } from "./types.js";

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
};
export type { LocaleDetectionInput } from "./locale.js";
export type { CliCopy, TuiCopy, UiLocale, SupportedLocale, RaspberryCodeCopy } from "./types.js";

const CATALOGS: Record<SupportedLocale, RaspberryCodeCopy> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

export function getRaspberryCodeCopy(locale?: UiLocale | string, detected?: string | null): RaspberryCodeCopy {
  return CATALOGS[resolveLocale(locale, detected)];
}
