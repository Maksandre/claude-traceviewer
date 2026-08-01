import type { ContentBlock, TraceRecord } from "../types";
import { costFor, MODEL_FAMILIES, modelFamily } from "./format";
import type { ModelFamily } from "./format";

export interface NormBlock {
  type: "text" | "thinking" | "tool_use" | "image" | "attachment";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
  source?: { type: string; media_type: string; data: string };
  /** Payload of a harness-injected attachment record (skill listing,
   * deferred-tool delta, nested memory, …). `attachment.type` discriminates. */
  attachment?: Record<string, unknown>;
}

export interface NormMsg {
  uuid: string;
  ts: string;
  role: "user" | "assistant" | "attachment";
  model: string;
  blocks: NormBlock[];
  usage: { input: number; output: number; cw: number; cr: number; cost: number };
  stopReason?: string | null;
  attributionSkill?: string;
  onlyResults?: boolean;
  /** Reasoning effort this assistant turn ran at; "" when the trace predates it. */
  effort?: string;
}

export interface NormToolResult {
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface NormAgent {
  id: string;
  toolUseId: string;
  agentType: string;
  description: string;
  model: string;
  /** Reasoning effort the agent ran at (the dominant one across its turns);
   * "" when the trace records don't carry it. */
  effort: string;
  prompt: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  msgCount: number;
  messages: NormMsg[];
  toolResults: Record<string, NormToolResult>;
  toolCounts: Record<string, number>;
  toolUseMsgUuid: Record<string, string>;
  usage: { input: number; output: number; cw: number; cr: number; cost: number };
  peakContext: number;
  result: string;
  persona: { content: string; resolvedPath: string } | null;
  /** Set when this agent was spawned by a Workflow tool call rather than a
   * direct Agent/Task spawn. Holds the workflow run id (e.g. "wf_29eaba04-db0"). */
  workflowId?: string;
  /** id of the agent that spawned this one, or "" when spawned by the main
   * agent. Subagents can spawn their own subagents; this reconstructs the
   * real delegation tree instead of flattening everything under main. */
  parentId?: string;
}

/** One Workflow tool run: the orchestration that fanned out a set of subagents. */
export interface NormWorkflow {
  runId: string;
  /** tool_use id of the Workflow call that launched it, for conversation linking. */
  toolUseId: string;
  name: string;
  summary: string;
  /** ids of the subagents this run spawned, in discovery order. */
  agentIds: string[];
}

export interface NormSession {
  /** The conversation id — the session uuid Claude Code names the .jsonl after. */
  id: string;
  project: string;
  attributionSkill: string;
  gitBranch: string;
  models: string[];
  /** Reasoning effort the main agent ran at (dominant across its turns). */
  effort: string;
  durationMs: number;
  startedAt: string;
  endedAt: string;
  /** Which CLI wrote the trace; drives provider-specific UI (no Agents tab
   * for Codex, provider badge, …). Absent on traces normalized before this
   * field existed — treat as "claude". */
  provider?: "claude" | "codex";
  /** Context window the trace itself reported (Codex records it per turn);
   * preferred over the per-family constant when present. */
  contextWindow?: number;
}

export interface NormStats {
  totals: { input: number; output: number; cw: number; cr: number; cost: number };
  modelMix: Record<ModelFamily, number>;
  toolFreq: Record<string, number>;
  cacheRatio: number;
  modelStats: { family: ModelFamily; tokens: number; cost: number }[];
}

export interface NormTrace {
  session: NormSession;
  main: {
    messages: NormMsg[];
    toolResults: Record<string, NormToolResult>;
    toolCounts: Record<string, number>;
    toolUseMsgUuid: Record<string, string>;
    usage: { input: number; output: number; cw: number; cr: number; cost: number };
    peakContext: number;
  };
  agents: NormAgent[];
  workflows: NormWorkflow[];
  stats: NormStats;
}

export const EMPTY_USAGE = () => ({ input: 0, output: 0, cw: 0, cr: 0, cost: 0 });

export function addUsage(a: { input: number; output: number; cw: number; cr: number; cost: number }, b: { input: number; output: number; cw: number; cr: number; cost: number }) {
  a.input += b.input; a.output += b.output; a.cw += b.cw; a.cr += b.cr; a.cost += b.cost;
}

/** Per-family token/cost roll-up across message lists. Built from
 * MODEL_FAMILIES so a new family can't silently miss a bucket. */
export function buildModelStats(messageLists: NormMsg[][]): {
  modelMix: Record<ModelFamily, number>;
  modelStats: { family: ModelFamily; tokens: number; cost: number }[];
} {
  const familyAcc = Object.fromEntries(
    MODEL_FAMILIES.map(f => [f, { tokens: 0, cost: 0 }])
  ) as Record<ModelFamily, { tokens: number; cost: number }>;
  for (const msgs of messageLists) {
    for (const m of msgs) {
      if (m.role !== "assistant") continue;
      const fam = modelFamily(m.model);
      familyAcc[fam].tokens += m.usage.input + m.usage.output + m.usage.cw + m.usage.cr;
      familyAcc[fam].cost += m.usage.cost;
    }
  }
  const modelMix = Object.fromEntries(
    MODEL_FAMILIES.map(f => [f, familyAcc[f].tokens])
  ) as Record<ModelFamily, number>;
  const modelStats = (Object.entries(familyAcc) as [ModelFamily, { tokens: number; cost: number }][])
    .filter(([, v]) => v.tokens > 0)
    .map(([family, v]) => ({ family, tokens: v.tokens, cost: v.cost }))
    .sort((a, b) => b.cost - a.cost);
  return { modelMix, modelStats };
}

function extractText(content: ContentBlock["content"] | string | undefined): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(b => {
      if (b.type === "text") return b.text || "";
      if (b.type === "image") return "🖼 [image]";
      return "";
    }).join("\n");
  }
  return "";
}

