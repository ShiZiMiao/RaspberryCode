import { z } from "zod";

/** 各内置供应商管理面及 PAT 签发共用的成功 envelope 码；不放宽 Token 内容校验。 */
export const projectTokenSuccessCodeSchema = z.union([
  z.literal(200),
  z.literal(0),
  z.literal("200"),
  z.literal("0"),
]);
