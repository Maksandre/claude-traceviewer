# Stats Insights Dashboard — Design

**Date:** 2026-06-11
**Status:** Approved (user: "ok")

## Problem

The Stats view shows aggregate numbers but few actionable insights, and nothing
is clickable. Specific gaps from user feedback:

1. Insights don't link anywhere — you can't jump from "this call rebuilt the
   cache" to the actual message.
2. The cache "context per call" bar chart is not self-explanatory (x-axis is
   call index, not time; no label explains what the bars mean).
3. The Model mix panel wastes horizontal space.
4. Traces contain large hidden insights — e.g. a session reading 1281m wall
   clock is mostly idle waiting, not working — that are never surfaced.

## Goal

Turn Stats into an interactive insights dashboard: surface the biggest hidden
facts (where time went, where friction happened), make every insight row link
to the exact transcript message, and make each insight's meaning crystal clear
with plain-language captions.

## Interactivity foundation

`App.tsx` passes a new `onOpenMessage(uuid: string)` callback into `StatsView`.
It calls the existing `selectTarget(uuid, null)` (permalink API) **and**
`setView("conversation")`. The existing ConversationView scroll-flash plumbing
(ref-gated per msg/block) then jumps to and highlights the message — no new
scroll logic needed. Agent tags continue to open the agent drawer via the
existing `onOpenAgent`.

Insight rows that link carry a `msgUuid` produced by the analysis modules.

## Analysis modules (pure, unit-tested)

### `cacheInsights.ts` (extend)
- `CacheRebuild` and `CacheCallPoint` gain `msgUuid: string` (the `NormMsg.uuid`
  of the call). `analyzeStream` already iterates `NormMsg` — thread the uuid in.

### `timeInsights.ts` (new) — "Where the time went"
- Walk the full chronological message stream (main only; subagents run inside
  main's wall clock). For each adjacent pair, classify the gap:
  - assistant → user gap = **waiting for user** (human think time)
  - user/assistant → assistant working spans = **agent working**
- Returns `{ workingMs, waitingMs, stalls: Stall[] }` where `Stall` =
  `{ fromTs, toTs, ms, msgUuid }` for the top-N (5) longest assistant→user
  waits, each linking to the assistant message that finished before the wait.
- Edge cases: single message → all zero; unparseable ts → skip the pair.

### `frictionInsights.ts` (new) — "Friction"
- Tool errors: scan `trace.main.toolResults` and each agent's `toolResults`
  for `is_error`, group by tool name, keep each failing call's `msgUuid` +
  tool name + a short snippet. (Tool-result errors are attached to the
  assistant message that requested the tool; thread that uuid through
  normalize so it's reachable — see Data wiring.)
- Interruptions: count assistant/user text blocks containing
  `[Request interrupted`.
- Returns `{ toolErrors: {tool, count, samples: {msgUuid, snippet}[]}[],
  interruptions: number, errorTotal }`.

## Data wiring (normalize.ts)

`frictionInsights` needs each tool error to map back to a message uuid. The
tool_result blocks live on the *next* user turn, but the failing *call* is the
assistant tool_use. Add a lookup: when normalizing, record
`toolResultMsgUuid: Record<tool_use_id, assistantMsgUuid>` on main and each
agent (the assistant message that emitted the tool_use). `frictionInsights`
joins error tool_results → tool_use_id → assistant uuid. If the design proves
to need more than a thin map, the analyzer can fall back to linking the user
turn that carried the result. Keep the map minimal.

## UI (StatsView panels)

Grid (2-col, span-2 where noted), top to bottom:

1. **bigstats** — unchanged.
2. **Prompt caching** (col 1) — keep chips + events + advice. Replace the bar
   chart with **`ContextTimeline`**: an SVG area/line of main-agent context
   size (read+written+fresh) on a **time x-axis**. Idle gaps > 5 min are
   compressed to fixed-width break markers labeled `⏸ <dur> idle`. Red dots
   mark rebuild calls; click a dot or an event row → `onOpenMessage`. Caption:
   "Claude re-reads the whole conversation each call — this line is how big that
   re-read is; drops mean the cache broke and was rebuilt."
3. **Cost & models** (col 2, top) — replaces Model mix. Compact table: one row
   per model `name · tokens · cost · %bar`. No oversized empty bar.
4. **Friction** (col 2, bottom) — tool errors grouped by tool (each sample
   row links), interruption count. Empty state: "clean run — no errors or
   interruptions".
5. **Where the time went** (span 2) — a split bar (working vs waiting) with
   labeled durations, then the top 5 longest stalls as clickable rows
   (`time · waited <dur> · → jump`). Caption explains "waiting = time between
   Claude finishing and your next message".
6. **Tool usage frequency** — unchanged.
7. **Agents** (gantt) — unchanged.

## Components

- `src/lib/timeInsights.ts`, `src/lib/frictionInsights.ts` — pure analyzers,
  each unit-tested with fabricated NormTrace fixtures.
- `cacheInsights.ts` — extended (msgUuid) with a new test.
- `StatsView.tsx` — new `ContextTimeline`, `CostModels`, `FrictionPanel`,
  `TimeSpentPanel` components; `CachePanel` updated to link events; `ModelMix`
  removed. CSS in App.css following existing idioms; mobile-friendly.

## Out of scope

- Mining bug lists from agent result text (results are frequently empty in the
  records — unreliable). Workflow sessions benefit from the linking + time +
  friction panels instead.
- Cross-session analytics; byte-level prefix diffing.
