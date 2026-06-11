import { useMemo, useState } from "react";
import { agentColor, fmtClock, fmtCost, fmtDur, fmtDurShort, fmtTime, fmtTokens, fmtTokensShort, modelColor, modelLabel, toolColor } from "../lib/format";
import { Icons, toolIcon } from "../lib/icons";
import { Bar } from "../lib/md";
import { ToolName } from "./ToolName";
import type { NormTrace } from "../lib/normalize";
import { analyzeCache } from "../lib/cacheInsights";
import type { CacheInsights, CacheRebuild } from "../lib/cacheInsights";
import { analyzeFriction } from "../lib/frictionInsights";
import { analyzeTime } from "../lib/timeInsights";

interface Props { trace: NormTrace; onOpenAgent: (id: string) => void; onOpenMessage: (uuid: string) => void; }

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
    return `Mostly idle gaps (${idle} of ${n}). The cache expires after 5 minutes of inactivity, so the next message re-reads the whole conversation at 1.25× price. What to do: reply within ~5 minutes, or send your prompts together in one go.`;
  }
  if (ms >= px) {
    return `Mostly model switches (${ms} of ${n}). The cache is per-model, so every switch re-reads the whole conversation from scratch. What to do: stick to one model for a session when you can.`;
  }
  return `Mostly prefix changes (${px} of ${n}) — usually automatic context compaction or a tool/skill loading mid-session, not something you set by hand. What to do: little, in most cases. If they happen often, the session is long enough to keep compacting — starting a fresh session for a new task stops you re-paying for the old context.`;
}

const IDLE_GAP_MS = 5 * 60_000;

const MAX_TIMELINE_PTS = 400;

function downsampleSeries(series: CacheInsights["series"]): CacheInsights["series"] {
  if (series.length <= MAX_TIMELINE_PTS) return series;
  // Keep every rebuild point (red dots must survive) plus an evenly-spaced
  // sample of the rest, preserving chronological order.
  const stride = Math.ceil(series.length / MAX_TIMELINE_PTS);
  const out: CacheInsights["series"] = [];
  for (let i = 0; i < series.length; i++) {
    if (series[i].rebuild || i % stride === 0 || i === series.length - 1) out.push(series[i]);
  }
  return out;
}

