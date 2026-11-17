/**
 * 强制单 Range 顺序差分。
 *
 * electron-updater 的 github 分支忽略 `useMultipleRangeRequest`，且
 * `createProviderRuntimeOptions` 硬编码 `isUseMultipleRangeRequest = true`；
 * GitHub 资产存储不支持 multipart/byteranges，多 Range 探测会回退整包下载。
 * 这里覆盖 runtime 选项，保证差量更新走「单 Range 顺序拉取差异块」路径
 * （约 15MB 级差异包而非 300MB+ 全量包）。
 *
 * 从 autoUpdateService.ts 抽出：该文件已触达 800 行架构上限，本函数是纯
 * 对象打补丁逻辑，与更新状态机无关，独立成文件更清晰。
 */

/** 打补丁所需的最小结构面（probe 而非断言，缺字段时安全跳过）。 */
interface SingleRangePatchTarget {
  createProviderRuntimeOptions?: () => Record<string, unknown>;
  raspberrycodeSingleRangePatched?: boolean;
}

export function patchSingleRangeDifferential(target: object): void {
  const patched = target as SingleRangePatchTarget;
  if (
    typeof patched.createProviderRuntimeOptions !== "function" ||
    patched.raspberrycodeSingleRangePatched
  ) {
    return;
  }
  const original = patched.createProviderRuntimeOptions.bind(patched);
  patched.createProviderRuntimeOptions = () => ({
    ...original(),
    isUseMultipleRangeRequest: false,
  });
  patched.raspberrycodeSingleRangePatched = true;
}
