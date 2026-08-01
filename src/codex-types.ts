/* Raw record shapes for OpenAI Codex CLI rollout files
 * (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl), mirroring the JSONL 1:1
 * the way types.ts mirrors Claude Code's TraceRecord. Every line is
 * { timestamp, type, payload }; `type` + `payload.type` discriminate. */

export interface CodexTokenUsage {
  input_tokens?: number;
  /** Included in input_tokens, not additional to it. */
  cached_input_tokens?: number;
  output_tokens?: number;
  /** Subset of output_tokens, not additional to it. */
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export interface CodexContentPart {
  type?: string; // "input_text" | "output_text" | "input_image" | …
  text?: string;
  /** input_image: a data:image/…;base64,… URI embedded right in the JSONL. */
  image_url?: string;
}

/** payload of type: "session_meta" — always the file's first line. */
export interface CodexSessionMeta {
  type?: string;
  id?: string;
  session_id?: string;
  timestamp?: string;
  cwd?: string;
  originator?: string;
  cli_version?: string;
  model_provider?: string;
  base_instructions?: { text?: string };
}

/** payload of type: "turn_context" — ambient settings for the turn. */
export interface CodexTurnContext {
  type?: string;
  turn_id?: string;
  cwd?: string;
  model?: string;
  effort?: string;
  summary?: string;
  approval_policy?: string;
  sandbox_policy?: unknown;
}

/** payload of type: "response_item" — one item of the model conversation. */
export interface CodexResponseItem {
  type?: string; // "message" | "function_call" | "function_call_output" | "custom_tool_call" | "custom_tool_call_output" | "reasoning" | "web_search_call" | …
  id?: string;
  role?: string; // message: "user" | "developer" | "assistant"
  content?: CodexContentPart[];
  // function_call / custom_tool_call
  name?: string;
  arguments?: string; // JSON string (function_call)
  input?: string; // raw string (custom_tool_call, e.g. an apply_patch body)
  call_id?: string;
  status?: string;
  // function_call_output / custom_tool_call_output
  output?: string;
  // reasoning
  summary?: { type?: string; text?: string }[];
  encrypted_content?: string;
  // web_search_call
  action?: { type?: string; query?: string };
}

/** payload of type: "event_msg" — UI-level events interleaved with items. */
export interface CodexEventMsg {
  type?: string; // "user_message" | "agent_message" | "token_count" | "task_started" | "task_complete" | "turn_aborted" | …
  message?: string;
  phase?: string;
  turn_id?: string;
  model_context_window?: number;
  info?: {
    total_token_usage?: CodexTokenUsage;
    last_token_usage?: CodexTokenUsage;
    model_context_window?: number;
  };
}

/** Union of every payload field. A flat merge (not an intersection of the
 * per-record interfaces) because `summary` means different things on
 * turn_context (a string setting) and reasoning items (text parts). */
export interface CodexPayload extends Omit<CodexSessionMeta, "type">, Omit<CodexTurnContext, "type" | "summary">, Omit<CodexResponseItem, "type" | "summary">, Omit<CodexEventMsg, "type" | "message"> {
  type?: string;
  summary?: string | { type?: string; text?: string }[];
  message?: string;
}

export interface CodexRecord {
  timestamp?: string;
  type: "session_meta" | "turn_context" | "response_item" | "event_msg" | "world_state" | "compacted" | string;
  payload?: CodexPayload;
}

/** Cheap shape sniff: lets the client pick the right normalizer without
 * threading a provider flag through every fetch (deep links included). */
export function isCodexRecords(records: unknown[]): boolean {
  const first = records[0] as CodexRecord | undefined;
  return !!first && (first.type === "session_meta" || (typeof first.type === "string" && "payload" in first && (first.type === "response_item" || first.type === "event_msg" || first.type === "turn_context")));
}
