# Stats Insights Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Stats view into an interactive insights dashboard where every insight links to the exact transcript message, with new "where the time went" and "friction" analyses and a self-explanatory cache timeline.

**Architecture:** Pure analyzer modules (`timeInsights.ts`, `frictionInsights.ts`, extended `cacheInsights.ts`) compute insights from `NormTrace`; `normalize.ts` gains a `tool_use_id → assistant-message-uuid` map and per-family cost so errors and models can be linked/priced; `StatsView` renders new panels and calls an `onOpenMessage(uuid)` callback wired in `App.tsx` to the existing permalink + view-switch plumbing.

**Tech Stack:** TypeScript, React 19, Vitest, existing pricing (`format.ts`) and permalink (`permalinkCtx.ts`) infrastructure.

**Spec:** `docs/superpowers/specs/2026-06-11-stats-insights-dashboard-design.md`

---

### Task 1: normalize.ts — tool_use→message map + per-family cost

The friction analyzer must link a failing tool result back to the assistant message that requested it; the Cost & models panel needs per-family cost. Both are cheap additions to `normalizeRecords` / the stats assembly.

**Files:**
- Modify: `src/lib/normalize.ts`
- Test: `src/lib/normalize.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fetchNormalizedTrace } from "./normalize";
import type { TraceRecord } from "../types";

// fetchNormalizedTrace calls fetch() for the agents list; stub it to empty so
// the test stays offline and exercises only the main-stream normalization.
const origFetch = globalThis.fetch;
function stubFetchEmpty() {
  globalThis.fetch = (async () => ({ ok: false, json: async () => [] })) as unknown as typeof fetch;
}
function restoreFetch() { globalThis.fetch = origFetch; }

const ASSIST: TraceRecord = {
  type: "assistant", uuid: "asst-1", timestamp: "2026-06-11T10:00:00Z",
  message: {
    id: "m1", model: "claude-opus-4-8",
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    content: [{ type: "tool_use", id: "tu-1", name: "Bash", input: { command: "ls" } }],
  },
} as unknown as TraceRecord;

// normalize derives is_error from the result TEXT (must contain lowercase
// "error" and, lowercased, start with "error"), NOT from any is_error field.
const TOOL_ERR: TraceRecord = {
  type: "user", uuid: "user-r", timestamp: "2026-06-11T10:00:05Z",
  message: { content: [{ type: "tool_result", tool_use_id: "tu-1", content: "error: command failed" }] },
} as unknown as TraceRecord;

describe("normalize: tool_use → message map + per-family cost", () => {
  it("maps tool_use_id to the assistant message uuid that emitted it", async () => {
    stubFetchEmpty();
    try {
      const t = await fetchNormalizedTrace("p", "s", [ASSIST, TOOL_ERR]);
      expect(t.main.toolUseMsgUuid["tu-1"]).toBe("asst-1");
      expect(t.main.toolResults["tu-1"].is_error).toBe(true);
    } finally { restoreFetch(); }
  });

  it("reports per-family token + cost in stats.modelStats", async () => {
    stubFetchEmpty();
    try {
      const t = await fetchNormalizedTrace("p", "s", [ASSIST]);
      const opus = t.stats.modelStats.find(m => m.family === "opus");
      expect(opus).toBeTruthy();
      expect(opus!.tokens).toBe(150);          // input+output (cw/cr 0)
      expect(opus!.cost).toBeGreaterThan(0);
    } finally { restoreFetch(); }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/normalize.test.ts`
Expected: FAIL — `toolUseMsgUuid` / `modelStats` undefined.

- [ ] **Step 3: Add `toolUseMsgUuid` to the main/agent shapes**

In `src/lib/normalize.ts`, the `NormTrace.main` inline type (around line 70) and `NormAgent` interface (around line 31) each have `toolResults` / `toolCounts`. Add to BOTH, right after `toolResults`:

```ts
  toolUseMsgUuid: Record<string, string>;
```

In `NormStats` (around line 61), add after `cacheRatio`:

```ts
  modelStats: { family: ModelFamily; tokens: number; cost: number }[];
```

- [ ] **Step 4: Populate the map in `normalizeRecords`**

In `normalizeRecords` (around line 168), declare alongside the other accumulators:

```ts
  const toolUseMsgUuid: Record<string, string> = {};
```

