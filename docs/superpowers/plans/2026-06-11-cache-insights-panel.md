# Cache Insights Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the useless cache-hit donut with a "Prompt caching" panel that shows rebuild events, their causes, and their dollar cost.

**Architecture:** A pure analysis module (`src/lib/cacheInsights.ts`) walks each agent's per-call `usage` series from the existing `NormTrace` and detects cache rebuilds; a `CachePanel` component in `StatsView.tsx` renders chips, a per-call bar chart, an event list, and generated advice. No server changes.

**Tech Stack:** TypeScript, React 19, Vitest (new dev dep — repo has no test runner yet), existing pricing infra in `src/lib/format.ts`.

**Spec:** `docs/superpowers/specs/2026-06-11-cache-insights-panel-design.md`

---

### Task 1: Vitest setup

**Files:**
- Modify: `package.json` (add `test` script + devDependency)

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`
Expected: added to `devDependencies`, lockfile updated.

- [ ] **Step 2: Add test script**

In `package.json` `"scripts"`, after `"lint"`:

```json
    "test": "vitest run",
```

- [ ] **Step 3: Verify the runner works (no tests yet)**

Run: `npx vitest run --passWithNoTests`
Expected: `No test files found` then exit 0.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest test runner"
```

---

### Task 2: `cacheRates` helper in format.ts

The analysis needs per-token rates (base input, cache write, cache read) — `costFor` only returns a total. Expose the rates via the existing `lookupRates`.

**Files:**
- Modify: `src/lib/format.ts` (after `costFor`, ~line 179)
- Test: `src/lib/format.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cacheRates } from "./format";

describe("cacheRates", () => {
  it("returns per-token input/write/read rates for a known family", () => {
    const r = cacheRates("claude-sonnet-4-6");
    expect(r.input).toBeGreaterThan(0);
    expect(r.cw).toBeGreaterThan(r.input);        // write premium
    expect(r.cr).toBeLessThan(r.input * 0.2);     // read discount
  });

  it("falls back for unknown models", () => {
    const r = cacheRates("totally-unknown-model");
    expect(r.input).toBeGreaterThan(0);
    expect(r.cw).toBeCloseTo(r.input * 1.25, 10);
    expect(r.cr).toBeCloseTo(r.input * 0.10, 10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/format.test.ts`
Expected: FAIL — `cacheRates` is not exported.

- [ ] **Step 3: Implement `cacheRates`**

In `src/lib/format.ts`, directly after the `costFor` function:

```ts
/** Per-token cache pricing for a model: base input rate, cache-write rate
 * (~1.25x input), cache-read rate (~0.1x input). Used by cacheInsights. */
export function cacheRates(model: string | undefined | null): { input: number; cw: number; cr: number } {
  const r = lookupRates(model);
  return {
    input: r.input_cost_per_token,
    cw: r.cache_creation_input_token_cost ?? r.input_cost_per_token * 1.25,
    cr: r.cache_read_input_token_cost ?? r.input_cost_per_token * 0.10,
  };
}
```

Note: the "unknown model" test passes because `lookupRates` falls back to a family entry; the family fallback table fills `cache_*` costs explicitly at 1.25×/0.10×, so the `??` branches are belt-and-suspenders.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/format.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat: expose per-token cache rates for cache analysis"
```

---

### Task 3: `analyzeCache` in src/lib/cacheInsights.ts

**Files:**
- Create: `src/lib/cacheInsights.ts`
- Test: `src/lib/cacheInsights.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/cacheInsights.test.ts`. The fixture builder fabricates a minimal `NormTrace`; only fields the analyzer touches need real values.

```ts
import { describe, expect, it } from "vitest";
import { analyzeCache } from "./cacheInsights";
import type { NormMsg, NormTrace } from "./normalize";

const T0 = Date.parse("2026-06-11T10:00:00Z");

function msg(opts: {
  atSec: number; input?: number; cw?: number; cr?: number; output?: number; model?: string; role?: "user" | "assistant";
}): NormMsg {
  return {
    uuid: "u" + opts.atSec,
    ts: new Date(T0 + opts.atSec * 1000).toISOString(),
    role: opts.role ?? "assistant",
    model: opts.model ?? "claude-sonnet-4-6",
    blocks: [],
    usage: { input: opts.input ?? 0, output: opts.output ?? 100, cw: opts.cw ?? 0, cr: opts.cr ?? 0, cost: 0 },
    stopReason: null,
  };
}

