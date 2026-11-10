import { z } from "zod";

/**
 * Onboarding 完成记录（两步向导：UI 模式 / 偏好）。
 *
 * 设计约束：
 * - 独立本地 JSON（~/.raspberrycode/v2/onboarding-record.json），不混入 AppSettings；
 * - 以 deviceMid 为设备锚点，entries 支持多个 userId（多人登录）与 null（apikey/未登录）；
 * - uploadState 预留后续上传服务器：pending → uploaded；
 * - 跳过是显式答案：某页被跳过时该字段记 null，与"明确选择了值"区分。
 */

export const onboardingInterfaceModeSchema = z.enum(["coding", "office"]).nullable();

// 引导已不再采集职业：旧记录里的 occupation 由 zod 默认剥离未知字段的行为丢弃，
// 无需额外读兼容 schema，也不会让旧文件校验失败。
export const onboardingRecordEntrySchema = z.object({
  userId: z.string().min(1).nullable(),
  interfaceMode: onboardingInterfaceModeSchema,
  memoryEnabled: z.boolean().nullable(),
  proactiveSuggestionsEnabled: z.boolean().nullable(),
  completedAt: z.string().min(1),
  uploadState: z.literal("pending"),
});

export const onboardingDecisionSchema = z.object({
  userId: z.string().min(1).nullable(),
  status: z.enum(["dismissed", "existing_local_user"]),
  reason: z.enum(["user_closed", "existing_local_task"]),
  decidedAt: z.string().min(1),
});

const onboardingRecordFileV1Schema = z.object({
  version: z.literal(1),
  deviceMid: z.string().min(1),
  entries: z.array(onboardingRecordEntrySchema),
});

const onboardingRecordFileV2Schema = z.object({
  version: z.literal(2),
  deviceMid: z.string().min(1),
  entries: z.array(onboardingRecordEntrySchema),
  decisions: z.array(onboardingDecisionSchema),
});

/** v1 无需启动迁移；读取时补空 decisions，后续业务写入时自然落为 v2。 */
export const onboardingRecordFileSchema = z
  .union([onboardingRecordFileV1Schema, onboardingRecordFileV2Schema])
  .transform((file) =>
    file.version === 1 ? { ...file, version: 2 as const, decisions: [] } : file,
  );

export type OnboardingRecordEntry = z.infer<typeof onboardingRecordEntrySchema>;
export type OnboardingDecision = z.infer<typeof onboardingDecisionSchema>;

/** appendRecord 的入参：userId 由服务端（host）补全，调用方不传。 */
export type OnboardingRecordEntryInput = Omit<OnboardingRecordEntry, "userId" | "uploadState">;

export type OnboardingRecordFile = z.infer<typeof onboardingRecordFileSchema>;
