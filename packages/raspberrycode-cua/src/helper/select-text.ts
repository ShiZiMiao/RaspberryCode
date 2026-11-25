/**
 * 文本选区 handler。
 *
 * 从 `action-handlers.ts` 抽出：选区只有 UIA TextPattern 一条路径，
 * 不参与「按预算选路径」的核心逻辑，单独成文件更清楚。
 */

import { DISPATCH_PATH } from "./dispatch-plan.ts";
import { intParam, stringParam } from "./handler-support.ts";
import { selectTextRange } from "./patterns.ts";

export type ResolveElementForSelect = (
  stateId: string | undefined,
  index: number | undefined,
) => {
  node: { kind: string; name: string };
  element: unknown;
};

/**
 * 文本选区（SDK 的 `select_text`）。
 *
 * 参数：`stateId` / `index` / `start` / `length`
 * （SDK 在客户端把「要选中的文本」换算成 `[start, length]` 后传下来）。
 *
 * 只有一条路径：UIA TextPattern。不支持就明确报错，**不降级到物理注入**——
 * 用 SetFocus + Shift+方向键模拟选区会抢键鼠，且要正确处理换行/自动换行，
 * 算错就会破坏用户已有输入。选中文本是精细操作，宁可不做也不能做错。
 */
export function createSelectTextHandler(resolveElement: ResolveElementForSelect) {
  return (params: unknown) => {
    const startedAt = Date.now();
    const stateId = stringParam(params, "stateId");
    const index = intParam(params, "index");
    const { node, element } = resolveElement(stateId, index);

    const start = intParam(params, "start") ?? 0;
    const length = intParam(params, "length") ?? 0;
    if (start < 0 || length < 0) {
      throw Object.assign(new Error("start 与 length 必须是非负数"), { code: "bad_request" });
    }

    const outcome = selectTextRange(element, start, length);
    if (!outcome.ok) {
      throw Object.assign(new Error(outcome.reason ?? "文本选区失败"), {
        code: "element_unavailable",
        detail: {
          hresult: outcome.hresult,
          documentLength: outcome.documentLength,
          requested: { start, length },
        },
      });
    }

    // 校验：读回的选区必须与请求一致。不一致说明控件没按请求应用选区
    // （只读、或有逻辑重置），此时报错比给一个「成功」回执有用。
    const requested = length;
    const actual = outcome.selectedText?.length ?? 0;
    if (requested > 0 && actual !== requested) {
      throw Object.assign(
        new Error(
          `选区已应用但系统读回的选中长度为 ${actual}，与请求的 ${requested} 不符。` +
            "该控件可能限制了可选范围。",
        ),
        {
          code: "element_unavailable",
          detail: { requested: { start, length }, selectedText: outcome.selectedText },
        },
      );
    }

    return {
      // 选区走 UIA，不改窗口位置也不碰键鼠——但 Select 会激活窗口，
      // 与其它二级动作同性质，必须如实披露。
      path: DISPATCH_PATH.AX,
      dispatchStatus: "sent",
      effect: "unverifiable",
      activatesWindow: true,
      grabInput: false,
      stateId,
      index,
      elementKind: node.kind,
      elementName: node.name,
      semanticAction: "select_text",
      selection: {
        start,
        length,
        selectedText: outcome.selectedText,
        documentLength: outcome.documentLength,
      },
      elapsedMs: Date.now() - startedAt,
    };
  };
}
