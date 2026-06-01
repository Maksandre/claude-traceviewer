import type { ContentBlock, TraceRecord } from "../types";
import { costFor, modelFamily } from "./format";
import type { ModelFamily } from "./format";

export interface NormBlock {
  type: "text" | "thinking" | "tool_use" | "image";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
  source?: { type: string; media_type: string; data: string };
}

export interface NormMsg {
  uuid: string;
  ts: string;
  role: "user" | "assistant";
  model: string;
  blocks: NormBlock[];
  usage: { input: number; output: number; cw: number; cr: number; cost: number };
  stopReason?: string | null;
  attributionSkill?: string;
  onlyResults?: boolean;
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
  prompt: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  msgCount: number;
  messages: NormMsg[];
  toolResults: Record<string, NormToolResult>;
  toolCounts: Record<string, number>;
  usage: { input: number; output: number; cw: number; cr: number; cost: number };
  result: string;
}

export interface NormSession {
  project: string;
  attributionSkill: string;
  gitBranch: string;
  models: string[];
  durationMs: number;
  startedAt: string;
  endedAt: string;
}

export interface NormStats {
  totals: { input: number; output: number; cw: number; cr: number; cost: number };
  modelMix: Record<ModelFamily, number>;
  toolFreq: Record<string, number>;
  cacheRatio: number;
}

export interface NormTrace {
  session: NormSession;
  main: {
    messages: NormMsg[];
    toolResults: Record<string, NormToolResult>;
    toolCounts: Record<string, number>;
    usage: { input: number; output: number; cw: number; cr: number; cost: number };
  };
  agents: NormAgent[];
  stats: NormStats;
}

const EMPTY_USAGE = () => ({ input: 0, output: 0, cw: 0, cr: 0, cost: 0 });

