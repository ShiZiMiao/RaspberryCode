import { deriveSessionTitle } from "#src/session/sessionTitle.js";
import {
  isObjectRecord,
  readTrimmedString,
  type JsonLineRecord,
} from "#src/session/claude-native/jsonLineRecord.js";

/**
 * Codex 的 rollout 记录（~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl）。
 *
 * 结构与本仓已有 Claude jsonl 完全不同，关键点：
 * - `session_meta` 首行携带 `payload.cwd` 与 `payload.id`（会话 id）；
 * - 会话内容集中在 `response_item` 且 `payload.type === "message"`；
 * - `payload.role` 取 user / assistant / developer / system，其中 developer/system 是
 *   Codex 自己注入的 app-context、多智能体角色等提示词，不属于用户可见对话，必须丢弃；
 * - 其余 type（event_msg / turn_context / token_usage_record / world_state）是运行态事件，忽略。
 */
const CODEX_VISIBLE_ROLES = new Set(["user", "assistant"]);

/**
 * Codex 会把运行环境信息以 **user 角色**注入（<environment_context> 等），
 * 它们出现在第一条真实提问之前。只靠 role 过滤不干净，会把整段 XML 当成用户正文
 * 和会话标题（真实数据验证时确实如此）。这里按标签整体剥离。
 */
const CODEX_INJECTED_USER_TAGS = [
  "environment_context",
  "user_instructions",
  "user_shell_command",
  "turn_aborted",
] as const;

function stripCodexInjectedUserContent(text: string): string {
  let result = text;
  for (const tag of CODEX_INJECTED_USER_TAGS) {
    const blockRe = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    result = result.replace(blockRe, " ");
    // 自闭合或无闭合的形式也要清掉，避免残留半截标签进入正文。
    const selfClosingRe = new RegExp(`<${tag}\\b[^>]*\\/>`, "gi");
    result = result.replace(selfClosingRe, " ");
  }
  return result
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Codex 的 event_msg.started_at 用秒级 unix 时间；jsonl 顶层的 timestamp 是 ISO 串。
    if (value > 1_000_000_000_000) return Math.trunc(value);
    if (value > 1_000_000_000) return Math.trunc(value * 1000);
    return undefined;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) return toTimestampMs(numeric);
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readRecordTimestamp(record: JsonLineRecord): number | undefined {
  return toTimestampMs(record.timestamp) ?? toTimestampMs(record.created_at);
}

export interface CodexSessionMeta {
  sessionId?: string;
  workspacePath?: string;
  createdAt?: number;
  model?: string;
}

/** 从 session_meta 行读取 cwd / session id；缺失时由调用方退回文件名与目录推断。 */
export function extractCodexSessionMeta(records: readonly JsonLineRecord[]): CodexSessionMeta {
  for (const record of records) {
    if (record.type !== "session_meta") continue;
    const payload = isObjectRecord(record.payload) ? record.payload : undefined;
    if (!payload) continue;
    const workspacePath = readTrimmedString(payload.cwd);
    const sessionId =
      readTrimmedString(payload.session_id) ?? readTrimmedString(payload.id) ?? undefined;
    const model = readTrimmedString(payload.model) ?? undefined;
    if (workspacePath || sessionId) {
      return {
        ...(sessionId ? { sessionId } : {}),
        ...(workspacePath ? { workspacePath } : {}),
        ...(model ? { model } : {}),
        ...(readRecordTimestamp(record) ? { createdAt: readRecordTimestamp(record) } : {}),
      };
    }
  }
  return {};
}

function extractCodexMessageText(payload: Record<string, unknown>): string | null {
  const content = payload.content;
  const chunks: string[] = [];

  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed) chunks.push(trimmed);
        continue;
      }
      if (!isObjectRecord(item)) continue;
      // Codex 用 input_text / output_text / text 三种键表示纯文本块；
      // 图片等非文本块不进入导入正文。
      const text =
        readTrimmedString(item.text) ??
        readTrimmedString(item.input_text) ??
        readTrimmedString(item.output_text);
      if (text) chunks.push(text);
    }
  }

  if (chunks.length === 0) return null;
  const joined = chunks.join("\n\n");
  // assistant 正文不剥离：模型偶尔会原样回复标签，不能误删。
  return joined;
}

export interface CodexVisibleMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

/** 提取用户可见对话；developer/system 注入提示词与运行态事件一律跳过。 */
export function extractCodexVisibleMessages(
  records: readonly JsonLineRecord[],
): CodexVisibleMessage[] {
  const messages: CodexVisibleMessage[] = [];

  for (const record of records) {
    if (record.type !== "response_item") continue;
    const payload = isObjectRecord(record.payload) ? record.payload : undefined;
    if (!payload || payload.type !== "message") continue;
    const role = readTrimmedString(payload.role);
    if (!role || !CODEX_VISIBLE_ROLES.has(role)) continue;
    const text = extractCodexMessageText(payload);
    if (!text) continue;
    // user 角色可能是环境注入，剥离后再判断是否还有真实内容。
    const content = role === "user" ? stripCodexInjectedUserContent(text) : text;
    if (!content) continue;
    messages.push({
      role: role as "user" | "assistant",
      content,
      ...(readRecordTimestamp(record) ? { timestamp: readRecordTimestamp(record) } : {}),
    });
  }

  return messages;
}

export function previewCodexSessionTitle(
  messages: readonly CodexVisibleMessage[],
): string | undefined {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) return undefined;
  return deriveSessionTitle(firstUser.content, []);
}
