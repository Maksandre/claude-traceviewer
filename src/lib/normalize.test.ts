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

describe("normalize: attachments + thinking blocks", () => {
  it("surfaces attachment records as role=attachment messages with the payload", async () => {
    stubFetchEmpty();
    try {
      const att: TraceRecord = {
        type: "attachment", uuid: "att-1", timestamp: "2026-06-11T09:59:59Z",
        attachment: { type: "skill_listing", skillCount: 3, content: "- a\n- b\n- c" },
      } as unknown as TraceRecord;
      const t = await fetchNormalizedTrace("p", "s", [att, ASSIST]);
      const m = t.main.messages.find(x => x.role === "attachment");
      expect(m).toBeTruthy();
      expect(m!.uuid).toBe("att-1");
      expect(m!.blocks[0].type).toBe("attachment");
      expect(m!.blocks[0].attachment?.type).toBe("skill_listing");
    } finally { restoreFetch(); }
  });

  it("drops empty thinking blocks but keeps non-empty ones", async () => {
    stubFetchEmpty();
    try {
      const rec: TraceRecord = {
        type: "assistant", uuid: "asst-t", timestamp: "2026-06-11T10:00:00Z",
        message: {
          id: "m2", model: "claude-haiku-4-5-20251001",
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [
            { type: "thinking", thinking: "", signature: "sig" },
            { type: "thinking", thinking: "let me pick", signature: "sig2" },
            { type: "text", text: "rock" },
          ],
        },
      } as unknown as TraceRecord;
      const t = await fetchNormalizedTrace("p", "s", [rec]);
      const msg = t.main.messages.find(m => m.uuid === "asst-t");
      expect(msg!.blocks.map(b => b.type)).toEqual(["thinking", "text"]);
      expect(msg!.blocks[0].thinking).toBe("let me pick");
    } finally { restoreFetch(); }
  });
});
