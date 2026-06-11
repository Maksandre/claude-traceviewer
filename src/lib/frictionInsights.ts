import type { NormAgent, NormMsg, NormToolResult, NormTrace } from "./normalize";

/* Surfaces the rough edges of a run: tool calls that errored (grouped by tool,
   each linked to the assistant message that made the call) and points where
   the user interrupted the agent. Tool name is recovered from the requesting
   assistant's tool_use block; when unavailable it falls back to "tool". */

export interface ToolErrorSample { msgUuid: string; snippet: string; }
export interface ToolErrorGroup { tool: string; count: number; samples: ToolErrorSample[]; }
export interface FrictionInsights {
  toolErrors: ToolErrorGroup[];
  interruptions: number;
  errorTotal: number;
}

const MAX_SAMPLES = 4;
const INTERRUPT = "[Request interrupted";

function resultText(c: string | unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(b => (b && typeof b === "object" && "text" in b ? String((b as { text?: string }).text ?? "") : "")).join(" ");
  return "";
}

function toolNameFor(toolUseId: string, msgs: NormMsg[]): string {
  for (const m of msgs) {
    for (const b of m.blocks) {
      if (b.type === "tool_use" && b.id === toolUseId && b.name) return b.name;
    }
  }
  return "tool";
}

function scanStream(
  msgs: NormMsg[],
  toolResults: Record<string, NormToolResult>,
  toolUseMsgUuid: Record<string, string>,
  groups: Map<string, ToolErrorGroup>,
  ins: FrictionInsights,
): void {
  for (const m of msgs) {
    for (const b of m.blocks) {
      if (b.type === "text" && b.text && b.text.includes(INTERRUPT)) ins.interruptions++;
    }
  }
  for (const [tuId, res] of Object.entries(toolResults)) {
    if (!res.is_error) continue;
    ins.errorTotal++;
    const tool = toolNameFor(tuId, msgs);
    const msgUuid = toolUseMsgUuid[tuId] || "";
    let g = groups.get(tool);
    if (!g) { g = { tool, count: 0, samples: [] }; groups.set(tool, g); }
    g.count++;
    if (g.samples.length < MAX_SAMPLES) {
      g.samples.push({ msgUuid, snippet: resultText(res.content).replace(/\s+/g, " ").trim().slice(0, 120) });
    }
  }
}

export function analyzeFriction(trace: NormTrace): FrictionInsights {
  const ins: FrictionInsights = { toolErrors: [], interruptions: 0, errorTotal: 0 };
  const groups = new Map<string, ToolErrorGroup>();
  scanStream(trace.main.messages, trace.main.toolResults, trace.main.toolUseMsgUuid, groups, ins);
  for (const a of trace.agents as NormAgent[]) {
    scanStream(a.messages, a.toolResults, a.toolUseMsgUuid, groups, ins);
  }
  ins.toolErrors = [...groups.values()].sort((x, y) => y.count - x.count);
  return ins;
}
