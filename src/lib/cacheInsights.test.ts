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
    session: { id: "", project: "", attributionSkill: "", effort: "", gitBranch: "", models: [], durationMs: 0, startedAt: "", endedAt: "" },
    main: { messages: mainMsgs, toolResults: {}, toolCounts: {}, toolUseMsgUuid: {}, usage: u, peakContext: 0 },
    agents: agents.map((a, i) => ({
      id: "a" + i, toolUseId: "t" + i, agentType: a.agentType, description: "", model: "", effort: "",
      prompt: "", startedAt: "", endedAt: "", durationMs: 0, msgCount: a.messages.length,
      messages: a.messages, toolResults: {}, toolCounts: {}, toolUseMsgUuid: {}, usage: u, peakContext: 0, result: "", persona: null,
    })),
    workflows: [],
    stats: { totals: u, modelMix: { fable: 0, opus: 0, sonnet: 0, haiku: 0 }, toolFreq: {}, cacheRatio: 0.97, modelStats: [] },
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
    expect(ins.events[0].msgUuid).toBe("u" + (30 + 12 * 60));   // uuid is "u"+atSec in the fixture
    expect(ins.series[2].msgUuid).toBe("u" + (30 + 12 * 60));
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

  it("idle gap AND model switch → classified idle (precedence documented)", () => {
    const ins = analyzeCache(trace([
      msg({ atSec: 0, input: 5000, cw: 100000, cr: 0, model: "claude-sonnet-4-6" }),
      msg({ atSec: 600, input: 200, cw: 105000, cr: 0, model: "claude-opus-4-6" }),
    ]));
    expect(ins.events).toHaveLength(1);
    expect(ins.events[0].cause).toBe("idle");
  });

  it("user messages and zero-usage entries are skipped", () => {
    const ins = analyzeCache(trace([
      msg({ atSec: 0, role: "user", output: 0 }),
      msg({ atSec: 1, input: 0, cw: 0, cr: 0, output: 0 }),   // zero-usage assistant entry
      msg({ atSec: 2, input: 5000, cw: 20000, cr: 0 }),
    ]));
    expect(ins.series).toHaveLength(1);
  });
});
