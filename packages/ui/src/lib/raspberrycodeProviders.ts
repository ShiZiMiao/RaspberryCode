import {
  RASPBERRYCODE_AGENT_PROVIDER,
  RASPBERRYCODE_AGENT_PROVIDER_LABEL,
  type RaspberryCodeProvider,
} from "@raspberrycode/shared";

export const RASPBERRYCODE_AGENT_PROVIDERS: RaspberryCodeProvider[] = [RASPBERRYCODE_AGENT_PROVIDER];

export const RASPBERRYCODE_AGENT_PROVIDER_LABELS: Record<RaspberryCodeProvider, string> = {
  agent: RASPBERRYCODE_AGENT_PROVIDER_LABEL,
};

export function supportsRaspberryCodeSessionFork(provider: RaspberryCodeProvider): boolean {
  void provider;
  // 功能开关：fork 入口恢复对所有 RaspberryCode provider 开放；实际可操作性仍由 task 状态、
  // assistant 目标和运行中保护 guard 控制，避免把 active/failed 分支暴露为可 fork。
  return true;
}

export function shouldHideRaspberryCodeSessionForkAction(provider: RaspberryCodeProvider): boolean {
  return !supportsRaspberryCodeSessionFork(provider);
}