function toolResultIsError(block: ContentBlock): boolean {
  // Prefer Anthropic's explicit is_error flag; fall back to a text heuristic
  // only for older records that didn't carry it (avoids over-flagging normal
  // output that merely starts with "error").
  if (typeof block.is_error === "boolean") return block.is_error;
  return extractText(block.content).toLowerCase().startsWith("error");
}

interface MergedAssistant {
  uuid: string;
  ts: string;
  model: string;
  effort: string;
  content: ContentBlock[];
  usage: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  stopReason?: string | null;
}

/** The effort a set of turns ran at: the most frequent value, since a session
 * can change effort mid-run and one badge has to stand for the whole agent. */
export function dominantEffort(messages: NormMsg[]): string {
  const counts = new Map<string, number>();
  for (const m of messages) {
    if (m.role !== "assistant" || !m.effort) continue;
    counts.set(m.effort, (counts.get(m.effort) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [effort, n] of counts) if (n > bestN) { best = effort; bestN = n; }
  return best;
}

function buildMergedAssistants(records: TraceRecord[]): Map<string, MergedAssistant> {
  const map = new Map<string, MergedAssistant>();
  for (const rec of records) {
    if (rec.type !== "assistant" || !rec.message?.id) continue;
    const id = rec.message.id;
    let entry = map.get(id);
    if (!entry) {
      entry = { uuid: rec.uuid || id, ts: rec.timestamp || "", model: rec.message.model || "", effort: rec.effort || "", content: [], usage: {}, stopReason: null };
      map.set(id, entry);
    }
    if (rec.message.model) entry.model = rec.message.model;
    if (rec.effort) entry.effort = rec.effort;
    if (rec.message.usage?.output_tokens != null) entry.usage = rec.message.usage;
    if (rec.message.stop_reason) entry.stopReason = rec.message.stop_reason;
    const content = rec.message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        const exists = entry.content.some(b =>
          b.type === block.type && (
            (b.type === "text" && block.type === "text" && b.text === block.text) ||
            (b.type === "tool_use" && block.type === "tool_use" && b.id === block.id) ||
            (b.type === "thinking" && block.type === "thinking" && b.signature === block.signature)
          )
        );
        if (!exists) entry.content.push(block);
      }
    }
  }
  return map;
}