Inside the assistant branch, in the existing `for (const block of entry.content)` loop, where `block.type === "tool_use"` is handled, add (the assistant uuid is `rec.uuid || id`):

```ts
        if (block.type === "tool_use" && block.id) {
          toolUseMsgUuid[block.id] = rec.uuid || id;
        }
```

(place it next to the existing `toolCounts[block.name]` line; both can run — guard each on its own condition). Then add `toolUseMsgUuid` to the `return { ... }` object at the end of `normalizeRecords` (around line 272).

- [ ] **Step 5: Thread it into main and agents**

In `fetchNormalizedTrace`: the `main: { ... }` object (around line 436) — add `toolUseMsgUuid: mainNorm.toolUseMsgUuid,`. The `agents.push({ ... })` object (around line 369) — add `toolUseMsgUuid: aNorm.toolUseMsgUuid,`.

- [ ] **Step 6: Compute `modelStats`**

After the `modelMix` loops (around line 408), add:

```ts
  const modelStats = (Object.keys(modelMix) as ModelFamily[])
    .map(family => {
      let tokens = 0, cost = 0;
      const acc = (msgs: NormMsg[]) => {
        for (const m of msgs) {
          if (m.role !== "assistant" || modelFamily(m.model) !== family) continue;
          tokens += m.usage.input + m.usage.output + m.usage.cw + m.usage.cr;
          cost += m.usage.cost;
        }
      };
      acc(mainNorm.messages);
      for (const a of agents) acc(a.messages);
      return { family, tokens, cost };
    })
    .filter(m => m.tokens > 0)
    .sort((a, b) => b.cost - a.cost);
```

Add `modelStats` to the `stats: { ... }` object (around line 443).

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run src/lib/normalize.test.ts && npx tsc -b`
Expected: 2 passing, tsc clean. Also `npx vitest run` (full suite stays green).

- [ ] **Step 8: Commit**

```bash
git add src/lib/normalize.ts src/lib/normalize.test.ts
git commit -m "feat: tool_use→message map and per-family cost in normalize"
```

---

### Task 2: cacheInsights.ts — add msgUuid to events and series

So clicking a rebuild jumps to its message.

**Files:**
- Modify: `src/lib/cacheInsights.ts`
- Modify: `src/lib/cacheInsights.test.ts`

- [ ] **Step 1: Add a failing assertion**

In `src/lib/cacheInsights.test.ts`, inside the existing test `"idle gap > 5min with read collapse → idle rebuild"`, add after the existing assertions:

```ts
    expect(ins.events[0].msgUuid).toBe("u" + (30 + 12 * 60));   // uuid is "u"+atSec in the fixture
    expect(ins.series[2].msgUuid).toBe("u" + (30 + 12 * 60));
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/cacheInsights.test.ts`
Expected: FAIL — `msgUuid` undefined.

- [ ] **Step 3: Implement**

In `src/lib/cacheInsights.ts`:
- Add `msgUuid: string;` to both `CacheRebuild` and `CacheCallPoint` interfaces.
- In `analyzeStream`, the `ins.events.push({ ... })` call: add `msgUuid: m.uuid,`.
- The `ins.series.push({ ... })` call: add `msgUuid: m.uuid,`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/cacheInsights.test.ts && npx tsc -b`
Expected: all passing, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cacheInsights.ts src/lib/cacheInsights.test.ts
git commit -m "feat: link cache rebuilds and series points to their message"
```

---

### Task 3: timeInsights.ts — working vs waiting + longest stalls

**Files:**
- Create: `src/lib/timeInsights.ts`
- Test: `src/lib/timeInsights.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/timeInsights.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { analyzeTime } from "./timeInsights";
import type { NormMsg, NormTrace } from "./normalize";

const T0 = Date.parse("2026-06-11T10:00:00Z");
function msg(opts: { atSec: number; role: "user" | "assistant"; uuid?: string }): NormMsg {
  return {
    uuid: opts.uuid ?? "u" + opts.atSec,
    ts: new Date(T0 + opts.atSec * 1000).toISOString(),
    role: opts.role, model: opts.role === "assistant" ? "claude-opus-4-8" : "",
    blocks: [], usage: { input: 0, output: 0, cw: 0, cr: 0, cost: 0 }, stopReason: null,
  };
}
function trace(main: NormMsg[]): NormTrace {
  const u = { input: 0, output: 0, cw: 0, cr: 0, cost: 0 };
  return {
    session: { project: "", attributionSkill: "", gitBranch: "", models: [], durationMs: 0, startedAt: "", endedAt: "" },
    main: { messages: main, toolResults: {}, toolCounts: {}, usage: u, toolUseMsgUuid: {} },
    agents: [],
    stats: { totals: u, modelMix: { fable: 0, opus: 0, sonnet: 0, haiku: 0 }, toolFreq: {}, cacheRatio: 0, modelStats: [] },
  } as NormTrace;
}

