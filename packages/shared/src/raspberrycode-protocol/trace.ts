import { z } from "zod";

export const raspberrycodeProtocolTraceSchema = z
  .object({
    traceId: z.string().min(1).optional(),
    parentId: z.string().min(1).optional(),
    spanId: z.string().min(1).optional(),
    traceparent: z.string().min(1).optional(),
  })
  .strict();
export type RaspberryCodeProtocolTrace = z.infer<typeof raspberrycodeProtocolTraceSchema>;