function usageToNormalized(model: string, u: MergedAssistant["usage"]) {
  const input = u.input_tokens || 0;
  const output = u.output_tokens || 0;
  const cw = u.cache_creation_input_tokens || 0;
  const cr = u.cache_read_input_tokens || 0;
  return { input, output, cw, cr, cost: costFor(model, { input, output, cw, cr }) };
}

function blockify(content: ContentBlock[]): NormBlock[] {
  const out: NormBlock[] = [];
  for (const b of content) {
    if (b.type === "text" && b.text) out.push({ type: "text", text: b.text });
    // Claude Code strips thinking text from the JSONL (only the signature
    // survives), so empty thinking blocks carry no content — drop them.
    else if (b.type === "thinking" && b.thinking) out.push({ type: "thinking", thinking: b.thinking });
    else if (b.type === "tool_use") out.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
    else if (b.type === "image") out.push({ type: "image", source: b.source });
  }
  return out;
}

function findSkill(text: string): string | undefined {
  const m = text.match(/<command-name>([^<]+)<\/command-name>/);
  if (m) return m[1].replace(/^\//, "").trim();
  return undefined;
}

function normalizeRecords(records: TraceRecord[]): {
  messages: NormMsg[];
  toolResults: Record<string, NormToolResult>;
  toolCounts: Record<string, number>;
  toolUseMsgUuid: Record<string, string>;
  usage: { input: number; output: number; cw: number; cr: number; cost: number };
  modelsSeen: Set<string>;
  startedAt: string;
  endedAt: string;
  spawnByToolUseId: Record<string, { type: string; description: string; model?: string }>;
  workflowByToolUseId: Record<string, { runId: string; name: string; summary: string }>;
  peakContext: number;
} {
  const merged = buildMergedAssistants(records);
  const toolResults: Record<string, NormToolResult> = {};
  const toolCounts: Record<string, number> = {};
  const toolUseMsgUuid: Record<string, string> = {};
  const messages: NormMsg[] = [];
  const usage = EMPTY_USAGE();
  const modelsSeen = new Set<string>();
  let peakContext = 0;
  const spawnByToolUseId: Record<string, { type: string; description: string; model?: string }> = {};
  // The Workflow tool result carries the runId + transcript dir that ties the
  // launching tool_use to the subagents written under subagents/workflows/<runId>/.
  const workflowByToolUseId: Record<string, { runId: string; name: string; summary: string }> = {};

  let startedAt = "";
  let endedAt = "";

  const seenAsst = new Set<string>();

  for (const rec of records) {
    if (rec.timestamp) {
      if (!startedAt) startedAt = rec.timestamp;
      endedAt = rec.timestamp;
    }

    if (rec.type === "attachment" && rec.attachment) {
      messages.push({
        uuid: rec.uuid || `att-${messages.length}`,
        ts: rec.timestamp || "",
        role: "attachment",
        model: "",
        blocks: [{ type: "attachment", attachment: rec.attachment }],
        usage: EMPTY_USAGE(),
      });
      continue;
    }

    if (rec.type === "user") {
      const content = rec.message?.content;
      const blocks: ContentBlock[] = Array.isArray(content) ? content : [];
      let hasToolResult = false;
      let hasText = false;
      for (const b of blocks) {
        if (b.type === "tool_result" && b.tool_use_id) {
          toolResults[b.tool_use_id] = { content: b.content || "", is_error: toolResultIsError(b) };
          hasToolResult = true;
          // A Workflow launch carries its run metadata on the record's
          // toolUseResult; associate it with the launching tool_use id.
          const tur = rec.toolUseResult;
          if (tur && typeof tur === "object" && typeof tur.runId === "string") {
            workflowByToolUseId[b.tool_use_id] = {
              runId: tur.runId,
              name: tur.workflowName || "",
              summary: tur.summary || "",
            };
          }
        }
        if (b.type === "text" && b.text) hasText = true;
      }
      // skip pure tool-result user messages (they're folded into tool cards)
      if (hasToolResult && !hasText) continue;
      // skip agent-result wrappers
      if (rec.toolUseResult?.agentId) continue;

      const text = typeof content === "string" ? content : extractText(content);
      const userBlocks: NormBlock[] = [];
      if (typeof content === "string") {
        userBlocks.push({ type: "text", text: content });
      } else if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === "text" && b.text) userBlocks.push({ type: "text", text: b.text });
          else if (b.type === "image") userBlocks.push({ type: "image" });
        }
      }
      if (userBlocks.length === 0) continue;

      messages.push({
        uuid: rec.uuid || `${messages.length}`,
        ts: rec.timestamp || "",
        role: "user",
        model: "",
        blocks: userBlocks,
        usage: EMPTY_USAGE(),
        attributionSkill: findSkill(text),
      });
      continue;
    }

    if (rec.type === "assistant" && rec.message?.id) {
      const id = rec.message.id;
      if (seenAsst.has(id)) continue;
      seenAsst.add(id);
      const entry = merged.get(id);
      if (!entry) continue;
      if (entry.model) modelsSeen.add(entry.model);
      const u = usageToNormalized(entry.model, entry.usage);
      addUsage(usage, u);
      // Context = the prompt size sent to the model on this call (fresh input +
      // cache read + cache write). The peak is how full the window got.
      const ctx = u.input + u.cw + u.cr;
      if (ctx > peakContext) peakContext = ctx;

      for (const block of entry.content) {
        if (block.type === "tool_use" && block.name && block.id) {
          toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;
          if (block.name === "Agent" || block.name === "Task") {
            const inp = block.input || {};
            spawnByToolUseId[block.id] = { type: inp.subagent_type || "agent", description: inp.description || "", model: inp.model };
          }
        }
        if (block.type === "tool_use" && block.id) {
          toolUseMsgUuid[block.id] = rec.uuid || id;
        }
      }

      messages.push({
        uuid: rec.uuid || id,
        ts: entry.ts,
        role: "assistant",
        model: entry.model,
        blocks: blockify(entry.content),
        usage: u,
        stopReason: entry.stopReason,
        attributionSkill: undefined,
        effort: entry.effort,
      });
      continue;
    }
  }

  return { messages, toolResults, toolCounts, toolUseMsgUuid, usage, modelsSeen, startedAt, endedAt, spawnByToolUseId, workflowByToolUseId, peakContext };
}

