import { getRaspberryCodeCopy, type SupportedLocale, type UiLocale } from "@raspberrycode/i18n";

export function formatCliHelp(
  version: string,
  locale?: UiLocale,
  detectedLocale?: SupportedLocale,
): string {
  return getRaspberryCodeCopy(locale, detectedLocale).cli.help(version);
}
