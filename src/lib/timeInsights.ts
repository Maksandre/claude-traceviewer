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

export type SpanKind = "working" | "waiting" | "away";

/* One stretch of the session in chronological order. Consecutive gaps of the
   same kind are coalesced into a single span (a "work burst", a pause, …).
   `msgUuid` links to the message at the span's start so the strip can jump. */
export interface TimeSegment {
  kind: SpanKind;
  ms: number;
  startTs: string;
  msgUuid: string;
}

export interface TimeInsights {
  workingMs: number;
  waitingMs: number;
  awayMs: number;
  stalls: Stall[];
  segments: TimeSegment[];
  startTs: string;
  endTs: string;
}

const MAX_STALLS = 5;
// A response gap longer than this means you stepped away (or it was overnight),
// not that you were actively composing a reply.
const AWAY_MS = 30 * 60_000;

function t(ms: string): number { return new Date(ms).getTime(); }

export function analyzeTime(trace: NormTrace): TimeInsights {
  const msgs = trace.main.messages;
  const ins: TimeInsights = {
    workingMs: 0, waitingMs: 0, awayMs: 0, stalls: [], segments: [],
    startTs: msgs[0]?.ts || "", endTs: msgs[msgs.length - 1]?.ts || "",
  };
  for (let i = 1; i < msgs.length; i++) {
    const prev = msgs[i - 1], cur = msgs[i];
    const a = t(prev.ts), b = t(cur.ts);
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) continue;
    const gap = b - a;
    const isWait = prev.role === "assistant" && cur.role === "user";
    const kind: SpanKind = isWait ? (gap > AWAY_MS ? "away" : "waiting") : "working";
    if (kind === "away") ins.awayMs += gap;
    else if (kind === "waiting") ins.waitingMs += gap;
    else ins.workingMs += gap;
    if (isWait) ins.stalls.push({ fromTs: prev.ts, toTs: cur.ts, ms: gap, msgUuid: prev.uuid });
    const last = ins.segments[ins.segments.length - 1];
    if (last && last.kind === kind) last.ms += gap;
    else ins.segments.push({ kind, ms: gap, startTs: prev.ts, msgUuid: prev.uuid });
  }
  ins.stalls.sort((x, y) => y.ms - x.ms);
  ins.stalls = ins.stalls.slice(0, MAX_STALLS);
  return ins;
}
