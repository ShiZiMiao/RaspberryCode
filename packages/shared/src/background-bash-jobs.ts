import {
  collectVisibleRaspberryCodeBackgroundTaskControlItems,
  getRaspberryCodeBackgroundTaskControlItemElapsedMs,
  isActiveRaspberryCodeBackgroundTaskControlItem,
  parseRaspberryCodeBackgroundTaskControlItems,
  type RaspberryCodeBackgroundTaskControlItem,
  type RaspberryCodeBackgroundTaskControlStatus,
} from "./background-task-controls.js";

export type RaspberryCodeBackgroundBashJobStatus = RaspberryCodeBackgroundTaskControlStatus;
export type RaspberryCodeBackgroundBashJob = RaspberryCodeBackgroundTaskControlItem & {
  taskKind: "bash";
};

export function parseRaspberryCodeBackgroundBashJobs(value: unknown): RaspberryCodeBackgroundBashJob[] {
  return parseRaspberryCodeBackgroundTaskControlItems(value).filter(isBackgroundBashJob);
}

export function isActiveRaspberryCodeBackgroundBashJob(job: RaspberryCodeBackgroundBashJob): boolean {
  return isActiveRaspberryCodeBackgroundTaskControlItem(job);
}

export function getRaspberryCodeBackgroundBashJobElapsedMs(
  job: RaspberryCodeBackgroundBashJob,
  now = Date.now(),
): number {
  return getRaspberryCodeBackgroundTaskControlItemElapsedMs(job, now);
}

export function collectVisibleRaspberryCodeBackgroundBashJobs(
  jobs: readonly RaspberryCodeBackgroundBashJob[],
  now = Date.now(),
  thresholdMs = 30_000,
): Array<RaspberryCodeBackgroundBashJob & { elapsedMs: number }> {
  return collectVisibleRaspberryCodeBackgroundTaskControlItems(jobs, now, thresholdMs) as Array<
    RaspberryCodeBackgroundBashJob & { elapsedMs: number }
  >;
}

function isBackgroundBashJob(job: RaspberryCodeBackgroundTaskControlItem): job is RaspberryCodeBackgroundBashJob {
  return job.taskKind === "bash";
}
