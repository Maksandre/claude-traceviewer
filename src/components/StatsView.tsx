import { useMemo, useState } from "react";
import { agentColor, fmtClock, fmtCost, fmtDur, fmtDurShort, fmtTime, fmtTokens, fmtTokensShort, modelColor, modelLabel, toolColor } from "../lib/format";
import { Icons, toolIcon } from "../lib/icons";
import { Bar } from "../lib/md";
import { ToolName } from "./ToolName";
import type { NormTrace } from "../lib/normalize";
import { analyzeCache } from "../lib/cacheInsights";
import type { CacheInsights, CacheRebuild } from "../lib/cacheInsights";

interface Props { trace: NormTrace; onOpenAgent: (id: string) => void; }

/* Extract a meaningful identity key from a tool_use input — the "what was this
   call against?" string we group by. file_path for file tools, command for
   Bash, pattern for search tools, etc. Returns null when the tool is not
   worth breaking down (no stable key). */
function toolItemKey(name: string, input: Record<string, any> | undefined): string | null {
  if (!input) return null;
  switch (name) {
    case "Read":
    case "Edit":
    case "Write":
    case "MultiEdit":
      return (input.file_path as string) || null;
    case "NotebookEdit":
    case "NotebookRead":
      return (input.notebook_path as string) || (input.file_path as string) || null;
    case "LS":
      return (input.path as string) || null;
    case "Bash": {
      const cmd = (input.command as string) || "";
      return cmd ? (cmd.length > 140 ? cmd.slice(0, 137) + "…" : cmd) : null;
    }
    case "Grep": {
      const pat = (input.pattern as string) || "";
      const path = (input.path as string) || "";
      return pat ? (path ? `${pat}  in  ${path}` : pat) : null;
    }
    case "Glob":
      return (input.pattern as string) || null;
    case "WebFetch":
      return (input.url as string) || null;
    case "WebSearch":
      return (input.query as string) || null;
    case "Agent":
    case "Task": {
      const t = (input.subagent_type as string) || "agent";
      const d = (input.description as string) || "";
      return d ? `${t} — ${d}` : t;
    }
    default:
      return null;
  }
}

function buildToolUsage(trace: NormTrace): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const walk = (msgs: NormTrace["main"]["messages"]) => {
    for (const m of msgs) {
      if (m.role !== "assistant") continue;
      for (const b of m.blocks) {
        if (b.type !== "tool_use" || !b.name) continue;
        const key = toolItemKey(b.name, b.input);
        if (!key) continue;
        const bucket = (out[b.name] ||= {});
        bucket[key] = (bucket[key] || 0) + 1;
      }
    }
  };
  walk(trace.main.messages);
  for (const a of trace.agents) walk(a.messages);
  return out;
}

function BigStat({ icon: Ic, label, value, sub, color, accent }: {
  icon: (p?: { size?: number }) => React.ReactElement;
  label: string;
  value: React.ReactNode;
  sub?: string;
  color?: string;
  accent?: boolean;
}) {
  return (
    <div className={"bigstat " + (accent ? "accent" : "")}>
      <div className="bigstat-top">
        <span className="bigstat-ic" style={color ? { color } : undefined}><Ic size={16} /></span>
        <span className="bigstat-label">{label}</span>
      </div>
      <div className="bigstat-val tnum" style={color ? { color } : undefined}>{value}</div>
      {sub ? <div className="bigstat-sub">{sub}</div> : null}
    </div>
  );
}

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

const MAX_CHART_BARS = 160;

