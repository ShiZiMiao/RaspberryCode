/**
 * 子会话凭据模型。
 *
 * **设计原则（用户明确要求）**：
 * 密码是主路径的必需参数。`LimitBlankPasswordUse = 0` 只是让「密码可以留空」
 * 这一特例成立，它**不是**一条独立的免密路径。
 *
 * 因此接口的形状是「始终要求一个凭据对象」，而不是
 * 「有密码走这条、没密码走那条」。空密码只是 `password` 字段为空串，
 * 后续流程完全一致——这样代码里不会出现两条需要分别维护的分支，
 * 也不会在某个分支上漏掉安全处理。
 *
 * 为什么不把密码持久化到磁盘：
 * - 用户的 Windows 登录密码一旦落盘，就成了比「能操作桌面」严重得多的风险
 * - 会话建立后不需要再认证，密码只在建会话那一次用到
 * - 因此设计成「用毕即弃」：调用方持有明文，本模块用完立即清引用
 *
 * 若将来要做「记住凭据」，正确做法是用 DPAPI（`CryptProtectData`）加密后
 * 绑定当前用户存盘，而不是明文或自研加密。那是独立的一步，不在本模块。
 */

import { probeBlankPasswordPolicy } from "./blank-password-policy.ts";

/** 建立子会话所需的凭据。 */
export interface SessionCredential {
  /** 账户名。本地账户写 `user`，域账户写 `DOMAIN\\user` 或 `user@domain`。 */
  username: string;
  /**
   * 明文密码。
   *
   * **允许为空串**，但仅在系统策略允许空密码网络登录时才有意义
   * （见 `probeBlankPasswordPolicy()`）。空串不等于「不提供密码」——
   * 调用方仍必须显式构造本对象，不能靠省略字段来表达「免密」。
   */
  password: string;
  /** 域名。本地账户可省略。 */
  domain?: string;
}

/** 凭据来源，用于诊断与日志（绝不记录密码本身）。 */
export type CredentialSource =
  /** 用户在本应用里手动输入。 */
  | "user_input"
  /** 用户输入了空密码，且系统策略允许。 */
  | "user_input_blank";

/** 凭据校验结果。 */
export interface CredentialCheck {
  ok: boolean;
  source: CredentialSource | undefined;
  /** 不通过时的原因。 */
  reason?: string;
  /**
   * 给用户的下一步提示。
   *
   * 空密码被拒时这里必须说清「要么填密码，要么改策略」——
   * 否则用户只会看到「认证失败」而去猜。
   */
  hint?: string;
}

/**
 * 校验凭据是否可用于建立子会话。
 *
 * 不实际尝试验证密码（那要发起一次登录），只做**前置一致性检查**：
 * 空密码在这个系统上到底行不行。真正的密码正确性由 RDP 握手阶段判定。
 *
 * 为什么前置检查值得做：密码错误与「系统不允许空密码」是两种完全不同的
 * 失败，用户需要不同的处置。混在一起报「登录失败」，用户会反复重输密码。
 */
export function checkCredential(credential: SessionCredential): CredentialCheck {
  if (!credential.username.trim()) {
    return {
      ok: false,
      source: undefined,
      reason: "缺少用户名",
      hint: "请填写用于建立隔离桌面的 Windows 账户名。",
    };
  }

  const isBlank = credential.password.length === 0;
  if (!isBlank) {
    return { ok: true, source: "user_input" };
  }

  // 空密码：只有系统策略允许时才可能成功
  const policy = probeBlankPasswordPolicy();
  if (policy.blankPasswordNetworkLogonAllowed) {
    return {
      ok: true,
      source: "user_input_blank",
      hint:
        "本次使用空密码。系统策略 LimitBlankPasswordUse=0 允许空密码网络登录，" +
        "因此可以跳过密码输入。",
    };
  }

  return {
    ok: false,
    source: undefined,
    reason: "系统不允许空密码账户进行网络登录（LimitBlankPasswordUse=1）",
    hint:
      "两条路任选其一：① 在该账户上设置一个密码，然后填到这里；" +
      "② 若确实要用空密码，需把安全策略「账户: 限制使用空密码的本地账户" +
      "仅进行控制台登录」设为「已禁用」（会降低本机安全性）。",
  };
}

/**
 * 判断凭据是否「瞬时」——用完就该丢弃。
 *
 * 目前恒为 true：本实现不持久化任何密码。保留这个判断是为了让
 * 「将来支持记住凭据」这件事有一个明确的接入点，而不是在调用点散落 if。
 */
export function shouldDiscardAfterUse(_credential: SessionCredential): boolean {
  return true;
}
