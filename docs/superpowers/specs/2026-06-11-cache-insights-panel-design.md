# Cache Insights Panel — Design

**Date:** 2026-06-11
**Status:** Approved (user: "ok")

## Problem

The Stats view's "Cache efficiency" panel shows a cache-hit donut that reads 97–99% on
virtually every session. It tells the user nothing actionable: no indication of what
cache rebuilds cost, when they happened, why, or what to change in their workflow.

## Goal

Replace the panel with a "Prompt caching" panel that surfaces the avoidable waste:
which API calls re-wrote the cache, why, what it cost in dollars, and what behavior
change would avoid it.

## Background: how Anthropic prompt caching prices a session

- Cache is a **prefix match**; any byte change in the prefix invalidates everything after it.
- Default TTL is **5 minutes**; an idle gap longer than that forces a full re-write.
- Caches are **model-scoped**: switching models mid-session rebuilds from scratch.
- Pricing relative to base input price: cache **read ≈ 0.1×**, cache **write ≈ 1.25×**
  (5-min TTL). Tokens that would have been reads but became writes cost ~1.15× extra.
- Per-call `usage` fields: `input_tokens` (uncached), `cache_creation_input_tokens` (cw),
  `cache_read_input_tokens` (cr). Total context = input + cw + cr.

## Data source

Already present in `NormTrace` (src/lib/normalize.ts): every assistant message carries
`usage {input, output, cw, cr, cost}`, `ts`, and `model`, for the main agent and each
subagent. No server changes required; all analysis is client-side.

## Detection algorithm

Per agent stream (main + each subagent), over consecutive assistant API calls:

- `ctx[i-1] = input + cw + cr` of the previous call.
- **Rebuild event** at call i when `cr[i] < 0.5 × (cr[i-1] + cw[i-1])` AND `cw[i] > 4096`
  (minimum cacheable prefix) AND i > 0 (first call of an agent is a normal cold start).
- **Re-written tokens** = `min(cw[i], ctx[i-1])`.
- **Cause classification** (first match wins):
  1. `ts[i] − ts[i-1] > 5 min` → `idle` (TTL expiry)
  2. `model[i] ≠ model[i-1]` → `model-switch`
  3. otherwise → `prefix-change` (system prompt / tool set edited)
- **Wasted $** per event = re-written tokens × input-price(model) × 1.15.
- **Saved $** (panel-level) = Σ cr × input-price × 0.9 across all calls.

Events from subagents are tagged with the agent type. Pricing comes from the existing
`costFor`/pricing.json infrastructure.

## UI (StatsView panel, replaces "Cache efficiency")

1. **Headline chips:** Saved by cache ($), Lost to rebuilds ($, warn-colored when > 0),
   Rebuilds (count + cause breakdown), small demoted hit-rate stat in the panel sub.
2. **Context-per-call chart:** one thin bar per API call across session time; blue
   portion = cache read, red portion = re-written. Caption: "context per call — red
   means the cache broke and was re-written at 1.25× price".
3. **Rebuild events list:** `time · cause → explanation · Nk re-written · +$X`,
   tagged with agent name when from a subagent. Sorted by time.
4. **Advice footer:** one sentence generated from the dominant cause
   (idle / model-switch / prefix-change), with the concrete behavior change.
5. **Empty state:** sessions with no rebuilds show the savings chips and
   "no avoidable cache waste in this session".

## Components

- `src/lib/cacheInsights.ts` — pure function `analyzeCache(trace: NormTrace): CacheInsights`
  returning `{savedUsd, wastedUsd, events[], series[], hitRate}`. Unit-testable in isolation.
- `CachePanel` in `StatsView.tsx` consuming it; CSS in App.css following existing
  panel/chip/bar idioms. Mobile-friendly (chips wrap; chart bars scale; list scrolls).

## Out of scope

- Cross-session aggregation; 1-hour-TTL detection (records don't carry TTL info);
  byte-level prefix diffing (records don't carry the rendered prompt).
