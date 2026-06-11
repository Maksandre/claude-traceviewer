import type { NormTrace } from "./normalize";

/* Splits a session's wall clock into three buckets. A gap after an assistant
   message and before the next user message is your response time; a short one
   is genuine "waiting on you" (think time), but a long one (over the away
   threshold) is the session sitting dormant — overnight, laptop closed, you
   stepped out — so it's counted as "away" rather than blamed on slow replies.
   Every other adjacent gap is the agent producing output ("working"); those
   are never reclassified, because a long one there is a real tool/subagent run.
   The longest assistant→user gaps are surfaced as stalls, each linked to the
   assistant message that finished just before the pause. */

export interface Stall {
  fromTs: string;
  toTs: string;
  ms: number;
  msgUuid: string;   // assistant message that finished before the wait
}

export interface TimeInsights {
  workingMs: number;
  waitingMs: number;
  awayMs: number;
  stalls: Stall[];
}

const MAX_STALLS = 5;
// A response gap longer than this means you stepped away (or it was overnight),
// not that you were actively composing a reply.
const AWAY_MS = 30 * 60_000;

function t(ms: string): number { return new Date(ms).getTime(); }

export function analyzeTime(trace: NormTrace): TimeInsights {
  const msgs = trace.main.messages;
  const ins: TimeInsights = { workingMs: 0, waitingMs: 0, awayMs: 0, stalls: [] };
  for (let i = 1; i < msgs.length; i++) {
    const prev = msgs[i - 1], cur = msgs[i];
    const a = t(prev.ts), b = t(cur.ts);
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) continue;
    const gap = b - a;
    if (prev.role === "assistant" && cur.role === "user") {
      if (gap > AWAY_MS) ins.awayMs += gap;
      else ins.waitingMs += gap;
      ins.stalls.push({ fromTs: prev.ts, toTs: cur.ts, ms: gap, msgUuid: prev.uuid });
    } else {
      ins.workingMs += gap;
    }
  }
  ins.stalls.sort((x, y) => y.ms - x.ms);
  ins.stalls = ins.stalls.slice(0, MAX_STALLS);
  return ins;
}
