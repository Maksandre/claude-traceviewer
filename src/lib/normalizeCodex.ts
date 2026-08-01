import type { CodexRecord, CodexResponseItem } from "../codex-types";
import { costFor } from "./format";
import {
  EMPTY_USAGE,
  addUsage,
  buildModelStats,
  dominantEffort,
} from "./normalize";
import type { NormBlock, NormMsg, NormToolResult, NormTrace } from "./normalize";

// === Codex CLI trace normalization ===
// Turns a Codex rollout file's records into the same NormTrace shape Claude
// Code sessions use, so the whole UI renders both without caring which CLI
// wrote the trace. Structural differences that shape this code:
// - Text is duplicated: the clean user prompt lives in event_msg/user_message
//   while response_item message(role=user) mixes real prompts with
//   harness-injected XML (<environment_context>, permissions, …). Assistant
//   text is duplicated the other way round: response_item message(role=
//   assistant) is canonical and event_msg/agent_message is the copy.
// - Tool calls pair by call_id (function_call → function_call_output),
//   not by Anthropic's tool_use_id — but the pairing shape is identical.
// - Usage arrives as event_msg/token_count after each API call, where
//   input_tokens *includes* cached_input_tokens, and there is no
//   cache-write concept at all.
// - Reasoning is encrypted; only optional summaries are renderable.
// - There are no subagents or workflows.

const EXIT_CODE_RE = /(?:Process exited with code|Exit code:)\s*(\d+)/;

function outputIsError(output: string): boolean {
  const m = output.match(EXIT_CODE_RE);
  return m ? m[1] !== "0" : false;
}

function partsText(content: CodexResponseItem["content"]): string {
  if (!Array.isArray(content)) return "";
  return content.map((p) => p?.text || "").filter(Boolean).join("\n");
}

interface CodexImage { media_type: string; data: string }

// Attached images arrive as [<image name=[Image #N]>, input_image(data URI),
// </image>] part triplets followed by the message text. Split content into
// the clean text (wrappers dropped) and the decoded images.
const IMG_WRAP_RE = /^<image name=.*>$|^<\/image>$/;
const DATA_URI_RE = /^data:(image\/[a-z0-9+.-]+);base64,(.+)$/s;

function splitUserContent(content: CodexResponseItem["content"]): { text: string; images: CodexImage[] } {
  if (!Array.isArray(content)) return { text: "", images: [] };
  const texts: string[] = [];
  const images: CodexImage[] = [];
  for (const part of content) {
    if (part?.type === "input_image" && typeof part.image_url === "string") {
      const m = part.image_url.match(DATA_URI_RE);
      if (m) images.push({ media_type: m[1], data: m[2] });
      continue;
    }
    const t = part?.text || "";
    if (t && !IMG_WRAP_RE.test(t.trim())) texts.push(t);
  }
  return { text: texts.join("\n"), images };
}

function parseArguments(args: string | undefined): Record<string, unknown> {
  if (!args) return {};
  try {
    const v = JSON.parse(args);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    return { arguments: v };
  } catch {
    return { arguments: args };
  }
}

// "<environment_context>…" → "environment context"; harness-injected user/
// developer messages render as collapsed context rows under this label.
function contextLabel(role: string, text: string): string {
  const m = text.trim().match(/^<([a-z0-9_ -]+)>/i);
  if (m) return m[1].replace(/[_-]/g, " ").trim();
  return role === "developer" ? "developer instructions" : "context";
}