function CachePanel({ trace }: { trace: NormTrace }) {
  const { ins, maxCtx, advice, display } = useMemo(() => {
    const ins = analyzeCache(trace);
    const maxCtx = Math.max(...ins.series.map(p => p.read + p.written + p.fresh), 1);
    // Long sessions have thousands of calls — more bars than pixels. Bucket for
    // display: keep each bucket's biggest-context call, flag if any call rebuilt.
    let display = ins.series;
    if (display.length > MAX_CHART_BARS) {
      const bucketSize = Math.ceil(display.length / MAX_CHART_BARS);
      const out: typeof display = [];
      for (let i = 0; i < ins.series.length; i += bucketSize) {
        const slice = ins.series.slice(i, i + bucketSize);
        let top = slice[0];
        for (const p of slice) if (p.read + p.written + p.fresh > top.read + top.written + top.fresh) top = p;
        out.push({ ...top, rebuild: slice.some(p => p.rebuild) });
      }
      display = out;
    }
    return { ins, maxCtx, advice: adviceFor(ins), display };
  }, [trace]);
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
              {[
                ins.causeCounts.idle ? `${ins.causeCounts.idle} idle` : "",
                ins.causeCounts["model-switch"] ? `${ins.causeCounts["model-switch"]} model` : "",
                ins.causeCounts["prefix-change"] ? `${ins.causeCounts["prefix-change"]} prefix` : "",
              ].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </div>
      </div>

      <div className="cachep-chart" role="img" aria-label={`Context per API call — ${ins.series.length} calls`}>
        {display.map((p, i) => {
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

function Panel({ title, sub, children, span }: { title: string; sub?: string; children: React.ReactNode; span?: 2 }) {
  return (
    <section className={"panel " + (span ? "span-" + span : "")}>
      <header className="panel-head">
        <h3 className="panel-title">{title}</h3>
        {sub ? <span className="panel-sub">{sub}</span> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function ModelMix({ mix }: { mix: Record<string, number> }) {
  const entries = Object.entries(mix).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
  if (entries.length === 0) return <div className="empty">no model data</div>;
  return (
    <div>
      <div className="stackbar">
        {entries.map(([fam, v]) => (
          <div key={fam} className="stackseg"
            style={{ width: (v / total * 100) + "%", background: `var(--${fam})` }}
            title={`${fam} ${(v / total * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="legend">
        {entries.map(([fam, v]) => (
          <div key={fam} className="legend-item">
            <span className="legend-dot" style={{ background: `var(--${fam})` }} />
            <span className="legend-name">{fam[0].toUpperCase() + fam.slice(1)}</span>
            <span className="legend-val tnum">{(v / total * 100).toFixed(1)}%</span>
            <span className="legend-sub tnum">{fmtTokens(v)} tok</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function looksLikePath(s: string): boolean {
  return /^(?:[a-z]:)?\/|^~\/|^\.\.?\//i.test(s) || s.includes("/");
}

/* Strip the project-dir prefix so files in the project show as "src/foo.ts"
   instead of "/Users/me/.../project/src/foo.ts". The full path is kept on
   the row for the copy action. */
function relToProject(p: string, projectDir: string): string {
  if (!projectDir) return p;
  const root = projectDir.replace(/\/+$/, "");
  if (p === root) return ".";
  if (p.startsWith(root + "/")) return p.slice(root.length + 1);
  return p;
}

function shortenPath(p: string): { head: string; tail: string } {
  if (!looksLikePath(p)) return { head: "", tail: p };
  const idx = p.lastIndexOf("/");
  if (idx < 0) return { head: "", tail: p };
  return { head: p.slice(0, idx + 1), tail: p.slice(idx + 1) };
}

const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit", "NotebookRead", "LS"]);

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function ToolDetailRow({ fullKey, displayKey, count, max, color, copyable }: {
  fullKey: string;
  displayKey: string;
  count: number;
  max: number;
  color: string;
  copyable: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (!copyable) return;
    const ok = await copyText(fullKey);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1100);
  };
  const { head, tail } = shortenPath(displayKey);
  const title = copyable ? `${fullKey} — click to copy` : fullKey;
  return (
    <div
      role={copyable ? "button" : undefined}
      tabIndex={copyable ? 0 : undefined}
      className={"tf-detail-row " + (copyable ? "tf-copy" : "") + (copied ? " is-copied" : "")}
      title={title}
      onClick={onCopy}
      onKeyDown={(e) => { if (copyable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onCopy(); } }}
    >
      <span className="tf-detail-key mono">
        {head ? <span className="tf-detail-dir">{head}</span> : null}
        <span className="tf-detail-name">{tail}</span>
        {copied ? <span className="tf-detail-copied">copied</span> : null}
      </span>
      <span className="tf-detail-bar"><Bar pct={count / max} color={color} h={5} /></span>
      <span className="tf-detail-count tnum">{count}</span>
    </div>
  );
}

function ToolDetail({ name, items, color, projectDir }: {
  name: string;
  items: Record<string, number>;
  color: string;
  projectDir: string;
}) {
  const entries = Object.entries(items).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    return <div className="tf-detail-empty">no per-call detail captured for {name}</div>;
  }
  const max = Math.max(...entries.map(e => e[1]), 1);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const isFileTool = FILE_TOOLS.has(name);
  const label = ({
    Read: "files read", Edit: "files edited", Write: "files written",
    MultiEdit: "files edited", NotebookEdit: "notebooks edited", NotebookRead: "notebooks read",
    LS: "paths listed", Bash: "commands", Grep: "patterns",
    Glob: "patterns", WebFetch: "URLs", WebSearch: "queries",
    Agent: "agents spawned", Task: "tasks spawned",
  } as Record<string, string>)[name] || "items";
  return (
    <div className="tf-detail">
      <div className="tf-detail-head">
        <span>{entries.length} unique {label}{isFileTool ? " · click to copy full path" : ""}</span>
        <span className="tf-detail-total tnum">{total} calls</span>
      </div>
      <div className="tf-detail-list">
        {entries.map(([key, count]) => {
          const display = isFileTool ? relToProject(key, projectDir) : key;
          return (
            <ToolDetailRow
              key={key}
              fullKey={key}
              displayKey={display}
              count={count}
              max={max}
              color={color}
              copyable={isFileTool}
            />
          );
        })}
      </div>
    </div>
  );
}

function ToolFreq({ freq, usage, projectDir }: {
  freq: Record<string, number>;
  usage: Record<string, Record<string, number>>;
  projectDir: string;
}) {
  const entries = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(e => e[1]), 1);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const [openTool, setOpenTool] = useState<string | null>(null);
  if (entries.length === 0) return <div className="empty">no tool calls</div>;
  return (
    <div>
      <div className="toolfreq-total">{total} total tool calls across session · click a row for breakdown</div>
      {entries.map(([name, count]) => {
        const TI = toolIcon(name);
        const col = toolColor(name);
        const isOpen = openTool === name;
        const items = usage[name];
        const expandable = !!items && Object.keys(items).length > 0;
        return (
          <div key={name} className={"tf-group " + (isOpen ? "open" : "")}>
            <button
              type="button"
              className={"tf-row " + (expandable ? "tf-clickable" : "tf-static") + (isOpen ? " is-open" : "")}
              onClick={() => expandable && setOpenTool(isOpen ? null : name)}
              disabled={!expandable}
              aria-expanded={isOpen}
            >
              <span className="tf-name">
                {expandable ? (
                  <span className="tf-caret">
                    <Icons.chevron size={11} style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                  </span>
                ) : <span className="tf-caret tf-caret-placeholder" />}
                <span className="tf-ic" style={{ color: col }}><TI size={13} /></span>
                <ToolName name={name} />
              </span>
              <span><Bar pct={count / max} color={col} h={8} /></span>
              <span className="tf-count tnum">{count}</span>
            </button>
            {isOpen && expandable ? <ToolDetail name={name} items={items} color={col} projectDir={projectDir} /> : null}
          </div>
        );
      })}
    </div>
  );
}

/* Per-agent table merged with the execution timeline: the same agent list
   carries cost/token columns AND a gantt bar positioned in session time, so
   "this parallel wave cost $X" is readable per row instead of across two
   panels. Rows sort by launch time — parallel waves group naturally. */
function AgentGantt({ trace, onOpen }: { trace: NormTrace; onOpen: (id: string) => void }) {
  const start = trace.session.startedAt ? new Date(trace.session.startedAt).getTime() : 0;
  const end = trace.session.endedAt ? new Date(trace.session.endedAt).getTime() : start + 1;
  const span = Math.max(end - start, 1);
  const rows = [
    { id: null as string | null, name: "main agent", model: trace.session.models[0] || "", u: trace.main.usage,
      tools: Object.values(trace.main.toolCounts).reduce((a, b) => a + b, 0), dur: trace.session.durationMs,
      s: 0, e: span, col: "var(--accent)", desc: "main conversation", isMain: true },
    ...trace.agents.map(a => ({
      id: a.id as string | null, name: a.agentType, model: a.model, u: a.usage,
      tools: Object.values(a.toolCounts).reduce((x, y) => x + y, 0), dur: a.durationMs,
      s: a.startedAt ? new Date(a.startedAt).getTime() - start : 0,
      e: a.endedAt ? new Date(a.endedAt).getTime() - start : 0,
      col: agentColor(a.agentType), desc: a.description, isMain: false,
    })).sort((x, y) => x.s - y.s),
  ];
  const ticks = 4;
  // Axis labels round to whole minutes on long sessions — full "135m 20s"
  // labels collide at the right edge of the track.
  const tickLabel = (ms: number) => span > 600_000 ? Math.round(ms / 60_000) + "m" : fmtDur(ms);
  return (
    <div className="agantt">
      <div className="ag-head">
        <span>agent</span><span>model</span><span className="r">tokens</span><span className="r">tools</span><span className="r">time</span><span className="r">cost</span>
        <span className="ag-axis">
          {Array.from({ length: ticks + 1 }).map((_, i) => (
            <span key={i} className="ag-tick" style={{ left: (i / ticks * 100) + "%" }}>{tickLabel(span * i / ticks)}</span>
          ))}
        </span>
      </div>
      <div className="ag-body">
        {rows.map((r, i) => {
          const totTok = r.u.input + r.u.output + r.u.cw + r.u.cr;
          return (
            <button
              key={i}
              className={"ag-row " + (r.isMain ? "is-main" : "")}
              onClick={() => !r.isMain && r.id && onOpen(r.id)}
              disabled={r.isMain}
            >
              <span className="at-name">
                <span className="at-dot" style={{ background: r.col }} />
                <span className="at-type">{r.name}</span>
              </span>
              <span className="at-model" style={{ color: modelColor(r.model) }}>
                <span className="ag-full">{modelLabel(r.model)}</span>
                <span className="ag-short">{modelLabel(r.model).split(" ")[0]}</span>
              </span>
              <span className="r tnum at-tok">
                <span className="ag-full">{fmtTokens(totTok)}</span>
                <span className="ag-short">{fmtTokensShort(totTok)}</span>
              </span>
              <span className="r tnum">{r.tools}</span>
              <span className="r tnum">
                <span className="ag-full">{fmtDur(r.dur)}</span>
                <span className="ag-short">{fmtDurShort(r.dur)}</span>
              </span>
              <span className="r tnum at-costnum">{fmtCost(r.u.cost)}</span>
              <span className="ag-track">
                <span
                  className="ag-bar"
                  style={{
                    left: (Math.max(r.s, 0) / span * 100) + "%",
                    width: Math.max((r.e - r.s) / span * 100, 1) + "%",
                    background: r.col,
                    opacity: r.isMain ? 0.25 : 0.85,
                  }}
                  title={(r.desc ? r.desc + " · " : "") + fmtDur(r.dur)}
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function StatsView({ trace, onOpenAgent }: Props) {
  const s = trace.stats;
  const sess = trace.session;
  const totTok = useMemo(() => s.totals.input + s.totals.output + s.totals.cw + s.totals.cr, [s.totals]);
  const toolUsage = useMemo(() => buildToolUsage(trace), [trace]);
  return (
    <div className="stats-view">
      <div className="bigstats">
        <BigStat icon={Icons.coins} label="TOTAL COST" value={fmtCost(s.totals.cost)} sub="all models" color="var(--accent)" accent />
        <BigStat icon={Icons.hash} label="TOTAL TOKENS" value={fmtTokens(totTok)} sub={`${fmtTokens(s.totals.output)} generated`} />
        <BigStat icon={Icons.clock} label="WALL CLOCK" value={fmtDur(sess.durationMs)} sub={fmtClock(sess.startedAt)} />
        <BigStat icon={Icons.agent} label="AGENTS" value={1 + trace.agents.length} sub={`1 main · ${trace.agents.length} sub`} color="var(--tool-agent)" />
        <BigStat icon={Icons.terminal} label="TOOL CALLS" value={Object.values(s.toolFreq).reduce((a, b) => a + b, 0)} sub={`${Object.keys(s.toolFreq).length} distinct`} />
      </div>

      <div className="stats-grid">
        <Panel title="Prompt caching" sub={`${(s.cacheRatio * 100).toFixed(1)}% of input read from cache`}>
          <CachePanel trace={trace} />
        </Panel>

        <Panel title="Model mix" sub="by token volume">
          <ModelMix mix={s.modelMix} />
        </Panel>

        <Panel title="Tool usage frequency" span={2} sub="click a tool for file/command breakdown">
          <ToolFreq freq={s.toolFreq} usage={toolUsage} projectDir={sess.project} />
        </Panel>

        <Panel
          title="Agents"
          span={2}
          sub={trace.agents.length > 0
            ? `${trace.agents.length} subagents · wall-clock ${fmtDur(sess.durationMs)} · click a row to inspect, hover a bar for its task`
            : "no subagents launched"}
        >
          <AgentGantt trace={trace} onOpen={onOpenAgent} />
        </Panel>
      </div>
    </div>
  );
}