function ContextTimeline({ ins, onOpenMessage, hoverUuid, onHover }: {
  ins: CacheInsights;
  onOpenMessage: (uuid: string) => void;
  hoverUuid: string | null;
  onHover: (uuid: string | null) => void;
}) {
  const pts = downsampleSeries(ins.series);
  if (pts.length < 2) return <div className="cachep-empty">not enough calls to chart</div>;
  // Build an x position per point: real elapsed time, but any gap over the idle
  // threshold is clamped to a fixed slot so one long pause doesn't flatten the rest.
  const times = pts.map(p => new Date(p.ts).getTime());
  const SLOT = 1; // compressed gap width in arbitrary x-units
  const xs: number[] = [0];
  const breaks: { x: number; ms: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const raw = Number.isNaN(times[i]) || Number.isNaN(times[i - 1]) ? 0 : times[i] - times[i - 1];
    if (raw > IDLE_GAP_MS) { breaks.push({ x: xs[i - 1] + SLOT / 2, ms: raw }); xs.push(xs[i - 1] + SLOT); }
    else xs.push(xs[i - 1] + Math.max(raw / 1000, 0.001)); // seconds as x-units
  }
  const maxX = xs[xs.length - 1] || 1;
  const ctx = pts.map(p => p.read + p.written + p.fresh);
  const maxY = Math.max(...ctx, 1);
  const W = 100, H = 40;
  const px = (x: number) => (x / maxX) * W;
  const py = (y: number) => H - (y / maxY) * H;
  const line = pts.map((_p, i) => `${px(xs[i]).toFixed(2)},${py(ctx[i]).toFixed(2)}`).join(" ");
  const area = `0,${H} ${line} ${px(xs[xs.length - 1]).toFixed(2)},${H}`;
  return (
    <div className="ctl">
      {breaks.length ? (
        <div className="ctl-breakrow">
          {breaks.map((b, i) => (
            <span key={i} className="ctl-break-mark" style={{ left: px(b.x) + "%" }} title={`idle pause · ${fmtDur(b.ms)}`}>⏸</span>
          ))}
        </div>
      ) : null}
      <svg className="ctl-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Context size across ${ins.series.length} calls`}>
        <polygon className="ctl-area" points={area} />
        <polyline className="ctl-line" points={line} />
        {breaks.map((b, i) => <line key={"b" + i} className="ctl-break" x1={px(b.x)} x2={px(b.x)} y1={0} y2={H} />)}
        {pts.map((p, i) => p.rebuild ? (
          <g key={i}
            className={"ctl-mark" + (p.msgUuid === hoverUuid ? " is-hover" : "")}
            onClick={() => onOpenMessage(p.msgUuid)}
            onMouseEnter={() => onHover(p.msgUuid)}
            onMouseLeave={() => onHover(null)}
          >
            <rect className="ctl-mark-hit" x={px(xs[i]) - 1.6} y={0} width={3.2} height={H} />
            <line className="ctl-mark-line" x1={px(xs[i])} x2={px(xs[i])} y1={0} y2={H} />
            <title>cache rebuilt here — click to open</title>
          </g>
        ) : null)}
      </svg>
      <div className="cachep-caption">Claude re-reads the whole conversation each call — this line is how big that re-read is. Red marks = the cache broke and was rebuilt (click to open). ⏸ marks = an idle pause, where that stretch of idle time is squeezed so it doesn't flatten the rest.</div>
    </div>
  );
}

