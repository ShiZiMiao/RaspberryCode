import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RaspberryCodeStdioTapDevState } from "@raspberrycode/shared";
import { getAppConfigDir } from "#src/paths.js";
import { isEffectiveDevelopmentNodeEnv } from "#src/runtime-tools/nodeEnv.js";

interface RaspberryCodeStdioTapStateFile {
  enabled?: boolean;
}

export function isRaspberryCodeStdioTapDevVisible(): boolean {
  return isEffectiveDevelopmentNodeEnv();
}

export function getRaspberryCodeStdioTapDevDir(): string {
  return join(getAppConfigDir(), "dev");
}

export function getRaspberryCodeStdioTapDevLogDir(): string {
  return join(getRaspberryCodeStdioTapDevDir(), "stdio-traffic");
}

export function getRaspberryCodeStdioTapDevStatePath(): string {
  return join(getRaspberryCodeStdioTapDevDir(), "raspberrycode-stdio-tap.json");
}

function readStateFile(path: string): RaspberryCodeStdioTapStateFile {
  if (!existsSync(path)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as RaspberryCodeStdioTapStateFile) : {};
  } catch {
    return {};
  }
}

export function readRaspberryCodeStdioTapDevState(): RaspberryCodeStdioTapDevState {
  const visible = isRaspberryCodeStdioTapDevVisible();
  const statePath = getRaspberryCodeStdioTapDevStatePath();
  const fileState = readStateFile(statePath);
  return {
    enabled: visible && fileState.enabled === true,
    visible,
    logDir: getRaspberryCodeStdioTapDevLogDir(),
    statePath,
  };
}

export function setRaspberryCodeStdioTapDevEnabled(enabled: boolean): RaspberryCodeStdioTapDevState {
  const visible = isRaspberryCodeStdioTapDevVisible();
  const statePath = getRaspberryCodeStdioTapDevStatePath();
  mkdirSync(getRaspberryCodeStdioTapDevDir(), { recursive: true });
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        // 开发态 stdio 抓包是高频原始协议帧，只能通过显式开关写旁路文件，避免误进生产日志。
        enabled: visible && enabled,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return readRaspberryCodeStdioTapDevState();
}
