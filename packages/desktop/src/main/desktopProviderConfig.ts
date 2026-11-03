import { app } from "electron";
import { join } from "node:path";
import { RASPBERRYCODE_ENV } from "@raspberrycode/shared";

export function resolveRaspberryCodeBuiltinProviderConfigFilePath(options?: {
  readonly appPath?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly isPackaged?: boolean;
  readonly resourcesPath?: string;
}): string {
  const explicitPath = (options?.env ?? process.env)["RASPBERRYCODE_BUILTIN_PROVIDER_CONFIG_FILE"]?.trim();
  if (explicitPath) return explicitPath;
  if (options?.isPackaged ?? app.isPackaged) {
    return join(
      options?.resourcesPath ?? process.resourcesPath,
      "config/provider/raspberrycode-builtin.json",
    );
  }
  // 开发态没有 resources 复制步骤，必须与构建注入的产品环境读取同一份源文件。
  const filename = RASPBERRYCODE_ENV === "production" ? "raspberrycode-builtin.json" : "raspberrycode-builtin.test.json";
  return join(options?.appPath ?? app.getAppPath(), "../../config/provider", filename);
}
