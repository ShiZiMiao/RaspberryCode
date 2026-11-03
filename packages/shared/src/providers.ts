import { z } from "zod";

/**
 * RaspberryCode agent 提供方的单一真源。
 *
 * 类型 RaspberryCodeProvider、运行时 schema raspberrycodeProviderSchema 都从这里派生,
 * 避免各处内联 z.enum([...]) 副本随新增/删除 provider 漂移。
 * 本模块只依赖 zod(叶子),可被 validation / raspberrycode-protocol 等无环引用。
 */
export const RASPBERRYCODE_PROVIDERS = ["agent"] as const;

export const raspberrycodeProviderSchema = z.enum(RASPBERRYCODE_PROVIDERS);

export type RaspberryCodeProvider = (typeof RASPBERRYCODE_PROVIDERS)[number];