// Render a workflow agent's structured journal result (an object the agent
// returned via StructuredOutput) into readable markdown for the Result tab.
function formatWorkflowResult(r: unknown): string {
  if (r == null) return "";
  if (typeof r === "string") return r;
  if (typeof r !== "object") return String(r);
  const obj = r as Record<string, unknown>;
  const lines: string[] = [];
  let summary = "";
  for (const [k, v] of Object.entries(obj)) {
    if (k === "summary" && typeof v === "string") { summary = v; continue; }
    if (v == null) continue;
    if (typeof v === "object") lines.push(`- **${k}:** \`${JSON.stringify(v)}\``);
    else lines.push(`- **${k}:** ${v}`);
  }
  return [lines.join("\n"), summary].filter(Boolean).join("\n\n");
}

function readMeta(meta: any): { agentType?: string; description?: string; prompt?: string; model?: string; effort?: string; toolUseId?: string } {
  if (!meta) return {};
  return {
    agentType: meta.agentType || meta.subagent_type,
    description: meta.description,
    prompt: meta.prompt,
    model: meta.model,
    effort: meta.effort,
    toolUseId: meta.toolUseId || meta.tool_use_id,
  };
}

export async function fetchNormalizedTrace(project: string, session: string, records: TraceRecord[]): Promise<NormTrace> {
  const mainNorm = normalizeRecords(records);
  const sessionInfo = records.find(r => r.type === "user" && r.cwd) || records[0];

  // detect agent ids referenced in the trace
  const agentIds = new Set<string>();
  const agentIdByToolUseId = new Map<string, string>();
  const workflowIdByAgentId = new Map<string, string>();
  for (const rec of records) {
    if (rec.type === "user" && rec.toolUseResult?.agentId) {
      agentIds.add(rec.toolUseResult.agentId);
      // sourceToolAssistantUUID points at the assistant turn; but we want tool_use_id
      // tool_use_id is what we have in spawnByToolUseId
    }
    if (rec.type === "progress" && rec.data?.agentId) agentIds.add(rec.data.agentId);
  }
  // Also list the subagents/ directory directly. While a subagent is running,
  // the main JSONL may not yet contain its agentId — but Claude Code writes
  // the meta + JSONL files immediately. Without this, the conversation can't
  // link the spawn card to its running subagent until the first progress
  // record lands in the main JSONL, leaving the card non-expandable.
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(project)}/sessions/${encodeURIComponent(session)}/agents`);
    if (r.ok) {
      const list = await r.json();
      if (Array.isArray(list)) {
        for (const a of list) {
          if (!a?.id) continue;
          agentIds.add(a.id);
          if (a.toolUseId) agentIdByToolUseId.set(a.toolUseId, a.id);
          if (a.workflowId) workflowIdByAgentId.set(a.id, a.workflowId);
        }
      }
    }
  } catch { /* ignore — fall back to records-only discovery */ }
  for (const rec of records) {
    if (rec.type === "user" && rec.message?.content) {
      const content = rec.message.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === "tool_result" && b.tool_use_id) {
            // look at the matching assistant; the source-tool-assistant gave the tool_use
            // we just need to associate by toolUseId
            const src = records.find(r => r.uuid === rec.sourceToolAssistantUUID);
            if (src?.message?.content && Array.isArray(src.message.content)) {
              for (const sb of src.message.content) {
                if (sb.type === "tool_use" && sb.id === b.tool_use_id && (sb.name === "Agent" || sb.name === "Task")) {
                  if (rec.toolUseResult?.agentId) agentIdByToolUseId.set(sb.id, rec.toolUseResult.agentId);
                }
              }
            }
          }
        }
      }
    }
  }

  // fetch each agent's trace
  const agents: NormAgent[] = [];
  // Map every Agent/Task spawn (by its tool_use id) to the agent that emitted
  // it — "" for the main agent. A subagent's meta.toolUseId points at the
  // spawn call inside its *parent's* transcript, so this lets us recover the
  // real parent for nested subagents. Seed with the main agent's own spawns.
  const spawnerByToolUseId = new Map<string, string>();
  for (const tuid of Object.keys(mainNorm.spawnByToolUseId)) spawnerByToolUseId.set(tuid, "");
  for (const aid of agentIds) {
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(project)}/sessions/${encodeURIComponent(session)}/agents/${encodeURIComponent(aid)}`);
      if (!r.ok) continue;
      const data = await r.json();
      const meta = readMeta(data?.meta);
      const aRecs: TraceRecord[] = data?.records || [];
      const aNorm = normalizeRecords(aRecs);
      // Record the Agent/Task spawns this subagent made so its children can
      // resolve their parent back to this agent.
      for (const tuid of Object.keys(aNorm.spawnByToolUseId)) spawnerByToolUseId.set(tuid, aid);
      const workflowId = data?.workflowId || workflowIdByAgentId.get(aid) || undefined;
      const toolUseId = meta.toolUseId || [...agentIdByToolUseId.entries()].find(([, v]) => v === aid)?.[0] || "";
      // skip the first user message (the prompt) — it's the agent prompt
      const messages = aNorm.messages.length > 0 && aNorm.messages[0].role === "user" ? aNorm.messages.slice(1) : aNorm.messages;
      const result = data?.result || formatWorkflowResult(data?.workflowResult) || "";
      const promptText = meta.prompt || (aNorm.messages[0]?.role === "user" ? (aNorm.messages[0].blocks.find(b => b.type === "text")?.text || "") : "");
      const modelStr = meta.model || messages.find(m => m.role === "assistant")?.model || [...aNorm.modelsSeen][0] || "";
      const start = aNorm.startedAt;
      const end = aNorm.endedAt;
      const durationMs = start && end ? new Date(end).getTime() - new Date(start).getTime() : 0;
      // last assistant text → result fallback
      const lastAssistTxt = (() => {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "assistant") {
            const t = messages[i].blocks.find(b => b.type === "text")?.text;
            if (t) return t;
          }
        }
        return "";
      })();
      agents.push({
        id: aid,
        toolUseId,
        agentType: meta.agentType || data?.agentType || "agent",
        description: meta.description || "",
        model: modelStr,
        effort: meta.effort || dominantEffort(messages),
        prompt: promptText,
        startedAt: start,
        endedAt: end,
        durationMs,
        // injected-context rows aren't conversation turns; keep the stat honest
        msgCount: messages.filter(m => m.role !== "attachment").length,
        messages,
        toolResults: aNorm.toolResults,
        toolCounts: aNorm.toolCounts,
        toolUseMsgUuid: aNorm.toolUseMsgUuid,
        peakContext: aNorm.peakContext,
        usage: aNorm.usage,
        result: result || lastAssistTxt,
        persona: data?.persona || null,
        workflowId,
      });
    } catch {
      /* ignore */
    }
  }

  // Resolve each agent's parent now that every agent's spawns are known.
  for (const a of agents) a.parentId = a.toolUseId ? (spawnerByToolUseId.get(a.toolUseId) ?? "") : "";

  // Assemble workflow runs: one per Workflow tool call that we found a run id
  // for, listing the subagents it spawned. Agents are matched by workflowId.
  const workflows: NormWorkflow[] = [];
  for (const [toolUseId, info] of Object.entries(mainNorm.workflowByToolUseId)) {
    const runAgents = agents.filter(a => a.workflowId === info.runId);
    workflows.push({
      runId: info.runId,
      toolUseId,
      name: info.name,
      summary: info.summary,
      agentIds: runAgents.map(a => a.id),
    });
  }

  // compute totals
  const allTotals = EMPTY_USAGE();
  addUsage(allTotals, mainNorm.usage);
  for (const a of agents) addUsage(allTotals, a.usage);

  const { modelMix, modelStats } = buildModelStats([mainNorm.messages, ...agents.map(a => a.messages)]);

  const toolFreq: Record<string, number> = {};
  for (const [k, v] of Object.entries(mainNorm.toolCounts)) toolFreq[k] = (toolFreq[k] || 0) + v;
  for (const a of agents) for (const [k, v] of Object.entries(a.toolCounts)) toolFreq[k] = (toolFreq[k] || 0) + v;

  const ctx = allTotals.input + allTotals.cw + allTotals.cr;
  const cacheRatio = ctx > 0 ? allTotals.cr / ctx : 0;

  const startedAt = mainNorm.startedAt || (records[0]?.timestamp || "");
  let endedAt = mainNorm.endedAt;
  for (const a of agents) if (a.endedAt > endedAt) endedAt = a.endedAt;
  const durationMs = startedAt && endedAt ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : 0;
  const attributionSkill = (() => {
    for (const m of mainNorm.messages) if (m.attributionSkill) return m.attributionSkill;
    return "";
  })();

  return {
    session: {
      id: session || sessionInfo?.sessionId || "",
      project: sessionInfo?.cwd || project,
      attributionSkill,
      gitBranch: sessionInfo?.gitBranch || "",
      models: [...mainNorm.modelsSeen],
      effort: dominantEffort(mainNorm.messages),
      durationMs,
      startedAt,
      endedAt,
      provider: "claude",
    },
    main: {
      messages: mainNorm.messages,
      toolResults: mainNorm.toolResults,
      toolCounts: mainNorm.toolCounts,
      toolUseMsgUuid: mainNorm.toolUseMsgUuid,
      peakContext: mainNorm.peakContext,
      usage: mainNorm.usage,
    },
    agents,
    workflows,
    stats: { totals: allTotals, modelMix, toolFreq, cacheRatio, modelStats },
  };
}
