export type Provider = "claude" | "codex";

export interface SessionInfo {
  id: string;
  file: string;
  size: number;
  modified: string;
  lineCount: number;
  slug: string;
  preview: string;
  /** Which CLI wrote the session. Absent on older server responses → claude. */
  provider?: Provider;
  /** Starred in the sidebar. Liking also snapshots the session's file to a
   * server-side backup dir, independent of source retention. */
  liked?: boolean;
  /** ISO timestamp of the last backup snapshot; set once liked. */
  backedUpAt?: string;
}

export interface ProjectMeta {
  name: string;
  sessionCount: number;
  mtime: number;
  /** Real working directory from the session records. Used for display because
   * the encoded `name` replaces every "/" with "-" and is ambiguous for
   * directory names that legitimately contain dashes. */
  cwd?: string;
  /** CLIs that have sessions in this project (a directory can hold both). */
  providers?: Provider[];
  /** Per-provider session counts; sessionCount is their sum. */
  claudeCount?: number;
  codexCount?: number;
  /** Number of sessions in this project that are liked/backed up. */
  likedCount?: number;
}

export interface ContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "image";
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  source?: { type: string; media_type: string; data: string };
  caller?: { type: string };
  /** Anthropic marks failed tool results with this; preferred over text heuristics. */
  is_error?: boolean;
}

/** Context the harness injected into the next model call (skill listings,
 * deferred-tool deltas, nested memory files, IDE state, …). The `type` field
 * discriminates; the rest of the shape varies per type. */
export interface AttachmentPayload {
  type?: string;
  [key: string]: unknown;
}

export interface TraceRecord {
  type: "user" | "assistant" | "progress" | "system" | "queue-operation" | "file-history-snapshot" | "last-prompt" | "attachment";
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  promptId?: string;
  sessionId?: string;
  slug?: string;
  /** Reasoning effort the assistant turn ran at ("low" … "max"). Written on
   * assistant records only; absent on older traces. */
  effort?: string;

  // user / assistant
  message?: {
    role?: string;
    model?: string;
    id?: string;
    content?: string | ContentBlock[];
    stop_reason?: string | null;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };

  // user tool result extras
  toolUseResult?: any;
  sourceToolAssistantUUID?: string;

  // attachment
  attachment?: AttachmentPayload;

  // progress
  data?: {
    type: "agent_progress" | "hook_progress";
    prompt?: string;
    agentId?: string;
    message?: TraceRecord;
    hookEvent?: string;
    hookName?: string;
  };
  toolUseID?: string;
  parentToolUseID?: string;

  // system
  subtype?: string;
  durationMs?: number;

  // queue-operation
  operation?: string;
  content?: string;

  // last-prompt
  lastPrompt?: string;

  // metadata
  permissionMode?: string;
  entrypoint?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  requestId?: string;
}