function CachePanel({ trace, onOpenMessage }: { trace: NormTrace; onOpenMessage: (uuid: string) => void }) {
  const { ins, advice } = useMemo(() => {
    const ins = analyzeCache(trace);
    return { ins, advice: adviceFor(ins) };
  }, [trace]);
  // Shared hover key links a timeline marker to its event row, both ways.
  const [hoverUuid, setHoverUuid] = useState<string | null>(null);
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

      <ContextTimeline ins={ins} onOpenMessage={onOpenMessage} hoverUuid={hoverUuid} onHover={setHoverUuid} />

      {ins.events.length ? (
        <div className="cachep-events">
          {ins.events.map((e, i) => (
            <button key={i} type="button"
              className={"cachep-event cachep-event-btn" + (e.msgUuid === hoverUuid ? " is-hover" : "")}
              onClick={() => onOpenMessage(e.msgUuid)}
              onMouseEnter={() => setHoverUuid(e.msgUuid)}
              onMouseLeave={() => setHoverUuid(null)}
            >
              <span className="cachep-ev-time tnum">{fmtTime(e.ts)}</span>
              <span className="cachep-ev-cause">
                {e.agent !== "main" ? <span className="cachep-ev-agent">{e.agent}</span> : null}
                {causeLabel(e)}
              </span>
              <span className="cachep-ev-tok tnum">{fmtTokensShort(e.rebuiltTokens)} re-written</span>
              <span className="cachep-ev-cost tnum">+{fmtCost(e.wastedUsd)}</span>
            </button>
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

function CostModels({ trace }: { trace: NormTrace }) {
  const rows = trace.stats.modelStats;
  const totalCost = rows.reduce((a, r) => a + r.cost, 0) || 1;
  if (rows.length === 0) return <div className="empty">no model data</div>;
  return (
    <div className="costmodels">
      {rows.map(r => (
        <div key={r.family} className="cm-row">
          <span className="cm-dot" style={{ background: `var(--${r.family})` }} />
          <span className="cm-name">{r.family[0].toUpperCase() + r.family.slice(1)}</span>
          <span className="cm-bar"><span className="cm-bar-fill" style={{ width: (r.cost / totalCost * 100) + "%", background: `var(--${r.family})` }} /></span>
          <span className="cm-tok tnum">{fmtTokens(r.tokens)}</span>
          <span className="cm-cost tnum">{fmtCost(r.cost)}</span>
        </div>
      ))}
    </div>
  );
}

function FrictionPanel({ trace, onOpenMessage }: { trace: NormTrace; onOpenMessage: (uuid: string) => void }) {
  const fr = useMemo(() => analyzeFriction(trace), [trace]);
  if (fr.errorTotal === 0 && fr.interruptions === 0) {
    return <div className="cachep-empty">clean run — no errors or interruptions</div>;
  }
  return (
    <div className="friction">
      <div className="friction-summary">
        <span className="friction-stat"><b className="tnum warn">{fr.errorTotal}</b> tool error{fr.errorTotal === 1 ? "" : "s"}</span>
        <span className="friction-stat"><b className="tnum">{fr.interruptions}</b> interruption{fr.interruptions === 1 ? "" : "s"}</span>
      </div>
      {fr.toolErrors.map(g => (
        <div key={g.tool} className="friction-group">
          <div className="friction-tool">{g.tool} <span className="friction-count tnum">×{g.count}</span></div>
          {g.samples.map((s, i) => (
            <button key={i} type="button" className="friction-sample" onClick={() => s.msgUuid && onOpenMessage(s.msgUuid)} disabled={!s.msgUuid}>
              {s.snippet || "(no message)"}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function TimeSpentPanel({ trace, onOpenMessage }: { trace: NormTrace; onOpenMessage: (uuid: string) => void }) {
  const ti = useMemo(() => analyzeTime(trace), [trace]);
  const total = ti.workingMs + ti.waitingMs || 1;
  const workPct = (ti.workingMs / total) * 100;
  return (
    <div className="timespent">
      <div className="ts-bar">
        <span className="ts-seg ts-work" style={{ width: workPct + "%" }} title={`working ${fmtDur(ti.workingMs)}`} />
        <span className="ts-seg ts-wait" style={{ width: (100 - workPct) + "%" }} title={`waiting ${fmtDur(ti.waitingMs)}`} />
      </div>
      <div className="ts-legend">
        <span><span className="ts-dot ts-work" /> agent working <b className="tnum">{fmtDur(ti.workingMs)}</b></span>
        <span><span className="ts-dot ts-wait" /> waiting on you <b className="tnum">{fmtDur(ti.waitingMs)}</b></span>
      </div>
      <div className="cachep-caption">"waiting on you" is the time between Claude finishing a turn and your next message — idle time, not work.</div>
      {ti.stalls.length ? (
        <div className="ts-stalls">
          {ti.stalls.map((s, i) => (
            <button key={i} type="button" className="ts-stall" onClick={() => onOpenMessage(s.msgUuid)}>
              <span className="ts-stall-dur tnum">{fmtDur(s.ms)}</span>
              <span className="ts-stall-lbl">paused after this turn → jump</span>
            </button>
          ))}
        </div>
      ) : null}
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

export function StatsView({ trace, onOpenAgent, onOpenMessage }: Props) {
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
        <Panel title="Prompt caching" span={2} sub={`${(s.cacheRatio * 100).toFixed(1)}% of input read from cache`}>
          <CachePanel trace={trace} onOpenMessage={onOpenMessage} />
        </Panel>

        <div className="stats-col">
          <Panel title="Cost & models" sub="by spend">
            <CostModels trace={trace} />
          </Panel>
          <Panel title="Where the time went" sub="working vs waiting · click a stall to jump">
            <TimeSpentPanel trace={trace} onOpenMessage={onOpenMessage} />
          </Panel>
        </div>
        <Panel title="Friction" sub="errors & interruptions">
          <FrictionPanel trace={trace} onOpenMessage={onOpenMessage} />
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
