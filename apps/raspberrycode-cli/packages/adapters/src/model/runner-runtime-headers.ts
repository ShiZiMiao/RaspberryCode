import { RASPBERRYCODE_PROVIDER_CONFIG_NETWORK_ERROR } from "@raspberrycode/shared";

/**
 * 运行时请求头刷新失败。
 *
 * 单机版无账号态：`refreshRuntimeHeadersBeforeAttempt` 一类的「请求前刷新凭据」
 * 流程（上游 runner-runtime-headers 的 resolveModelForAttempt / waitForHeaders）
 * 已随账号体系拆除，本文件只保留 failure-classifier 依赖的错误分类语义——
 * 把「配置类网络错误」与普通失败区分开，供重试判定使用。
 */
export class RuntimeHeadersRefreshError extends Error {
  readonly retryable: boolean;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "RuntimeHeadersRefreshError";
    // 只信任 Host 的结构化分类；旧文案也可能来自无效配置，不能按文本扩大重试。
    this.retryable =
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === RASPBERRYCODE_PROVIDER_CONFIG_NETWORK_ERROR;
  }
}
