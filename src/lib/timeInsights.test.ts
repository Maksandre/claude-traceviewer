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
    main: { messages: main, toolResults: {}, toolCounts: {}, usage: u, toolUseMsgUuid: {}, peakContext: 0 },
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

  it("long response gaps count as away, short ones as waiting", () => {
    // 10s work, then a 17h overnight gap (away), then 10s work, then a 5m gap (waiting)
    const ins = analyzeTime(trace([
      msg({ atSec: 0, role: "user" }),
      msg({ atSec: 10, role: "assistant" }),
      msg({ atSec: 10 + 17 * 3600, role: "user" }),       // 17h → away
      msg({ atSec: 20 + 17 * 3600, role: "assistant" }),
      msg({ atSec: 20 + 17 * 3600 + 300, role: "user" }), // 5m → waiting
    ]));
    expect(ins.awayMs).toBe(17 * 3600 * 1000);
    expect(ins.waitingMs).toBe(300_000);
    expect(ins.workingMs).toBe(20_000);                   // two 10s agent spans
  });

  it("emits chronological segments, coalescing consecutive same-kind gaps", () => {
    const ins = analyzeTime(trace([
      msg({ atSec: 0, role: "user" }),
      msg({ atSec: 10, role: "assistant" }),     // work 10s
      msg({ atSec: 20, role: "assistant" }),     // work 10s (coalesces)
      msg({ atSec: 80, role: "user" }),          // wait 60s
      msg({ atSec: 90, role: "assistant" }),     // work 10s
    ]));
    expect(ins.segments.map(s => s.kind)).toEqual(["working", "waiting", "working"]);
    expect(ins.segments[0].ms).toBe(20_000);     // two work gaps merged
    expect(ins.segments[1].ms).toBe(60_000);
  });

  it("away spans appear as their own segment in time order", () => {
    const ins = analyzeTime(trace([
      msg({ atSec: 0, role: "user" }),
      msg({ atSec: 10, role: "assistant", uuid: "a1" }),
      msg({ atSec: 10 + 17 * 3600, role: "user" }),   // 17h away
      msg({ atSec: 20 + 17 * 3600, role: "assistant" }),
    ]));
    expect(ins.segments.map(s => s.kind)).toEqual(["working", "away", "working"]);
    expect(ins.segments[1].msgUuid).toBe("a1");      // jumps to turn before the pause
  });

  it("empty / single-message traces yield zeros", () => {
    const z = analyzeTime(trace([]));
    expect(z.workingMs).toBe(0);
    expect(z.waitingMs).toBe(0);
    expect(z.awayMs).toBe(0);
    expect(z.segments).toHaveLength(0);
    expect(analyzeTime(trace([msg({ atSec: 0, role: "user" })])).stalls).toHaveLength(0);
  });
});
