import { Worker } from "node:worker_threads";

import {
  isRaspberryCodeDataSizeScanResult,
  type RaspberryCodeDataSizeScanRequest,
  type RaspberryCodeDataSizeScanResult,
} from "./raspberrycodeDataSizeScanner.js";

export function scanRaspberryCodeDataDirectoryInWorker(
  request: RaspberryCodeDataSizeScanRequest,
  signal: AbortSignal,
): Promise<RaspberryCodeDataSizeScanResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./raspberrycodeDataSizeWorker.js", import.meta.url), {
      workerData: request,
    });
    let settled = false;

    const finish = (run: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      run();
    };
    const abort = () => {
      void worker.terminate();
      finish(() => reject(new DOMException("RaspberryCode data size scan aborted", "AbortError")));
    };

    worker.once("message", (message: unknown) => {
      const response = message as { ok?: unknown; result?: unknown; error?: unknown };
      if (response.ok === true && isRaspberryCodeDataSizeScanResult(response.result)) {
        finish(() => resolve(response.result as RaspberryCodeDataSizeScanResult));
        return;
      }
      finish(() =>
        reject(
          new Error(
            response.ok === false && typeof response.error === "string"
              ? response.error
              : "Invalid RaspberryCode data size worker response",
          ),
        ),
      );
    });
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish(() => reject(new Error(`RaspberryCode data size worker exited with code ${code}`)));
      }
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    worker.unref();
  });
}