function trace(mainMsgs: NormMsg[], agents: { agentType: string; messages: NormMsg[] }[] = []): NormTrace {
  const u = { input: 0, output: 0, cw: 0, cr: 0, cost: 0 };
  return {
    session: { project: "", attributionSkill: "", gitBranch: "", models: [], durationMs: 0, startedAt: "", endedAt: "" },
    main: { messages: mainMsgs, toolResults: {}, toolCounts: {}, usage: u },
    agents: agents.map((a, i) => ({
      id: "a" + i, toolUseId: "t" + i, agentType: a.agentType, description: "", model: "",
      prompt: "", startedAt: "", endedAt: "", durationMs: 0, msgCount: a.messages.length,
      messages: a.messages, toolResults: {}, toolCounts: {}, usage: u, result: "", persona: null,
    })),
    stats: { totals: u, modelMix: { fable: 0, opus: 0, sonnet: 0, haiku: 0 }, toolFreq: {}, cacheRatio: 0.97 },
  } as NormTrace;
}

describe("analyzeCache", () => {
  it("healthy growing session: no rebuild events, positive savings", () => {
    const ins = analyzeCache(trace([
      msg({ atSec: 0, input: 5000, cw: 20000, cr: 0 }),         // cold start
      msg({ atSec: 30, input: 200, cw: 6000, cr: 25000 }),      // grows
      msg({ atSec: 60, input: 100, cw: 5000, cr: 31000 }),
    ]));
    expect(ins.events).toHaveLength(0);
    expect(ins.savedUsd).toBeGreaterThan(0);
    expect(ins.wastedUsd).toBe(0);
    expect(ins.series).toHaveLength(3);
  });

  it("idle gap > 5min with read collapse → idle rebuild", () => {
    const ins = analyzeCache(trace([
      msg({ atSec: 0, input: 5000, cw: 100000, cr: 0 }),
      msg({ atSec: 30, input: 200, cw: 6000, cr: 105000 }),
      msg({ atSec: 30 + 12 * 60, input: 200, cw: 111000, cr: 0 }),  // 12m later, full re-write
    ]));
    expect(ins.events).toHaveLength(1);
    expect(ins.events[0].cause).toBe("idle");
    expect(ins.events[0].gapMs).toBeGreaterThan(5 * 60_000);
    expect(ins.events[0].rebuiltTokens).toBe(111000); // min(cw, prev ctx 111200) = 111000
    expect(ins.wastedUsd).toBeGreaterThan(0);
    expect(ins.causeCounts.idle).toBe(1);
  });

  it("model switch without a gap → model-switch rebuild", () => {
    const ins = analyzeCache(trace([
      msg({ atSec: 0, input: 5000, cw: 100000, cr: 0, model: "claude-sonnet-4-6" }),
      msg({ atSec: 30, input: 200, cw: 105000, cr: 0, model: "claude-opus-4-6" }),
    ]));
    expect(ins.events).toHaveLength(1);
    expect(ins.events[0].cause).toBe("model-switch");
  });

  it("same model, no gap → prefix-change rebuild", () => {
    const ins = analyzeCache(trace([
      msg({ atSec: 0, input: 5000, cw: 100000, cr: 0 }),
      msg({ atSec: 30, input: 200, cw: 105000, cr: 1000 }),
    ]));
    expect(ins.events).toHaveLength(1);
    expect(ins.events[0].cause).toBe("prefix-change");
  });

  it("small writes (< 4096) never count as rebuilds", () => {
    const ins = analyzeCache(trace([
      msg({ atSec: 0, input: 5000, cw: 100000, cr: 0 }),
      msg({ atSec: 30, input: 200, cw: 4000, cr: 1000 }),
    ]));
    expect(ins.events).toHaveLength(0);
  });

  it("subagent streams analyzed independently and tagged", () => {
    const ins = analyzeCache(trace(
      [msg({ atSec: 0, input: 5000, cw: 20000, cr: 0 })],
      [{ agentType: "bug-finder", messages: [
        msg({ atSec: 10, input: 5000, cw: 100000, cr: 0 }),
        msg({ atSec: 10 + 600, input: 200, cw: 105000, cr: 0 }),
      ]}],
    ));
    expect(ins.events).toHaveLength(1);
    expect(ins.events[0].agent).toBe("bug-finder");
  });

  it("user messages and zero-usage entries are skipped", () => {
    const ins = analyzeCache(trace([
      msg({ atSec: 0, role: "user", output: 0 }),
      msg({ atSec: 1, input: 5000, cw: 20000, cr: 0 }),
    ]));
    expect(ins.series).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/cacheInsights.test.ts`
Expected: FAIL — module `./cacheInsights` does not exist.

- [ ] **Step 3: Implement the module**

Create `src/lib/cacheInsights.ts`:

```ts
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
}

export interface CacheCallPoint {
  ts: string;
  agent: string;
  read: number;             // cache_read tokens
  written: number;          // cache_creation tokens
  fresh: number;            // uncached input tokens
  rebuild: boolean;
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
        const gapMs = Math.max(0, new Date(m.ts).getTime() - new Date(prev.ts).getTime());
        const cause: RebuildCause =
          gapMs > TTL_MS ? "idle"
          : prev.model && m.model && prev.model !== m.model ? "model-switch"
          : "prefix-change";
        const wastedUsd = rebuiltTokens * (rates.cw - rates.cr);
        ins.events.push({ ts: m.ts, agent, cause, gapMs, rebuiltTokens, wastedUsd, fromModel: prev.model, toModel: m.model });
        ins.wastedUsd += wastedUsd;
        ins.causeCounts[cause]++;
      }
    }
    ins.series.push({ ts: m.ts, agent, read: cr, written: cw, fresh: input, rebuild });
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/cacheInsights.test.ts`
Expected: PASS (7 tests). Also run `npx vitest run` — full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cacheInsights.ts src/lib/cacheInsights.test.ts
git commit -m "feat: cache rebuild analysis from per-call usage"
```

---

### Task 4: CachePanel UI replacing the donut

**Files:**
- Modify: `src/components/StatsView.tsx` — replace the `Cache efficiency` panel JSX and the `Donut` component with `CachePanel`
- Modify: `src/App.css` — replace `.cache-row`/`.donut*`/`.cl-*` rules with `.cachep*` rules; drop the mobile `.cache-row` overrides

- [ ] **Step 1: Add imports to StatsView.tsx**

In the import block of `src/components/StatsView.tsx`:

```ts
import { analyzeCache } from "../lib/cacheInsights";
import type { CacheInsights, CacheRebuild } from "../lib/cacheInsights";
```

(`fmtCost`, `fmtDur`, `fmtTokensShort`, `modelLabel` are already imported.)

- [ ] **Step 2: Delete the `Donut` component (StatsView.tsx ~line 92-109) and add `CachePanel`**

Replace the whole `Donut` function with:

```tsx
function causeLabel(e: CacheRebuild): string {
  if (e.cause === "idle") return `idle ${fmtDur(e.gapMs)} → cache expired (5-min TTL)`;
  if (e.cause === "model-switch") return `model switch ${modelLabel(e.fromModel)} → ${modelLabel(e.toModel)}`;
  return "prefix changed (system prompt/tools)";
}

function adviceFor(ins: CacheInsights): string | null {
  const n = ins.events.length;
  if (!n) return null;
  const { idle, "model-switch": ms, "prefix-change": px } = ins.causeCounts;
  if (idle >= ms && idle >= px) {
    return `${idle} of ${n} rebuilds were idle gaps over 5 min — the cache lives 5 minutes; replying within that window (or batching prompts up front) avoids the 1.25× re-write.`;
  }
  if (ms >= px) {
    return `${ms} of ${n} rebuilds came from model switches — caches are per-model, so keeping one model per session avoids full re-writes.`;
  }
  return `${px} of ${n} rebuilds came from prefix changes — the system prompt or tool set changed mid-session; keeping them stable preserves the cache.`;
}

function CachePanel({ trace }: { trace: NormTrace }) {
  const ins = useMemo(() => analyzeCache(trace), [trace]);
  const maxCtx = Math.max(...ins.series.map(p => p.read + p.written + p.fresh), 1);
  const advice = adviceFor(ins);
  return (
    <div className="cachep">
      <div className="cachep-chips">
        <div className="cachep-chip">
          <span className="cachep-k">saved by cache</span>
          <b className="cachep-v ok tnum">{fmtCost(ins.savedUsd)}</b>
        </div>
        <div className="cachep-chip">
          <span className="cachep-k">lost to rebuilds</span>
          <b className={"cachep-v tnum " + (ins.wastedUsd >= 0.01 ? "warn" : "")}>{fmtCost(ins.wastedUsd)}</b>
        </div>
        <div className="cachep-chip">
          <span className="cachep-k">rebuilds</span>
          <b className="cachep-v tnum">{ins.events.length}</b>
          {ins.events.length ? (
            <span className="cachep-causes">
              {ins.causeCounts.idle ? `${ins.causeCounts.idle} idle` : null}
              {ins.causeCounts["model-switch"] ? ` ${ins.causeCounts["model-switch"]} model` : null}
              {ins.causeCounts["prefix-change"] ? ` ${ins.causeCounts["prefix-change"]} prefix` : null}
            </span>
          ) : null}
        </div>
      </div>

      <div className="cachep-chart">
        {ins.series.map((p, i) => {
          const ctx = p.read + p.written + p.fresh;
          const h = Math.max((ctx / maxCtx) * 100, 2);
          const wh = ctx ? (p.written / ctx) * h : 0;
          return (
            <span
              key={i}
              className={"cachep-bar" + (p.rebuild ? " is-rebuild" : "")}
              style={{ height: h + "%" }}
              title={`${p.agent} · ${fmtTokensShort(p.read)} read · ${fmtTokensShort(p.written)} written${p.rebuild ? " · CACHE REBUILT" : ""}`}
            >
              <span className="cachep-bar-w" style={{ height: wh ? Math.max((wh / h) * 100, p.rebuild ? 60 : 4) + "%" : "0%" }} />
            </span>
          );
        })}
      </div>
      <div className="cachep-caption">context per call — red = cache broke, re-written at 1.25× price</div>

      {ins.events.length ? (
        <div className="cachep-events">
          {ins.events.map((e, i) => (
            <div key={i} className="cachep-event">
              <span className="cachep-ev-time tnum">{fmtTime(e.ts)}</span>
              <span className="cachep-ev-cause">
                {e.agent !== "main" ? <span className="cachep-ev-agent">{e.agent}</span> : null}
                {causeLabel(e)}
              </span>
              <span className="cachep-ev-tok tnum">{fmtTokensShort(e.rebuiltTokens)} re-written</span>
              <span className="cachep-ev-cost tnum">+{fmtCost(e.wastedUsd)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="cachep-empty">no avoidable cache waste in this session</div>
      )}

      {advice ? <div className="cachep-advice">{advice}</div> : null}
    </div>
  );
}
```

`fmtTime` is exported from `../lib/format` — add it to the existing import list if missing.

- [ ] **Step 3: Swap the panel in `StatsView`**

Replace (in the `StatsView` return):

```tsx
        <Panel title="Cache efficiency" sub="reads vs fresh input">
          <div className="cache-row">
            <Donut pct={s.cacheRatio} ... />
            ...
          </div>
        </Panel>
```

with:

```tsx
        <Panel title="Prompt caching" sub={`${(s.cacheRatio * 100).toFixed(1)}% of input read from cache`}>
          <CachePanel trace={trace} />
        </Panel>
```

- [ ] **Step 4: Replace the CSS**

In `src/App.css`, delete the `.cache-row`, `.donut-pct`, `.donut-lbl`, `.cache-legend`, `.cl-item`, `.cl-dot` (check usage), `.cl-note` rules and add:

```css
/* Prompt caching panel: savings/waste chips, per-call context bars, rebuild events */
.cachep { display: flex; flex-direction: column; gap: 12px; }
.cachep-chips { display: flex; gap: 10px; flex-wrap: wrap; }
.cachep-chip { flex: 1; min-width: 110px; background: var(--bg-2); border: 1px solid var(--line-soft); border-radius: var(--r-md); padding: 9px 12px; display: flex; flex-direction: column; gap: 3px; }
.cachep-k { font-family: var(--ff-mono); font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--tx-3); }
.cachep-v { font-family: var(--ff-mono); font-size: 17px; font-weight: 600; color: var(--tx-0); }
.cachep-v.ok { color: var(--ok, #4a9); }
.cachep-v.warn { color: var(--warn); }
.cachep-causes { font-family: var(--ff-mono); font-size: 10px; color: var(--tx-3); }
.cachep-chart { display: flex; align-items: flex-end; gap: 1px; height: 56px; background: var(--bg-2); border-radius: var(--r-sm); padding: 4px 4px 0; overflow: hidden; }
.cachep-bar { flex: 1; min-width: 1px; max-width: 14px; position: relative; background: color-mix(in oklch, var(--sonnet) 55%, transparent); border-radius: 1px 1px 0 0; }
.cachep-bar-w { position: absolute; top: 0; left: 0; right: 0; background: var(--warn); border-radius: 1px 1px 0 0; opacity: .45; }
.cachep-bar.is-rebuild { background: color-mix(in oklch, var(--err, #d66) 35%, transparent); }
.cachep-bar.is-rebuild .cachep-bar-w { background: var(--err, #d66); opacity: .9; }
.cachep-caption { font-family: var(--ff-mono); font-size: 10px; color: var(--tx-3); }
.cachep-events { display: flex; flex-direction: column; gap: 2px; max-height: 180px; overflow-y: auto; }
.cachep-event { display: grid; grid-template-columns: 52px 1fr auto auto; gap: 10px; align-items: baseline; font-size: 12px; padding: 4px 6px; border-radius: var(--r-sm); }
.cachep-event:nth-child(odd) { background: var(--bg-2); }
.cachep-ev-time { font-family: var(--ff-mono); font-size: 10.5px; color: var(--tx-3); }
.cachep-ev-cause { color: var(--tx-1); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cachep-ev-agent { font-family: var(--ff-mono); font-size: 10px; color: var(--tx-2); background: var(--bg-3); border-radius: 4px; padding: 1px 5px; margin-right: 6px; }
.cachep-ev-tok { font-family: var(--ff-mono); font-size: 11px; color: var(--tx-2); }
.cachep-ev-cost { font-family: var(--ff-mono); font-size: 11.5px; font-weight: 600; color: var(--warn); }
.cachep-empty { font-family: var(--ff-mono); font-size: 11.5px; color: var(--tx-3); padding: 4px 0; }
.cachep-advice { font-size: 12px; line-height: 1.5; color: var(--tx-2); background: var(--bg-2); border-left: 3px solid var(--accent); border-radius: var(--r-sm); padding: 8px 12px; }
```

Check `var(--ok)` and `var(--err)` exist in App.css; if not, the fallbacks in `color-mix`/`var()` above carry it. In the MOBILE section, remove the now-dead `.cache-row { flex-direction: column; ... }` and `.cache-row .donut { align-self: center; }` lines (the chips already wrap via flex-wrap).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc -b && npm run lint`
Expected: clean. Common trip-up: unused `Donut`/`s.cacheRatio` references — `s.cacheRatio` is still used by the panel `sub`.

- [ ] **Step 6: Commit**

```bash
git add src/components/StatsView.tsx src/App.css
git commit -m "feat: replace cache-efficiency donut with actionable prompt-caching panel"
```

---

### Task 5: Verify against real sessions in Docker

**Files:** none (verification only)

- [ ] **Step 1: Build and deploy**

Run: `docker compose up -d --build`
Expected: image builds (tsc + vite pass), container `claude-trace-viewer-trace-viewer-1` starts on :3099.

- [ ] **Step 2: Verify on a long multi-agent session (desktop)**

Run:
```bash
playwright-cli open "http://localhost:3099/?project=-Users-maxclaw-Documents-projects-audits-2026-05-subtensor&session=adf911cd-b91e-4b7d-a63b-814ab36c0672&view=stats"
playwright-cli snapshot
```
Expected in snapshot: a "Prompt caching" panel with saved/lost/rebuilds chips, bar chart, and (for this 3-hour session with idle gaps) at least one `idle … cache expired` event row. Screenshot and inspect visually: bars render, red rebuild bars visible, event rows aligned, advice line present.

- [ ] **Step 3: Verify a session with no rebuilds**

Open a short single-burst session from the sidebar; expect chips + "no avoidable cache waste in this session".

- [ ] **Step 4: Verify mobile (390×844)**

Run: `playwright-cli resize 390 844`, screenshot the stats view.
Expected: chips wrap cleanly, chart fits, event rows ellipsize the cause text without horizontal overflow.

- [ ] **Step 5: Cross-check one event by hand**

Pick one rebuild row; in the transcript view find the two assistant calls around its timestamp and confirm from their token numbers (`cache_read` collapse + big `cache_creation`) and timestamps that the cause label is right. This guards against a sign/indexing bug that unit fixtures can't catch.

- [ ] **Step 6: Final commit (if any fixups) and run full test suite**

Run: `npx vitest run && npx tsc -b`
Expected: all green.
```bash
git add -A && git commit -m "fix: cache panel polish from live verification" # only if fixups were needed
```
