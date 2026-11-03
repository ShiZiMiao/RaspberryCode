import type { RaspberryCodeBackgroundTaskControlItem } from "./background-task-controls.js";

export function mergeRaspberryCodeBackgroundTaskControlItems(
  current: readonly RaspberryCodeBackgroundTaskControlItem[],
  updates: readonly RaspberryCodeBackgroundTaskControlItem[],
): RaspberryCodeBackgroundTaskControlItem[] {
  const jobsById = new Map(current.map((job) => [job.jobId, job] as const));
  for (const job of updates) {
    jobsById.set(job.jobId, job);
  }
  return Array.from(jobsById.values());
}
