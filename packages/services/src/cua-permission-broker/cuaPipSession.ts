import type { PipSessionEvent } from "@raspberrycode/raspberrycode-cua/pip-session";
import { ServiceChannels } from "@raspberrycode/shared";

import { createServiceDescriptor } from "../descriptors.js";

type FocusEvent = Extract<PipSessionEvent, { kind: "focus-changed" }>;
type LifecycleEvent = Exclude<PipSessionEvent, FocusEvent>;

export interface CuaPipSessionService {
  publishFocus(event: FocusEvent): Promise<void>;
  publishLifecycle(event: LifecycleEvent): Promise<void>;
  dispose(): void;
}

export const ICuaPipSessionService = createServiceDescriptor<CuaPipSessionService>(
  ServiceChannels.CuaPipSession,
);