describe("analyzeTime", () => {
  it("splits assistant→user gaps as waiting, the rest as working", () => {
    // user@0 → asst@10 (10s work) → user@70 (60s wait) → asst@80 (10s work)
    const ins = analyzeTime(trace([
      msg({ atSec: 0, role: "user" }),
      msg({ atSec: 10, role: "assistant" }),
      msg({ atSec: 70, role: "user" }),
      msg({ atSec: 80, role: "assistant" }),
    ]));
    expect(ins.waitingMs).toBe(60_000);
    expect(ins.workingMs).toBe(20_000);   // 0→10 and 70→80
  });

  it("returns the longest assistant→user stalls, linked to the assistant msg", () => {
    const ins = analyzeTime(trace([
      msg({ atSec: 0, role: "user" }),
      msg({ atSec: 5, role: "assistant", uuid: "a1" }),
      msg({ atSec: 5 + 3600, role: "user" }),      // 1h stall after a1
      msg({ atSec: 5 + 3601, role: "assistant", uuid: "a2" }),
      msg({ atSec: 5 + 3601 + 120, role: "user" }),// 2m stall after a2
    ]));
    expect(ins.stalls[0].msgUuid).toBe("a1");
    expect(ins.stalls[0].ms).toBe(3600_000);
    expect(ins.stalls.length).toBeLessThanOrEqual(5);
  });

  it("empty / single-message traces yield zeros", () => {
    expect(analyzeTime(trace([])).workingMs).toBe(0);
    expect(analyzeTime(trace([msg({ atSec: 0, role: "user" })])).stalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/timeInsights.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/lib/timeInsights.ts`:

```ts
import type { NormMsg, NormTrace } from "./normalize";

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
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/timeInsights.test.ts && npx tsc -b`
Expected: 3 passing, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeInsights.ts src/lib/timeInsights.test.ts
git commit -m "feat: working-vs-waiting time analysis with linked stalls"
```

---

### Task 4: frictionInsights.ts — tool errors + interruptions

**Files:**
- Create: `src/lib/frictionInsights.ts`
- Test: `src/lib/frictionInsights.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/frictionInsights.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { analyzeFriction } from "./frictionInsights";
import type { NormMsg, NormTrace } from "./normalize";

function asst(uuid: string, text?: string): NormMsg {
  return {
    uuid, ts: "2026-06-11T10:00:00Z", role: "assistant", model: "claude-opus-4-8",
    blocks: text ? [{ type: "text", text }] : [],
    usage: { input: 0, output: 0, cw: 0, cr: 0, cost: 0 }, stopReason: null,
  };
}
function trace(opts: {
  mainMsgs?: NormMsg[];
  mainResults?: Record<string, { content: string; is_error?: boolean }>;
  mainMap?: Record<string, string>;
  mainCounts?: Record<string, number>;
}): NormTrace {
  const u = { input: 0, output: 0, cw: 0, cr: 0, cost: 0 };
  return {
    session: { project: "", attributionSkill: "", gitBranch: "", models: [], durationMs: 0, startedAt: "", endedAt: "" },
    main: {
      messages: opts.mainMsgs ?? [],
      toolResults: opts.mainResults ?? {},
      toolCounts: opts.mainCounts ?? {},
      usage: u,
      toolUseMsgUuid: opts.mainMap ?? {},
    },
    agents: [],
    stats: { totals: u, modelMix: { fable: 0, opus: 0, sonnet: 0, haiku: 0 }, toolFreq: {}, cacheRatio: 0, modelStats: [] },
  } as NormTrace;
}

describe("analyzeFriction", () => {
  it("groups tool errors by tool with linked samples", () => {
    const ins = analyzeFriction(trace({
      mainMsgs: [asst("a1")],
      mainResults: { "tu-1": { content: "command failed: boom", is_error: true } },
      mainMap: { "tu-1": "a1" },
      mainCounts: { Bash: 1 },
    }));
    // tool name is resolved from the requesting assistant's tool_use via the map;
    // since the fixture has no tool_use blocks, the analyzer falls back to "tool".
    expect(ins.errorTotal).toBe(1);
    expect(ins.toolErrors[0].count).toBe(1);
    expect(ins.toolErrors[0].samples[0].msgUuid).toBe("a1");
    expect(ins.toolErrors[0].samples[0].snippet).toContain("boom");
  });

  it("counts interruptions from message text", () => {
    const ins = analyzeFriction(trace({
      mainMsgs: [asst("a1", "[Request interrupted by user]"), asst("a2", "normal")],
    }));
    expect(ins.interruptions).toBe(1);
  });

  it("clean run → zero everything", () => {
    const ins = analyzeFriction(trace({ mainMsgs: [asst("a1", "all good")] }));
    expect(ins.errorTotal).toBe(0);
    expect(ins.interruptions).toBe(0);
    expect(ins.toolErrors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/frictionInsights.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/lib/frictionInsights.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/frictionInsights.test.ts && npx tsc -b`
Expected: 3 passing, tsc clean. Note: the first test's fixture has no `tool_use` block, so `toolNameFor` returns `"tool"` — the assertion only checks count/sample, which is fine.

- [ ] **Step 5: Commit**

```bash
git add src/lib/frictionInsights.ts src/lib/frictionInsights.test.ts
git commit -m "feat: friction analysis — tool errors and interruptions"
```

---

### Task 5: App.tsx — onOpenMessage wiring + StatsView prop

Give StatsView a callback that deep-links to a message and switches to the Conversation view.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/StatsView.tsx` (signature only)

- [ ] **Step 1: Add the callback in App.tsx**

In `src/App.tsx`, after `selectTarget` is defined (around line 63-66), add:

```ts
  const openMessage = useCallback((uuid: string) => {
    selectTarget(uuid, null);
    setView("conversation");
  }, [selectTarget]);
```

- [ ] **Step 2: Pass it to StatsView**

Find the StatsView render (around line 350):

```tsx
            <div className="stats-scroll"><StatsView trace={trace} onOpenAgent={setDrawerId} /></div>
```

Change to:

```tsx
            <div className="stats-scroll"><StatsView trace={trace} onOpenAgent={setDrawerId} onOpenMessage={openMessage} /></div>
```

- [ ] **Step 3: Update StatsView's Props**

In `src/components/StatsView.tsx`, the `Props` interface (around line 6):

```ts
interface Props { trace: NormTrace; onOpenAgent: (id: string) => void; onOpenMessage: (uuid: string) => void; }
```

Destructure it in the `StatsView` function signature: `export function StatsView({ trace, onOpenAgent, onOpenMessage }: Props)`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b`
Expected: FAIL — `onOpenMessage` is declared but unused (TS6133) OR no error if your tsconfig allows unused params. If it errors, add a temporary `void onOpenMessage;` at the top of the function body; it will be consumed in Task 6-8. (Confirm with `npm run lint` that no NEW lint errors appear.)

Actually, to avoid churn: skip the temporary void and proceed directly — Task 6 consumes it in the same uncommitted working tree. Commit this task together with Task 6 if tsc blocks on unused. To keep commits clean, do:

- [ ] **Step 5: Commit (allowing the consumer to follow immediately)**

If `npx tsc -b` is clean, commit now:
```bash
git add src/App.tsx src/components/StatsView.tsx
git commit -m "feat: onOpenMessage callback wiring stats→conversation"
```
If tsc fails on unused param, DO NOT commit yet — proceed to Task 6 and commit both together with message `feat: onOpenMessage wiring + clickable cache timeline`.

---

### Task 6: ContextTimeline + clickable cache events

Replace the confusing bar chart with a time-axis line, and make rebuild events/dots jump to their message.

**Files:**
- Modify: `src/components/StatsView.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Add the ContextTimeline component**

In `src/components/StatsView.tsx`, add this component (near `CachePanel`). It draws an SVG polyline of context size over time, compressing idle gaps > 5 min into fixed slots, with clickable red rebuild dots:

```tsx
const IDLE_GAP_MS = 5 * 60_000;

function ContextTimeline({ ins, onOpenMessage }: { ins: CacheInsights; onOpenMessage: (uuid: string) => void }) {
  const pts = ins.series;
  if (pts.length < 2) return <div className="cachep-empty">not enough calls to chart</div>;
  // Build an x position per point: real elapsed time, but any gap over the idle
  // threshold is clamped to a fixed slot so one long pause doesn't flatten the rest.
  const times = pts.map(p => new Date(p.ts).getTime());
  const SLOT = 1; // compressed gap width in arbitrary x-units
  const xs: number[] = [0];
  const breaks: { x: number; ms: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const raw = Number.isNaN(times[i]) || Number.isNaN(times[i - 1]) ? 0 : times[i] - times[i - 1];
    if (raw > IDLE_GAP_MS) { breaks.push({ x: xs[i - 1] + SLOT / 2, ms: raw }); xs.push(xs[i - 1] + SLOT); }
    else xs.push(xs[i - 1] + Math.max(raw / 1000, 0.001)); // seconds as x-units
  }
  const maxX = xs[xs.length - 1] || 1;
  const ctx = pts.map(p => p.read + p.written + p.fresh);
  const maxY = Math.max(...ctx, 1);
  const W = 100, H = 40;
  const px = (x: number) => (x / maxX) * W;
  const py = (y: number) => H - (y / maxY) * H;
  const line = pts.map((p, i) => `${px(xs[i]).toFixed(2)},${py(ctx[i]).toFixed(2)}`).join(" ");
  const area = `0,${H} ${line} ${px(xs[xs.length - 1]).toFixed(2)},${H}`;
  return (
    <div className="ctl">
      <svg className="ctl-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Context size across ${pts.length} calls`}>
        <polygon className="ctl-area" points={area} />
        <polyline className="ctl-line" points={line} />
        {breaks.map((b, i) => <line key={"b" + i} className="ctl-break" x1={px(b.x)} x2={px(b.x)} y1={0} y2={H} />)}
        {pts.map((p, i) => p.rebuild ? (
          <circle key={i} className="ctl-dot" cx={px(xs[i])} cy={py(ctx[i])} r={1.4}
            onClick={() => onOpenMessage(p.msgUuid)}>
            <title>cache rebuilt here — click to open</title>
          </circle>
        ) : null)}
      </svg>
      <div className="ctl-breaks">
        {breaks.map((b, i) => <span key={i} className="ctl-break-lbl">⏸ {fmtDur(b.ms)} idle</span>)}
      </div>
      <div className="cachep-caption">Claude re-reads the whole conversation each call — this line is how big that re-read is; red dots are where the cache broke and was rebuilt (click to open).</div>
    </div>
  );
}
```

- [ ] **Step 2: Swap it into CachePanel and link events**

In `CachePanel`, the `useMemo` already computes `ins`. Replace the chart block (the `<div className="cachep-chart">…</div>` and its following `<div className="cachep-caption">…</div>`) with:

```tsx
      <ContextTimeline ins={ins} onOpenMessage={onOpenMessage} />
```

Make `CachePanel` accept the callback: change its signature to
`function CachePanel({ trace, onOpenMessage }: { trace: NormTrace; onOpenMessage: (uuid: string) => void })`
and update the call site `<CachePanel trace={trace} />` → `<CachePanel trace={trace} onOpenMessage={onOpenMessage} />`.

In the events list, make each row a button that opens the message. Change the `<div key={i} className="cachep-event">` to:

```tsx
            <button key={i} type="button" className="cachep-event cachep-event-btn" onClick={() => onOpenMessage(e.msgUuid)}>
```

and its closing `</div>` to `</button>`.

Remove the now-unused `maxCtx`, `display`, and `MAX_CHART_BARS` (the old bar chart's machinery) from `CachePanel`'s `useMemo` — keep only `{ ins, advice }`:

```tsx
  const { ins, advice } = useMemo(() => {
    const ins = analyzeCache(trace);
    return { ins, advice: adviceFor(ins) };
  }, [trace]);
```

- [ ] **Step 3: Add CSS**

In `src/App.css`, delete the old chart rules `.cachep-chart`, `.cachep-bar`, `.cachep-bar-w`, `.cachep-bar.is-rebuild` (and the `.is-rebuild .cachep-bar-w` rule). Add:

```css
.ctl { display: flex; flex-direction: column; gap: 6px; }
.ctl-svg { width: 100%; height: 64px; display: block; }
.ctl-area { fill: color-mix(in oklch, var(--sonnet) 18%, transparent); }
.ctl-line { fill: none; stroke: var(--sonnet); stroke-width: 0.6; vector-effect: non-scaling-stroke; }
.ctl-break { stroke: var(--tx-3); stroke-width: 0.4; stroke-dasharray: 1 1; vector-effect: non-scaling-stroke; }
.ctl-dot { fill: var(--err); cursor: pointer; }
.ctl-dot:hover { fill: var(--warn); }
.ctl-breaks { display: flex; flex-wrap: wrap; gap: 8px; }
.ctl-break-lbl { font-family: var(--ff-mono); font-size: 9.5px; color: var(--tx-3); }
.cachep-event-btn { border: none; background: transparent; width: 100%; text-align: left; font: inherit; cursor: pointer; color: inherit; }
.cachep-event-btn:hover { background: var(--bg-3); }
```

(Keep the existing `.cachep-event` grid rule; the button inherits it.)

- [ ] **Step 4: Typecheck, lint, test**

Run: `npx tsc -b && npm run lint && npx vitest run`
Expected: tsc clean, no NEW lint errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/StatsView.tsx src/App.css src/App.tsx
git commit -m "feat: time-axis context timeline + clickable cache events"
```

(Include App.tsx here if Task 5 was not committed separately.)

---

### Task 7: CostModels panel (replaces ModelMix) + FrictionPanel

**Files:**
- Modify: `src/components/StatsView.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Add imports**

In `src/components/StatsView.tsx` import block:

```ts
import { analyzeFriction } from "../lib/frictionInsights";
```

- [ ] **Step 2: Replace ModelMix with CostModels**

Delete the `ModelMix` component (around line 215-240) and add:

```tsx
function CostModels({ trace }: { trace: NormTrace }) {
  const rows = trace.stats.modelStats;
  const totalCost = rows.reduce((a, r) => a + r.cost, 0) || 1;
  if (rows.length === 0) return <div className="empty">no model data</div>;
  return (
    <div className="costmodels">
      {rows.map(r => (
        <div key={r.family} className="cm-row">
          <span className="cm-dot" style={{ background: `var(--${r.family})` }} />
          <span className="cm-name">{r.family[0].toUpperCase() + r.family.slice(1)}</span>
          <span className="cm-bar"><span className="cm-bar-fill" style={{ width: (r.cost / totalCost * 100) + "%", background: `var(--${r.family})` }} /></span>
          <span className="cm-tok tnum">{fmtTokens(r.tokens)}</span>
          <span className="cm-cost tnum">{fmtCost(r.cost)}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add the FrictionPanel component**

```tsx
function FrictionPanel({ trace, onOpenMessage }: { trace: NormTrace; onOpenMessage: (uuid: string) => void }) {
  const fr = useMemo(() => analyzeFriction(trace), [trace]);
  if (fr.errorTotal === 0 && fr.interruptions === 0) {
    return <div className="cachep-empty">clean run — no errors or interruptions</div>;
  }
  return (
    <div className="friction">
      <div className="friction-summary">
        <span className="friction-stat"><b className="tnum warn">{fr.errorTotal}</b> tool error{fr.errorTotal === 1 ? "" : "s"}</span>
        <span className="friction-stat"><b className="tnum">{fr.interruptions}</b> interruption{fr.interruptions === 1 ? "" : "s"}</span>
      </div>
      {fr.toolErrors.map(g => (
        <div key={g.tool} className="friction-group">
          <div className="friction-tool">{g.tool} <span className="friction-count tnum">×{g.count}</span></div>
          {g.samples.map((s, i) => (
            <button key={i} type="button" className="friction-sample" onClick={() => s.msgUuid && onOpenMessage(s.msgUuid)} disabled={!s.msgUuid}>
              {s.snippet || "(no message)"}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Wire both panels into the grid**

In the `StatsView` return, replace the `<Panel title="Model mix" …>…</Panel>` block with two stacked panels occupying the second column:

```tsx
        <Panel title="Cost & models" sub="by spend">
          <CostModels trace={trace} />
        </Panel>

        <Panel title="Friction" sub="errors & interruptions">
          <FrictionPanel trace={trace} onOpenMessage={onOpenMessage} />
        </Panel>
```

(They are two separate 1-column panels; in the 2-col `.stats-grid` they fill the right column across two rows alongside the taller Prompt caching panel on the left. If Prompt caching is shorter than the two stacked, that's fine — grid auto-flow handles it.)

- [ ] **Step 5: Add CSS**

In `src/App.css`, delete the old `.stackbar`, `.stackseg`, `.legend`, `.legend-item`, `.legend-dot`, `.legend-name`, `.legend-val`, `.legend-sub` rules ONLY IF grep shows they're not used elsewhere (run `grep -rn "stackbar\|legend-item" src/` first; if used by another component, leave them). Add:

```css
.costmodels { display: flex; flex-direction: column; gap: 8px; }
.cm-row { display: grid; grid-template-columns: 10px 64px 1fr auto auto; gap: 9px; align-items: center; }
.cm-dot { width: 8px; height: 8px; border-radius: 99px; }
.cm-name { font-size: 12.5px; color: var(--tx-1); }
.cm-bar { height: 6px; background: var(--bg-3); border-radius: 99px; overflow: hidden; }
.cm-bar-fill { display: block; height: 100%; border-radius: 99px; }
.cm-tok { font-family: var(--ff-mono); font-size: 11px; color: var(--tx-3); }
.cm-cost { font-family: var(--ff-mono); font-size: 12px; font-weight: 600; color: var(--tx-0); }

.friction { display: flex; flex-direction: column; gap: 10px; }
.friction-summary { display: flex; gap: 16px; font-size: 12px; color: var(--tx-2); }
.friction-stat b { color: var(--tx-0); margin-right: 4px; }
.friction-stat b.warn { color: var(--warn); }
.friction-group { display: flex; flex-direction: column; gap: 3px; }
.friction-tool { font-family: var(--ff-mono); font-size: 12px; color: var(--tx-1); }
.friction-count { color: var(--warn); }
.friction-sample { border: none; background: var(--bg-2); border-left: 2px solid var(--err); border-radius: var(--r-sm); text-align: left; font-family: var(--ff-mono); font-size: 11px; color: var(--tx-2); padding: 4px 8px; cursor: pointer; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.friction-sample:hover:not(:disabled) { background: var(--bg-3); color: var(--tx-0); }
.friction-sample:disabled { cursor: default; opacity: .7; }
```

- [ ] **Step 6: Typecheck, lint, test**

Run: `npx tsc -b && npm run lint && npx vitest run`
Expected: clean / no new lint errors / tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/StatsView.tsx src/App.css
git commit -m "feat: cost-by-model panel and friction panel"
```

---

### Task 8: TimeSpentPanel (span-2) + layout

**Files:**
- Modify: `src/components/StatsView.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Add imports**

```ts
import { analyzeTime } from "../lib/timeInsights";
```

- [ ] **Step 2: Add the TimeSpentPanel component**

```tsx
function TimeSpentPanel({ trace, onOpenMessage }: { trace: NormTrace; onOpenMessage: (uuid: string) => void }) {
  const ti = useMemo(() => analyzeTime(trace), [trace]);
  const total = ti.workingMs + ti.waitingMs || 1;
  const workPct = (ti.workingMs / total) * 100;
  return (
    <div className="timespent">
      <div className="ts-bar">
        <span className="ts-seg ts-work" style={{ width: workPct + "%" }} title={`working ${fmtDur(ti.workingMs)}`} />
        <span className="ts-seg ts-wait" style={{ width: (100 - workPct) + "%" }} title={`waiting ${fmtDur(ti.waitingMs)}`} />
      </div>
      <div className="ts-legend">
        <span><span className="ts-dot ts-work" /> agent working <b className="tnum">{fmtDur(ti.workingMs)}</b></span>
        <span><span className="ts-dot ts-wait" /> waiting on you <b className="tnum">{fmtDur(ti.waitingMs)}</b></span>
      </div>
      <div className="cachep-caption">“waiting on you” is the time between Claude finishing a turn and your next message — idle time, not work.</div>
      {ti.stalls.length ? (
        <div className="ts-stalls">
          {ti.stalls.map((s, i) => (
            <button key={i} type="button" className="ts-stall" onClick={() => onOpenMessage(s.msgUuid)}>
              <span className="ts-stall-dur tnum">{fmtDur(s.ms)}</span>
              <span className="ts-stall-lbl">paused after this turn → jump</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Insert into the grid**

In `StatsView`'s return, add a span-2 panel BETWEEN the Friction/Cost row and "Tool usage frequency":

```tsx
        <Panel title="Where the time went" span={2} sub="working vs waiting · click a stall to jump">
          <TimeSpentPanel trace={trace} onOpenMessage={onOpenMessage} />
        </Panel>
```

- [ ] **Step 4: Add CSS**

```css
.timespent { display: flex; flex-direction: column; gap: 10px; }
.ts-bar { display: flex; height: 22px; border-radius: var(--r-sm); overflow: hidden; background: var(--bg-3); }
.ts-seg { height: 100%; }
.ts-seg.ts-work { background: var(--tool-agent); }
.ts-seg.ts-wait { background: var(--bg-3); box-shadow: inset 0 0 0 1px var(--line-soft); }
.ts-legend { display: flex; gap: 20px; font-size: 12px; color: var(--tx-2); }
.ts-legend b { color: var(--tx-0); margin-left: 5px; }
.ts-dot { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.ts-dot.ts-work { background: var(--tool-agent); }
.ts-dot.ts-wait { background: var(--bg-3); box-shadow: inset 0 0 0 1px var(--line-soft); }
.ts-stalls { display: flex; flex-direction: column; gap: 3px; }
.ts-stall { display: flex; gap: 12px; align-items: baseline; border: none; background: var(--bg-2); border-radius: var(--r-sm); padding: 6px 10px; cursor: pointer; text-align: left; font: inherit; width: 100%; }
.ts-stall:hover { background: var(--bg-3); }
.ts-stall-dur { font-family: var(--ff-mono); font-weight: 600; color: var(--warn); min-width: 70px; }
.ts-stall-lbl { font-size: 12px; color: var(--tx-2); }
```

Confirm `var(--tool-agent)` exists (it's used by the Agents gantt). If not, substitute `var(--accent)`.

- [ ] **Step 5: Typecheck, lint, test**

Run: `npx tsc -b && npm run lint && npx vitest run`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/StatsView.tsx src/App.css
git commit -m "feat: where-the-time-went panel with linked stalls"
```

---

### Task 9: Docker + Playwright verification

**Files:** none (verification only)

- [ ] **Step 1: Build and deploy**

Run: `docker compose up -d --build`
Expected: tsc + vite build pass; container restarts on :3099.

- [ ] **Step 2: Verify the find-bugs session (desktop)**

Run:
```bash
playwright-cli open "http://localhost:3099/?project=-Users-maxclaw-Documents-projects-audits-2026-05-subtensor&session=adf911cd-b91e-4b7d-a63b-814ab36c0672&view=stats"
playwright-cli resize 1440 900
playwright-cli snapshot
```
Expected in snapshot: panels "Prompt caching" (with ctl-svg line, not bars), "Cost & models", "Friction", "Where the time went". Screenshot and confirm visually: the context line renders with idle-break markers, the cost rows fill the right column (no big empty bar), the time split shows working vs waiting.

- [ ] **Step 3: Verify a link actually navigates**

Click a cache rebuild event row (or a stall row), then snapshot. Expected: the view switches to Conversation and the target message is scrolled into view / flashed. Confirm the URL gained `?...&view=conversation&msg=<uuid>`.
```bash
# find a clickable row ref from the snapshot, then:
playwright-cli click <ref>
playwright-cli snapshot
```

- [ ] **Step 4: Verify the long-idle session from the screenshot**

If available, open the 1281m-wallclock session and confirm "Where the time went" shows the large waiting share and a multi-hour stall row; click it and confirm it lands on the right turn.

- [ ] **Step 5: Verify mobile (390×844)**

Run: `playwright-cli resize 390 844`, screenshot the stats view. Expected: panels stack one per row, the context line and time bar fit width, friction samples ellipsize, no horizontal overflow.

- [ ] **Step 6: Verify a clean / tiny session**

Open a short session; expect Friction to show "clean run", the timeline to show "not enough calls to chart" if < 2 calls, and no NaN/empty-render artifacts.

- [ ] **Step 7: Final suite + commit any fixups**

Run: `npx vitest run && npx tsc -b`
Expected: green.
```bash
git add -A && git commit -m "fix: stats dashboard polish from live verification"   # only if fixups were needed
```
