import { buildRuntimeRaspberryCodeApiUrl } from "@raspberrycode/shared";

export const RASPBERRYCODE_CLIENT_SCENES_URL = buildRuntimeRaspberryCodeApiUrl(
  process.env,
  "/api/v1/client/scenes",
);
