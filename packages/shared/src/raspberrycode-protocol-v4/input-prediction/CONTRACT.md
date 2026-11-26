# remote-input-prediction

输入预测：客户端按草稿向桌面发起 `v4/conversation/inputPrediction` 只读查询，桌面 Host 转发给 CLI 旁路调用模型，返回最多 3 个续写候选。手机远控 ghost hint 与桌面下一步输入建议共用同一条链路；完整规格见 `docs/archive/web-remote-control/mobile-input-prediction.md` 与 `specs/next-input-suggestions.md`。

本模块由四处组成：本目录 `contract.ts`（线格式 schema 与纯函数）、`packages/services/src/raspberrycode-agent/inputPredictionSwitch.ts`（Host 侧开关）、CLI 的 `input-prediction-handler.ts`（协议处理）与 `input-prediction-sidecar.ts`（模型调用）。

不变量：

- 只读：预测不写会话、不进历史、不产生任务事件。
- 失败静默：开关关闭、无模型、超时或报错一律回 `unavailable`，不向手机报错。
- hello 里的 `capabilities.inputPrediction` 和请求是否真的转发由同一个开关决定，二者必须一致。
- 同会话新请求会取消旧请求；`requestId` 原样回显，手机据此丢弃过期响应。
- 候选逐条按置信度门槛过滤：低于门槛的候选不返回；过滤后为空则 `suppress_below_threshold`。
