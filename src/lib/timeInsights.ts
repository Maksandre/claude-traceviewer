import type { NormTrace } from "./normalize";

/* Splits a session's wall clock into time the agent spent working vs time it
   spent waiting for the user. The gap after an assistant message and before
   the next user message is human think time ("waiting"); every other adjacent
   gap is the agent producing output ("working"). The longest waits are the
   stalls worth surfacing — each links to the assistant message that finished
   just before the user went quiet. */

export interface Stall {
  fromTs: string;
  toTs: string;
  ms: number;
  msgUuid: string;   // assistant message that finished before the wait
}

export interface TimeInsights {
  workingMs: number;
  waitingMs: number;
  stalls: Stall[];
}

const MAX_STALLS = 5;

function t(ms: string): number { return new Date(ms).getTime(); }

export function analyzeTime(trace: NormTrace): TimeInsights {
  const msgs = trace.main.messages;
  const ins: TimeInsights = { workingMs: 0, waitingMs: 0, stalls: [] };
  for (let i = 1; i < msgs.length; i++) {
    const prev = msgs[i - 1], cur = msgs[i];
    const a = t(prev.ts), b = t(cur.ts);
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) continue;
    const gap = b - a;
    if (prev.role === "assistant" && cur.role === "user") {
      ins.waitingMs += gap;
      ins.stalls.push({ fromTs: prev.ts, toTs: cur.ts, ms: gap, msgUuid: prev.uuid });
    } else {
      ins.workingMs += gap;
    }
  }
  ins.stalls.sort((x, y) => y.ms - x.ms);
  ins.stalls = ins.stalls.slice(0, MAX_STALLS);
  return ins;
}
