/**
 * 空密码网络登录策略探测。
 *
 * 对应安全策略「账户: 限制使用空密码的本地账户仅进行控制台登录」，
 * 注册表项为 `HKLM\SYSTEM\CurrentControlSet\Control\Lsa\LimitBlankPasswordUse`：
 *
 * - `1`（默认）= 空密码账户**只能**控制台登录，RDP 等网络登录被拒
 * - `0` = 允许空密码网络登录
 *
 * 这个探测只用于**给用户提示与选择**，不作为「免密登录」的开关。
 * 按产品约定，密码始终是主路径，空密码只是它在特定策略下的特例。
 *
 * 为什么要真的读注册表而不是猜：这条策略在家庭版与专业版默认值不同，
 * 且用户可能改过。猜错会让「空密码能不能用」这个问题给出错误答案，
 * 而用户会按这个答案去决定要不要输密码。
 */

import koffi from "koffi";

/** 空密码策略状态。 */
export interface BlankPasswordPolicy {
  /**
   * 是否允许空密码走网络登录。
   *
   * `true` 表示用户可以为空密码，本应用可以跳过密码输入这一步。
   */
  blankPasswordNetworkLogonAllowed: boolean;
  /** 注册表里的原始值：1 = 限制，0 = 允许。读取失败时为 undefined。 */
  registryValue: number | undefined;
  /** 结论对应的说明。 */
  detail: string;
}

const LSA_KEY =
  "SYSTEM\\CurrentControlSet\\Control\\Lsa";

const LIMIT_BLANK_PASSWORD_USE = "LimitBlankPasswordUse";

let cached: BlankPasswordPolicy | undefined;

/**
 * 读取空密码策略。
 *
 * 结果缓存：这条策略在一次进程生命周期内不会变（改了要重启或重新登录），
 * 而它会被 `checkCredential` 频繁调用。
 */
export function probeBlankPasswordPolicy(): BlankPasswordPolicy {
  if (cached) return cached;
  cached = read();
  return cached;
}

/** 清缓存。仅测试用。 */
export function resetBlankPasswordPolicyCache(): void {
  cached = undefined;
}

function read(): BlankPasswordPolicy {
  try {
    const advapi = koffi.load("advapi32.dll");
    const RegOpenKeyExW = advapi.func(
      "long __stdcall RegOpenKeyExW(void *hkey, const char16_t *subkey, uint32 opts, uint32 sam, _Out_ void **result)",
    );
    const RegQueryValueExW = advapi.func(
      "long __stdcall RegQueryValueExW(void *hkey, const char16_t *name, void *reserved, void *type, void *data, void *size)",
    );
    const RegCloseKey = advapi.func("long __stdcall RegCloseKey(void *hkey)");

    // HKEY_LOCAL_MACHINE = 0x80000002
    const HKEY_LOCAL_MACHINE = 0x80000002;
    // KEY_READ = 0x20019
    const KEY_READ = 0x20019;
    const REG_DWORD = 4;

    const opened: unknown[] = [null];
    const openHr = RegOpenKeyExW(
      HKEY_LOCAL_MACHINE,
      LSA_KEY,
      0,
      KEY_READ,
      opened,
    ) as number;
    if ((openHr >>> 0) !== 0) {
      return {
        blankPasswordNetworkLogonAllowed: false,
        registryValue: undefined,
        detail:
          `无法打开注册表键 ${LSA_KEY}（0x${(openHr >>> 0).toString(16)}），` +
          "按安全默认处理：视为要求密码。",
      };
    }

    // **out 参数必须用 koffi.alloc 分配，不能传 Node Buffer。**
    //
    // 实测：传 Buffer 时 RegQueryValueExW 返回 0xEA（ERROR_MORE_DATA），
    // 且 type/size 都正确读出、只有数据没写进去 —— 因为 koffi 把 Buffer
    // 当成了一个临时的拷贝，native 侧写入的地址与它看到的不是同一块内存。
    // 换成 koffi.alloc 后立刻正常。这个坑与「koffi.address 不接受 Buffer」
    // 是同一类约束。
    const typeMem = koffi.alloc("uint32", 1);
    const dataMem = koffi.alloc("uint32", 1);
    const sizeMem = koffi.alloc("uint32", 1);
    koffi.encode(sizeMem, "uint32", 4);
    try {
      const queryHr = RegQueryValueExW(
        opened[0],
        LIMIT_BLANK_PASSWORD_USE,
        null,
        typeMem,
        dataMem,
        sizeMem,
      ) as number;

      if ((queryHr >>> 0) !== 0) {
        return {
          blankPasswordNetworkLogonAllowed: false,
          registryValue: undefined,
          detail:
            `无法读取 ${LIMIT_BLANK_PASSWORD_USE}（0x${(queryHr >>> 0).toString(16)}），` +
            "按安全默认处理：视为要求密码。",
        };
      }

      const type = koffi.decode(typeMem, "uint32") as number;
      if (type !== REG_DWORD) {
        return {
          blankPasswordNetworkLogonAllowed: false,
          registryValue: undefined,
          detail:
            `${LIMIT_BLANK_PASSWORD_USE} 的类型是 ${type}，不是 REG_DWORD；` +
            "按安全默认处理：视为要求密码。",
        };
      }

      const value = koffi.decode(dataMem, "uint32") as number;
      return {
        blankPasswordNetworkLogonAllowed: value === 0,
        registryValue: value,
        detail:
          value === 0
            ? `${LIMIT_BLANK_PASSWORD_USE}=0，允许空密码网络登录（可跳过密码输入）`
            : `${LIMIT_BLANK_PASSWORD_USE}=1，空密码仅限控制台登录（必须提供密码）`,
      };
    } finally {
      RegCloseKey(opened[0]);
      koffi.free(typeMem);
      koffi.free(dataMem);
      koffi.free(sizeMem);
    }
  } catch (error) {
    return {
      blankPasswordNetworkLogonAllowed: false,
      registryValue: undefined,
      detail:
        `读取空密码策略失败：${error instanceof Error ? error.message : String(error)}。` +
        "按安全默认处理：视为要求密码。",
    };
  }
}
