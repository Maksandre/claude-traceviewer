export function fmtTokens(n: number | null | undefined): string {
  if (n == null) return "0";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k";
  return String(n);
}

export function fmtTokensFull(n: number | null | undefined): string {
  return (n || 0).toLocaleString("en-US");
}

/** Coarse token count for tight layouts: 4.02M → "4M", 777k → "0.8M", 25k → "25k". */
export function fmtTokensShort(n: number | null | undefined): string {
  if (n == null) return "0";
  if (n >= 950_000) return Math.round(n / 1e6) + "M";
  if (n >= 100_000) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1_000) return Math.round(n / 1e3) + "k";
  return String(n);
}

/** Coarse duration for tight layouts: 10m 47s → "11m", 39s → "39s". */
export function fmtDurShort(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms >= 60_000) return Math.round(ms / 60_000) + "m";
  return Math.round(ms / 1000) + "s";
}

export function fmtCost(n: number | null | undefined): string {
  if (n == null) return "$0";
  if (n >= 1) return "$" + n.toFixed(2);
  if (n >= 0.01) return "$" + n.toFixed(3);
  return "$" + n.toFixed(4);
}

export function fmtDur(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = ms / 1000;
  if (s < 60) return s.toFixed(s < 10 ? 1 : 0) + "s";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m + "m" + (r ? " " + r + "s" : "");
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function fmtClock(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function relTime(iso?: string | null): string {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const day = 86400;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < day) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / day) + "d ago";
}

export type ModelFamily = "fable" | "opus" | "sonnet" | "haiku";

export function modelFamily(m?: string | null): ModelFamily {
  const s = m || "";
  if (s.includes("fable")) return "fable";
  if (s.includes("opus")) return "opus";
  if (s.includes("haiku")) return "haiku";
  return "sonnet";
}

export function modelLabel(m?: string | null): string {
  const fam = modelFamily(m);
  const cap = fam.charAt(0).toUpperCase() + fam.slice(1);
  const match = (m || "").match(/(\d+(?:[-.]\d+)?)/);
  const ver = match?.[1];
  return ver ? `${cap} ${ver.replace("-", ".")}` : cap;
}

export function modelColor(m?: string | null): string {
  return `var(--${modelFamily(m)})`;
}

export type ToolCat = "read" | "write" | "exec" | "agent" | "web" | "mcp" | "other";

const TOOL_CAT_MAP: Record<string, ToolCat> = {
  Read: "read", Glob: "read", Grep: "read", NotebookRead: "read", LS: "read",
  Write: "write", Edit: "write", MultiEdit: "write", NotebookEdit: "write",
  Bash: "exec", BashOutput: "exec", KillShell: "exec",
  Agent: "agent", Task: "agent", SendMessage: "agent",
  WebFetch: "web", WebSearch: "web", ToolSearch: "web",
};

export function toolCat(name?: string | null): ToolCat {
  if (!name) return "other";
  if (TOOL_CAT_MAP[name]) return TOOL_CAT_MAP[name];
  if (name.includes("__")) return "mcp";
  return "other";
}

export function toolColor(name?: string | null): string {
  const c = toolCat(name);
  return ({ read: "var(--tool-read)", write: "var(--tool-write)", exec: "var(--tool-exec)",
    agent: "var(--tool-agent)", web: "var(--tool-web)", mcp: "var(--accent)", other: "var(--tx-2)" } as const)[c];
}

/** Split an MCP tool id ("mcp__<server>__<tool>") into display parts, or null
 * for regular tools. The server segment is prettified for display: the
 * "claude_ai_" prefix that claude.ai-hosted connectors add is noise, and
 * underscores read better as spaces ("claude_ai_Google_Drive" → "Google Drive"). */
export function mcpToolName(name?: string | null): { server: string; tool: string } | null {
  if (!name || !name.startsWith("mcp__")) return null;
  const rest = name.slice(5);
  const sep = rest.indexOf("__");
  if (sep <= 0 || sep + 2 >= rest.length) return null;
  const raw = rest.slice(0, sep);
  const server = raw.replace(/^claude_ai_/, "").replace(/_+/g, " ").trim();
  return { server: server || raw, tool: rest.slice(sep + 2) };
}

export interface AgentMeta { hue: number; }
export function agentMeta(type: string = ""): AgentMeta {
  const t = type.toLowerCase();
  if (t.includes("explore")) return { hue: 250 };
  if (t.includes("plan")) return { hue: 300 };
  if (t.includes("valid") || t.includes("test")) return { hue: 90 };
  if (t.includes("writer") || t.includes("doc")) return { hue: 155 };
  if (t.includes("research")) return { hue: 35 };
  return { hue: 20 };
}

export function agentColor(type: string = ""): string {
  return `oklch(0.70 0.12 ${agentMeta(type).hue})`;
}

/* Pricing — looks up the exact model id in the snapshot first (see src/lib/pricing.json,
   sourced from LiteLLM's anthropic-direct entries), then strips date suffix,
   then falls back to family rates. Rates are USD per token. */
import pricingSnapshot from "./pricing.json";

interface PerTokenRates {
  input_cost_per_token: number;
  output_cost_per_token: number;
  cache_creation_input_token_cost?: number;
  cache_read_input_token_cost?: number;
}

const PRICING_BY_ID = pricingSnapshot as unknown as Record<string, PerTokenRates>;

/* family-level fallback (USD per token), used when an id isn't in the snapshot */
const FAMILY_FALLBACK: Record<ModelFamily, PerTokenRates> = {
  fable:  { input_cost_per_token: 10e-6, output_cost_per_token: 50e-6, cache_creation_input_token_cost: 12.5e-6,  cache_read_input_token_cost: 1.0e-6 },
  opus:   { input_cost_per_token: 15e-6, output_cost_per_token: 75e-6, cache_creation_input_token_cost: 18.75e-6, cache_read_input_token_cost: 1.5e-6 },
  sonnet: { input_cost_per_token:  3e-6, output_cost_per_token: 15e-6, cache_creation_input_token_cost:  3.75e-6, cache_read_input_token_cost: 0.30e-6 },
  haiku:  { input_cost_per_token:  1e-6, output_cost_per_token:  5e-6, cache_creation_input_token_cost:  1.25e-6, cache_read_input_token_cost: 0.10e-6 },
};

function lookupRates(model: string | undefined | null): PerTokenRates {
  if (model) {
    if (PRICING_BY_ID[model]) return PRICING_BY_ID[model];
    const stripped = model.replace(/-\d{8}$/, "");
    if (stripped !== model && PRICING_BY_ID[stripped]) return PRICING_BY_ID[stripped];
  }
  return FAMILY_FALLBACK[modelFamily(model)];
}

export function costFor(model: string | undefined | null, u: { input: number; output: number; cw: number; cr: number }): number {
  const r = lookupRates(model);
  return (
    u.input  * r.input_cost_per_token +
    u.output * r.output_cost_per_token +
    u.cw     * (r.cache_creation_input_token_cost ?? r.input_cost_per_token * 1.25) +
    u.cr     * (r.cache_read_input_token_cost     ?? r.input_cost_per_token * 0.10)
  );
}
