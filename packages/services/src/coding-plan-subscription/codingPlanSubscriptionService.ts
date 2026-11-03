import { applyDynamicWorkflowUserMode, type ApiClient } from "@raspberrycode/shared";
import type { ICredentialService } from "../credential/credential.js";
import type { ICodingPlanSubscriptionService } from "./codingPlanSubscription.js";
import { BigModelCodingPlanSubscriptionProvider } from "./bigmodelCodingPlanSubscriptionProvider.js";

interface CodingPlanSubscriptionServiceDependencies {
  apiClient: ApiClient;
  credentialService: Pick<ICredentialService, "load">;
  /**
   * 用户在设置里选的动态工作流模式（launch.md「The user's choice」）。只有拥有设置权威的装配
   * （desktop 本地 Host、web/standalone server）注入；缺省时快照只含服务端的「提供」。
   */
  resolveDynamicWorkflowUserMode?: () => Promise<unknown>;
}

/**
 * 订阅/购买/权益 API 已随 Coding Plan 体系移除（specs/no-login-startup.md 后续裁剪）。
 * 本服务只剩平台级灰度配置读取（client/configs 同源），统一委托 bigmodel provider。
 */
export function createCodingPlanSubscriptionService(
  dependencies: CodingPlanSubscriptionServiceDependencies,
): ICodingPlanSubscriptionService {
  const bigmodelProvider = new BigModelCodingPlanSubscriptionProvider(dependencies);

  return {
    // 动态工作流灰度：与 client/configs 同源，
    // 因此和其它平台级配置一样固定走 bigmodel provider，与 family 无关。
    // 用户选择在这里套到「提供」上，renderer 读到的就是生效值；规则只写在 shared 的
    // applyDynamicWorkflowUserMode 里，renderer 不自己算。
    getDynamicWorkflowClientConfig: async (options) => {
      const offer = await bigmodelProvider.getDynamicWorkflowClientConfig(options);
      const resolveUserMode = dependencies.resolveDynamicWorkflowUserMode;
      return resolveUserMode ? applyDynamicWorkflowUserMode(offer, await resolveUserMode()) : offer;
    },
    getModelContextBudgetStrategy: () => bigmodelProvider.getModelContextBudgetStrategy(),
    getRequestVerificationConfig: () => bigmodelProvider.getRequestVerificationConfig(),
    getForceUpdateConfig: () => bigmodelProvider.getForceUpdateConfig(),
  };
}
