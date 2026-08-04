import { describe, expect, it } from "vitest";
import type { CodexRecord } from "../codex-types";
import { normalizeCodexTrace } from "./normalizeCodex";

// Shapes mirror real rollout records from codex-cli 0.144.5; the token
// numbers are lifted from a real session where input_tokens=16376 verifiably
// *included* cached_input_tokens=9600.
function fixture(): CodexRecord[] {
  return [
    { timestamp: "2026-07-30T10:11:55.076Z", type: "session_meta", payload: { id: "0199-aaaa", cwd: "/Users/u/proj", model_provider: "openai", cli_version: "0.144.5" } },
    { timestamp: "2026-07-30T10:11:55.098Z", type: "turn_context", payload: { turn_id: "t1", cwd: "/Users/u/proj", model: "gpt-5.5", effort: "high" } },
    { timestamp: "2026-07-30T10:11:55.107Z", type: "event_msg", payload: { type: "user_message", message: "fix the bug" } },
    // response_item copy of the same prompt — must not render twice
    { timestamp: "2026-07-30T10:11:55.110Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "fix the bug" }] } },
    // harness-injected context — renders as a collapsed attachment row
    { timestamp: "2026-07-30T10:11:55.111Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n<cwd>/Users/u/proj</cwd>\n</environment_context>" }] } },
    // encrypted reasoning with no summary — contributes nothing visible
    { timestamp: "2026-07-30T10:11:57.826Z", type: "response_item", payload: { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "gAAA…" } },
    { timestamp: "2026-07-30T10:12:00.270Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Looking at the repo first." }] } },
    { timestamp: "2026-07-30T10:12:00.274Z", type: "response_item", payload: { type: "function_call", id: "fc_1", name: "exec_command", arguments: '{"cmd":"ls","workdir":"/Users/u/proj"}', call_id: "c1" } },
    { timestamp: "2026-07-30T10:12:00.641Z", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "Exit code: 0\nOutput:\nsrc" } },
    { timestamp: "2026-07-30T10:12:00.641Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 16376, cached_input_tokens: 9600, output_tokens: 203, reasoning_output_tokens: 48 }, model_context_window: 258400 } } },
    // second API call of the turn: a summarized reasoning + patch + failure
    { timestamp: "2026-07-30T10:12:05.000Z", type: "response_item", payload: { type: "reasoning", id: "rs_2", summary: [{ type: "summary_text", text: "Patch the config" }] } },
    { timestamp: "2026-07-30T10:12:06.000Z", type: "response_item", payload: { type: "custom_tool_call", id: "ctc_1", name: "apply_patch", input: "*** Begin Patch\n*** Update File: a.ts\n+x\n*** End Patch", call_id: "c2", status: "completed" } },
    { timestamp: "2026-07-30T10:12:06.500Z", type: "response_item", payload: { type: "custom_tool_call_output", call_id: "c2", output: "Exit code: 2\nOutput:\npatch failed" } },
    { timestamp: "2026-07-30T10:12:07.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 20000, cached_input_tokens: 18000, output_tokens: 50 }, model_context_window: 258400 } } },
    { timestamp: "2026-07-30T10:12:08.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] } },
    { timestamp: "2026-07-30T10:12:08.100Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 21000, cached_input_tokens: 20000, output_tokens: 12 } } } },
    { timestamp: "2026-07-30T10:12:08.200Z", type: "event_msg", payload: { type: "task_complete", turn_id: "t1" } },
    // agent_message duplicates assistant text — must not double-render
    { timestamp: "2026-07-30T10:12:08.300Z", type: "event_msg", payload: { type: "agent_message", message: "Done." } },
  ];
}

describe("normalizeCodexTrace", () => {
  it("builds user / attachment / assistant turns without duplicating text", () => {
    const t = normalizeCodexTrace("rollout-x", fixture());
    const roles = t.main.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "attachment", "assistant", "assistant", "assistant"]);
    const texts = JSON.stringify(t.main.messages);
    expect(texts.split("fix the bug").length - 1).toBe(1);
    expect(texts.split("Done.").length - 1).toBe(1);
    const att = t.main.messages[1].blocks[0].attachment as Record<string, unknown>;
    expect(att.type).toBe("codex_context");
    expect(att.label).toBe("environment context");
  });

  it("splits cached tokens out of input and bills cw=0", () => {
    const t = normalizeCodexTrace("rollout-x", fixture());
    const first = t.main.messages[2];
    expect(first.usage.input).toBe(16376 - 9600);
    expect(first.usage.cr).toBe(9600);
    expect(first.usage.cw).toBe(0);
    expect(first.usage.output).toBe(203);
    // 6776 × $1.25/M + 9600 × $0.125/M + 203 × $10/M
    expect(first.usage.cost).toBeCloseTo(6776 * 1.25e-6 + 9600 * 0.125e-6 + 203 * 10e-6, 10);
    expect(t.main.peakContext).toBe(21000);
    expect(t.stats.totals.output).toBe(203 + 50 + 12);
  });

  it("pairs tool calls by call_id and derives errors from exit codes", () => {
    const t = normalizeCodexTrace("rollout-x", fixture());
    expect(t.main.toolResults["c1"].is_error).toBe(false);
    expect(t.main.toolResults["c2"].is_error).toBe(true);
    expect(t.main.toolCounts).toEqual({ exec_command: 1, apply_patch: 1 });
    const patchCall = t.main.messages[3].blocks.find((b) => b.type === "tool_use");
    expect(patchCall?.name).toBe("apply_patch");
    expect(String(patchCall?.input?.input)).toContain("*** Begin Patch");
  });

  it("bills a completion even when it produced nothing renderable", () => {
    // First API call of the session is encrypted reasoning only: no text, no
    // tools, empty summary — the spend must still land in the totals.
    const records: CodexRecord[] = [
      { timestamp: "2026-07-30T10:00:00.000Z", type: "session_meta", payload: { id: "s", cwd: "/p" } },
      { timestamp: "2026-07-30T10:00:01.000Z", type: "turn_context", payload: { model: "gpt-5.5", effort: "medium" } },
      { timestamp: "2026-07-30T10:00:02.000Z", type: "response_item", payload: { type: "reasoning", id: "rs", summary: [], encrypted_content: "x" } },
      { timestamp: "2026-07-30T10:00:03.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 77 } } } },
    ];
    const t = normalizeCodexTrace("rollout-y", records);
    expect(t.stats.totals.output).toBe(77);
    expect(t.stats.totals.input).toBe(1000);
    expect(t.main.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  it("attaches pasted images from the response_item copy to the user turn", () => {
    const px = "iVBORw0KGgoAAAANSUhEUg=="; // not a real png — only plumbing is under test
    const records: CodexRecord[] = [
      { timestamp: "2026-07-30T10:00:00.000Z", type: "session_meta", payload: { id: "s", cwd: "/p" } },
      // response_item copy first — the queue must survive either ordering
      { timestamp: "2026-07-30T10:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [
        { type: "input_text", text: "<image name=[Image #1]>" },
        { type: "input_image", image_url: `data:image/png;base64,${px}` },
        { type: "input_text", text: "</image>" },
        { type: "input_text", text: "[Image #1] good? Grammar ok?" },
      ] } },
      { timestamp: "2026-07-30T10:00:01.100Z", type: "event_msg", payload: { type: "user_message", message: "[Image #1] good? Grammar ok?" } },
    ];
    const t = normalizeCodexTrace("rollout-z", records);
    expect(t.main.messages).toHaveLength(1);
    const msg = t.main.messages[0];
    expect(msg.role).toBe("user");
    const img = msg.blocks.find((b) => b.type === "image");
    expect(img?.source).toEqual({ type: "base64", media_type: "image/png", data: px });
    // the text renders once and the wrapper markers are gone
    const allText = msg.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    expect(allText).toBe("[Image #1] good? Grammar ok?");
  });

  it("carries session metadata, model, effort, and completion state", () => {
    const t = normalizeCodexTrace("rollout-x", fixture());
    expect(t.session.provider).toBe("codex");
    expect(t.session.id).toBe("0199-aaaa");
    expect(t.session.project).toBe("/Users/u/proj");
    expect(t.session.models).toEqual(["gpt-5.5"]);
    expect(t.session.effort).toBe("high");
    expect(t.session.contextWindow).toBe(258400);
    const last = [...t.main.messages].reverse().find((m) => m.role === "assistant");
    expect(last?.stopReason).toBe("end_turn");
    expect(last?.model).toBe("gpt-5.5");
    expect(t.agents).toEqual([]);
    const thinking = t.main.messages[3].blocks.find((b) => b.type === "thinking");
    expect(thinking?.thinking).toBe("Patch the config");
  });
});
