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
