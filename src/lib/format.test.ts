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