export function normalizeCodexTrace(session: string, records: CodexRecord[]): NormTrace {
  // Pre-pass: the clean user prompts (used to drop the response_item copies)
  // and the images attached to them. Images only live on the response_item
  // copy, which can precede or follow its user_message event, so they're
  // queued by prompt text and attached when the event builds the user turn.
  const userTexts = new Set<string>();
  const imageQueueByText = new Map<string, CodexImage[][]>();
  for (const rec of records) {
    const p = rec.payload;
    if (!p) continue;
    if (rec.type === "event_msg" && p.type === "user_message" && typeof p.message === "string") {
      userTexts.add(p.message.trim());
    }
    if (rec.type === "response_item" && p.type === "message" && p.role === "user") {
      const { text, images } = splitUserContent(p.content);
      if (images.length) {
        const q = imageQueueByText.get(text.trim()) || [];
        q.push(images);
        imageQueueByText.set(text.trim(), q);
      }
    }
  }

  const messages: NormMsg[] = [];
  const toolResults: Record<string, NormToolResult> = {};
  const toolCounts: Record<string, number> = {};
  const toolUseMsgUuid: Record<string, string> = {};
  const modelsSeen = new Set<string>();

  let sessionId = "";
  let cwd = "";
  let model = "";
  let effort = "";
  let ctxWindow = 0;
  let peakContext = 0;
  let startedAt = "";
  let endedAt = "";
  let seq = 0;

  // The assistant message currently being assembled: one NormMsg per API
  // call, closed by the token_count event that bills it.
  let cur: NormMsg | null = null;

  const closeCur = () => {
    // Keep messages that carry either content or billing: a completion whose
    // only output was encrypted reasoning still spent tokens, and dropping it
    // would silently undercount the session totals.
    if (cur && (cur.blocks.length > 0 || cur.usage.output > 0 || cur.usage.input > 0 || cur.usage.cr > 0)) {
      messages.push(cur);
    }
    cur = null;
  };
  const ensureCur = (ts: string): NormMsg => {
    if (!cur) {
      cur = {
        uuid: `codex-${seq++}`,
        ts,
        role: "assistant",
        model,
        blocks: [],
        usage: EMPTY_USAGE(),
        effort,
      };
    }
    return cur;
  };
  const pushAttachment = (ts: string, label: string, content: string) => {
    messages.push({
      uuid: `codex-${seq++}`,
      ts,
      role: "attachment",
      model: "",
      blocks: [{ type: "attachment", attachment: { type: "codex_context", label, content } }],
      usage: EMPTY_USAGE(),
    });
  };

  for (const rec of records) {
    const ts = rec.timestamp || "";
    if (ts) {
      if (!startedAt) startedAt = ts;
      endedAt = ts;
    }
    const p = rec.payload;
    if (!p) continue;

    if (rec.type === "session_meta") {
      sessionId = p.id || p.session_id || sessionId;
      if (typeof p.cwd === "string") cwd = p.cwd;
      continue;
    }

    if (rec.type === "turn_context") {
      closeCur();
      if (p.model) { model = p.model; modelsSeen.add(p.model); }
      if (typeof p.effort === "string") effort = p.effort;
      continue;
    }

    if (rec.type === "response_item") {
      const kind = p.type;
      if (kind === "message") {
        if (p.role === "assistant") {
          const text = partsText(p.content);
          if (text.trim()) ensureCur(ts).blocks.push({ type: "text", text });
        } else if (p.role === "user" || p.role === "developer") {
          // Real prompts already came through event_msg/user_message (their
          // images are queued and attached there); what's left here is
          // harness-injected context — or, rarely, an image-bearing prompt
          // with no matching event, which still renders as a user turn.
          const { text, images } = splitUserContent(p.content);
          if (userTexts.has(text.trim())) continue;
          closeCur();
          if (images.length) {
            messages.push({
              uuid: `codex-${seq++}`,
              ts,
              role: "user",
              model: "",
              blocks: [
                ...(text.trim() ? [{ type: "text", text } as NormBlock] : []),
                ...images.map((img): NormBlock => ({ type: "image", source: { type: "base64", ...img } })),
              ],
              usage: EMPTY_USAGE(),
            });
          } else if (text.trim()) {
            pushAttachment(ts, contextLabel(p.role, text), text);
          }
        }
        continue;
      }
      if (kind === "reasoning") {
        const parts = Array.isArray(p.summary) ? p.summary : [];
        const summary = parts.map((s) => s?.text || "").filter(Boolean).join("\n\n");
        if (summary) ensureCur(ts).blocks.push({ type: "thinking", thinking: summary });
        continue;
      }
      if (kind === "function_call" || kind === "custom_tool_call") {
        const callId = p.call_id || p.id || `codex-call-${seq}`;
        const name = p.name || "tool";
        const input: Record<string, unknown> =
          kind === "function_call" ? parseArguments(p.arguments) : { input: p.input || "" };
        const msg = ensureCur(ts);
        msg.blocks.push({ type: "tool_use", id: callId, name, input });
        toolCounts[name] = (toolCounts[name] || 0) + 1;
        toolUseMsgUuid[callId] = msg.uuid;
        continue;
      }
      if (kind === "function_call_output" || kind === "custom_tool_call_output") {
        if (p.call_id) {
          const output = p.output || "";
          toolResults[p.call_id] = { content: output, is_error: outputIsError(output) };
        }
        continue;
      }
      if (kind === "web_search_call") {
        const callId = p.id || `codex-search-${seq}`;
        const msg = ensureCur(ts);
        msg.blocks.push({ type: "tool_use", id: callId, name: "web_search_call", input: { query: p.action?.query || "" } });
        toolCounts["web_search_call"] = (toolCounts["web_search_call"] || 0) + 1;
        toolUseMsgUuid[callId] = msg.uuid;
        if (p.status) toolResults[callId] = { content: p.status, is_error: p.status === "failed" };
        continue;
      }
      continue;
    }

    if (rec.type === "event_msg") {
      const kind = p.type;
      if (kind === "user_message") {
        closeCur();
        if (typeof p.message === "string" && p.message.trim()) {
          const attached = imageQueueByText.get(p.message.trim())?.shift() || [];
          messages.push({
            uuid: `codex-${seq++}`,
            ts,
            role: "user",
            model: "",
            blocks: [
              { type: "text", text: p.message } as NormBlock,
              ...attached.map((img): NormBlock => ({ type: "image", source: { type: "base64", ...img } })),
            ],
            usage: EMPTY_USAGE(),
          });
        }
        continue;
      }
      if (kind === "token_count") {
        const last = p.info?.last_token_usage;
        if (p.info?.model_context_window) ctxWindow = p.info.model_context_window;
        if (last) {
          // input_tokens includes the cached share; split it out so cost math
          // bills fresh input and cache reads at their own rates. cw stays 0 —
          // OpenAI has no cache-write billing.
          const cr = last.cached_input_tokens || 0;
          const input = Math.max(0, (last.input_tokens || 0) - cr);
          const output = last.output_tokens || 0;
          const u = { input, output, cw: 0, cr, cost: costFor(model, { input, output, cw: 0, cr }) };
          // Attach to the completion being assembled, or the latest unbilled
          // one; if neither exists (a completion with nothing renderable),
          // synthesize an empty assistant message so the spend still counts.
          const target = cur
            ?? [...messages].reverse().find((m) => m.role === "assistant" && m.usage.output === 0)
            ?? ensureCur(ts);
          target.usage = u;
          const ctx = input + cr;
          if (ctx > peakContext) peakContext = ctx;
        }
        closeCur();
        continue;
      }
      if (kind === "task_started") {
        if (p.model_context_window) ctxWindow = p.model_context_window;
        continue;
      }
      if (kind === "task_complete") {
        closeCur();
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "assistant") { messages[i].stopReason = "end_turn"; break; }
        }
        continue;
      }
      if (kind === "turn_aborted") {
        closeCur();
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "assistant") { messages[i].stopReason = "aborted"; break; }
        }
        continue;
      }
      // agent_message duplicates response_item assistant text — skip, along
      // with the remaining progress-style events.
      continue;
    }
    // world_state / compacted / unknown record types: forward-compat no-op.
  }
  closeCur();

  const usage = EMPTY_USAGE();
  for (const m of messages) addUsage(usage, m.usage);
  const { modelMix, modelStats } = buildModelStats([messages]);
  const toolFreq = { ...toolCounts };
  const ctxTotal = usage.input + usage.cw + usage.cr;
  const cacheRatio = ctxTotal > 0 ? usage.cr / ctxTotal : 0;
  const durationMs = startedAt && endedAt ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : 0;

  return {
    session: {
      id: sessionId || session,
      project: cwd || "",
      attributionSkill: "",
      gitBranch: "",
      models: [...modelsSeen],
      effort: dominantEffort(messages),
      durationMs,
      startedAt,
      endedAt,
      provider: "codex",
      contextWindow: ctxWindow || undefined,
    },
    main: {
      messages,
      toolResults,
      toolCounts,
      toolUseMsgUuid,
      usage,
      peakContext,
    },
    agents: [],
    workflows: [],
    stats: { totals: usage, modelMix, toolFreq, cacheRatio, modelStats },
  };
}
