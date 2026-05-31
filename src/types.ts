export interface SessionInfo {
  id: string;
  file: string;
  size: number;
  modified: string;
  lineCount: number;
  slug: string;
  preview: string;
}

export interface ProjectMeta {
  name: string;
  sessionCount: number;
  mtime: number;
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
}

export interface TraceRecord {
  type: "user" | "assistant" | "progress" | "system" | "queue-operation" | "file-history-snapshot" | "last-prompt";
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  promptId?: string;
  sessionId?: string;
  slug?: string;

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
