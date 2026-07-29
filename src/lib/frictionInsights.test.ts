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
    session: { id: "", project: "", attributionSkill: "", effort: "", gitBranch: "", models: [], durationMs: 0, startedAt: "", endedAt: "" },
    main: {
      messages: opts.mainMsgs ?? [],
      toolResults: opts.mainResults ?? {},
      toolCounts: opts.mainCounts ?? {},
      usage: u,
      toolUseMsgUuid: opts.mainMap ?? {},
      peakContext: 0,
    },
    agents: [],
    workflows: [],
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
