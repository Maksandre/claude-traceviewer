import type { NormMsg, NormTrace } from "./normalize";
import { cacheRates } from "./format";

/* Detects prompt-cache rebuilds from per-call usage. Anthropic's cache is a
   prefix match with a 5-minute TTL, priced ~1.25x input for writes and ~0.1x
   for reads. In a healthy agent loop each call reads the previous call's
   whole context from cache; a call whose reads collapse while its writes
   balloon re-wrote the prefix at the premium price. */

export type RebuildCause = "idle" | "model-switch" | "prefix-change";

export interface CacheRebuild {
  ts: string;
  agent: string;            // "main" or agentType
  cause: RebuildCause;
  gapMs: number;            // idle time before the call
  rebuiltTokens: number;    // previously-cached tokens re-written
  wastedUsd: number;        // premium paid vs reading them from cache
  fromModel: string;
  toModel: string;
  msgUuid: string;
}

export interface CacheCallPoint {
  ts: string;
  agent: string;
  read: number;             // cache_read tokens
  written: number;          // cache_creation tokens
  fresh: number;            // uncached input tokens
  rebuild: boolean;
  msgUuid: string;
}

export interface CacheInsights {
  savedUsd: number;         // vs running fully uncached
  wastedUsd: number;        // avoidable rebuild premium
  hitRate: number;
  events: CacheRebuild[];
  series: CacheCallPoint[];
  causeCounts: Record<RebuildCause, number>;
}

const TTL_MS = 5 * 60_000;
const MIN_CACHEABLE = 4096;   // minimum cacheable prefix — smaller writes can't be rebuilds
const READ_COLLAPSE = 0.5;    // reads below 50% of prev cached context = prefix broke

function isApiCall(m: NormMsg): boolean {
  const u = m.usage;
  return m.role === "assistant" && u.input + u.output + u.cw + u.cr > 0;
}

function analyzeStream(msgs: NormMsg[], agent: string, ins: CacheInsights): void {
  let prev: NormMsg | null = null;
  for (const m of msgs) {
    if (!isApiCall(m)) continue;
    const { input, cw, cr } = m.usage;
    const rates = cacheRates(m.model);
    ins.savedUsd += cr * (rates.input - rates.cr);
    let rebuild = false;
    if (prev) {
      const prevCached = prev.usage.cr + prev.usage.cw;
      if (cw > MIN_CACHEABLE && cr < prevCached * READ_COLLAPSE) {
        rebuild = true;
        const prevCtx = prev.usage.input + prev.usage.cw + prev.usage.cr;
        const rebuiltTokens = Math.min(cw, prevCtx);
        const tCurr = new Date(m.ts).getTime();
        const tPrev = new Date(prev.ts).getTime();
        const gapMs = Number.isNaN(tCurr) || Number.isNaN(tPrev) ? 0 : Math.max(0, tCurr - tPrev);
        // Precedence is intentional: a >TTL gap expires the cache regardless of
        // what else changed, so idle wins even when the model also switched.
        const cause: RebuildCause =
          gapMs > TTL_MS ? "idle"
          : prev.model && m.model && prev.model !== m.model ? "model-switch"
          : "prefix-change";
        const wastedUsd = rebuiltTokens * (rates.cw - rates.cr);
        ins.events.push({ ts: m.ts, agent, cause, gapMs, rebuiltTokens, wastedUsd, fromModel: prev.model, toModel: m.model, msgUuid: m.uuid });
        ins.wastedUsd += wastedUsd;
        ins.causeCounts[cause]++;
      }
    }
    ins.series.push({ ts: m.ts, agent, read: cr, written: cw, fresh: input, rebuild, msgUuid: m.uuid });
    prev = m;
  }
}

export function analyzeCache(trace: NormTrace): CacheInsights {
  const ins: CacheInsights = {
    savedUsd: 0, wastedUsd: 0, hitRate: trace.stats.cacheRatio,
    events: [], series: [],
    causeCounts: { idle: 0, "model-switch": 0, "prefix-change": 0 },
  };
  analyzeStream(trace.main.messages, "main", ins);
  for (const a of trace.agents) analyzeStream(a.messages, a.agentType, ins);
  ins.events.sort((a, b) => a.ts.localeCompare(b.ts));
  ins.series.sort((a, b) => a.ts.localeCompare(b.ts));
  return ins;
}