function addUsage(a: { input: number; output: number; cw: number; cr: number; cost: number }, b: { input: number; output: number; cw: number; cr: number; cost: number }) {
  a.input += b.input; a.output += b.output; a.cw += b.cw; a.cr += b.cr; a.cost += b.cost;
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

function toolResultIsError(content: ContentBlock["content"] | string | undefined): boolean {
  const t = extractText(content);
  return t.includes("error") && t.toLowerCase().startsWith("error");
}

interface MergedAssistant {
  uuid: string;
  ts: string;
  model: string;
  content: ContentBlock[];
  usage: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  stopReason?: string | null;
}

function buildMergedAssistants(records: TraceRecord[]): Map<string, MergedAssistant> {
  const map = new Map<string, MergedAssistant>();
  for (const rec of records) {
    if (rec.type !== "assistant" || !rec.message?.id) continue;
    const id = rec.message.id;
    let entry = map.get(id);
    if (!entry) {
      entry = { uuid: rec.uuid || id, ts: rec.timestamp || "", model: rec.message.model || "", content: [], usage: {}, stopReason: null };
      map.set(id, entry);
    }
    if (rec.message.model) entry.model = rec.message.model;
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
  usage: { input: number; output: number; cw: number; cr: number; cost: number };
  modelsSeen: Set<string>;
  startedAt: string;
  endedAt: string;
  spawnByToolUseId: Record<string, { type: string; description: string; model?: string }>;
} {
  const merged = buildMergedAssistants(records);
  const toolResults: Record<string, NormToolResult> = {};
  const toolCounts: Record<string, number> = {};
  const messages: NormMsg[] = [];
  const usage = EMPTY_USAGE();
  const modelsSeen = new Set<string>();
  const spawnByToolUseId: Record<string, { type: string; description: string; model?: string }> = {};

  let startedAt = "";
  let endedAt = "";

  const seenAsst = new Set<string>();

  for (const rec of records) {
    if (rec.timestamp) {
      if (!startedAt) startedAt = rec.timestamp;
      endedAt = rec.timestamp;
    }

    if (rec.type === "user") {
      const content = rec.message?.content;
      const blocks: ContentBlock[] = Array.isArray(content) ? content : [];
      let hasToolResult = false;
      let hasText = false;
      for (const b of blocks) {
        if (b.type === "tool_result" && b.tool_use_id) {
          toolResults[b.tool_use_id] = { content: b.content || "", is_error: toolResultIsError(b.content) };
          hasToolResult = true;
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

      for (const block of entry.content) {
        if (block.type === "tool_use" && block.name && block.id) {
          toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;
          if (block.name === "Agent" || block.name === "Task") {
            const inp = block.input || {};
            spawnByToolUseId[block.id] = { type: inp.subagent_type || "agent", description: inp.description || "", model: inp.model };
          }
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
      });
      continue;
    }
  }

  return { messages, toolResults, toolCounts, usage, modelsSeen, startedAt, endedAt, spawnByToolUseId };
}

function readMeta(meta: any): { agentType?: string; description?: string; prompt?: string; model?: string; toolUseId?: string } {
  if (!meta) return {};
  return {
    agentType: meta.agentType || meta.subagent_type,
    description: meta.description,
    prompt: meta.prompt,
    model: meta.model,
    toolUseId: meta.toolUseId || meta.tool_use_id,
  };
}

export async function fetchNormalizedTrace(project: string, session: string, records: TraceRecord[]): Promise<NormTrace> {
  const mainNorm = normalizeRecords(records);
  const sessionInfo = records.find(r => r.type === "user" && r.cwd) || records[0];

  // detect agent ids referenced in the trace
  const agentIds = new Set<string>();
  const agentIdByToolUseId = new Map<string, string>();
  for (const rec of records) {
    if (rec.type === "user" && rec.toolUseResult?.agentId) {
      agentIds.add(rec.toolUseResult.agentId);
      // sourceToolAssistantUUID points at the assistant turn; but we want tool_use_id
      // tool_use_id is what we have in spawnByToolUseId
    }
    if (rec.type === "progress" && rec.data?.agentId) agentIds.add(rec.data.agentId);
  }
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
  for (const aid of agentIds) {
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(project)}/sessions/${encodeURIComponent(session)}/agents/${encodeURIComponent(aid)}`);
      if (!r.ok) continue;
      const data = await r.json();
      const meta = readMeta(data?.meta);
      const aRecs: TraceRecord[] = data?.records || [];
      const aNorm = normalizeRecords(aRecs);
      const toolUseId = meta.toolUseId || [...agentIdByToolUseId.entries()].find(([, v]) => v === aid)?.[0] || "";
      // skip the first user message (the prompt) — it's the agent prompt
      const messages = aNorm.messages.length > 0 && aNorm.messages[0].role === "user" ? aNorm.messages.slice(1) : aNorm.messages;
      const result = data?.result || "";
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
        prompt: promptText,
        startedAt: start,
        endedAt: end,
        durationMs,
        msgCount: messages.length,
        messages,
        toolResults: aNorm.toolResults,
        toolCounts: aNorm.toolCounts,
        usage: aNorm.usage,
        result: result || lastAssistTxt,
      });
    } catch {
      /* ignore */
    }
  }

  // compute totals
  const allTotals = EMPTY_USAGE();
  addUsage(allTotals, mainNorm.usage);
  for (const a of agents) addUsage(allTotals, a.usage);

  const modelMix: Record<ModelFamily, number> = { opus: 0, sonnet: 0, haiku: 0 };
  for (const m of mainNorm.messages) {
    if (m.role !== "assistant") continue;
    modelMix[modelFamily(m.model)] += m.usage.input + m.usage.output + m.usage.cw + m.usage.cr;
  }
  for (const a of agents) {
    for (const m of a.messages) {
      if (m.role !== "assistant") continue;
      modelMix[modelFamily(m.model)] += m.usage.input + m.usage.output + m.usage.cw + m.usage.cr;
    }
  }

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
      project: sessionInfo?.cwd || project,
      attributionSkill,
      gitBranch: sessionInfo?.gitBranch || "",
      models: [...mainNorm.modelsSeen],
      durationMs,
      startedAt,
      endedAt,
    },
    main: {
      messages: mainNorm.messages,
      toolResults: mainNorm.toolResults,
      toolCounts: mainNorm.toolCounts,
      usage: mainNorm.usage,
    },
    agents,
    stats: { totals: allTotals, modelMix, toolFreq, cacheRatio },
  };
}
