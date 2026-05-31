import { useMemo } from "react";
import { agentColor, agentMeta, fmtClock, fmtCost, fmtDur, fmtTokens, modelColor, modelLabel, toolColor } from "../lib/format";
import { Icons, toolIcon } from "../lib/icons";
import { Bar } from "../lib/md";
import type { NormTrace } from "../lib/normalize";

interface Props { trace: NormTrace; onOpenAgent: (id: string) => void; }

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

function Donut({ pct, color, label, center }: { pct: number; color: string; label: string; center: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="donut">
      <svg viewBox="0 0 100 100" width="118" height="118">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--bg-3)" strokeWidth="11" />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)" }}
        />
        <text x="50" y="47" textAnchor="middle" className="donut-pct">{center}</text>
        <text x="50" y="62" textAnchor="middle" className="donut-lbl">{label}</text>
      </svg>
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

function ToolFreq({ freq }: { freq: Record<string, number> }) {
  const entries = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(e => e[1]), 1);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (entries.length === 0) return <div className="empty">no tool calls</div>;
  return (
    <div>
      <div className="toolfreq-total">{total} total tool calls across session</div>
      {entries.map(([name, count]) => {
        const TI = toolIcon(name);
        const col = toolColor(name);
        return (
          <div className="tf-row" key={name}>
            <span className="tf-name"><span className="tf-ic" style={{ color: col }}><TI size={13} /></span>{name}</span>
            <span><Bar pct={count / max} color={col} h={8} /></span>
            <span className="tf-count tnum">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

function AgentTable({ trace, onOpen }: { trace: NormTrace; onOpen: (id: string) => void }) {
  const rows = [
    { id: null as string | null, name: "main agent", type: "orchestrator", model: trace.session.models[0] || "", u: trace.main.usage,
      tools: Object.values(trace.main.toolCounts).reduce((a, b) => a + b, 0), dur: trace.session.durationMs, isMain: true },
    ...trace.agents.map(a => ({
      id: a.id, name: a.agentType, type: a.agentType, model: a.model, u: a.usage,
      tools: Object.values(a.toolCounts).reduce((a2, b) => a2 + b, 0), dur: a.durationMs, isMain: false,
    })),
  ];
  const maxCost = Math.max(...rows.map(r => r.u.cost), 0.001);
  return (
    <div className="atable">
      <div className="atable-head">
        <span>agent</span><span>model</span><span className="r">tokens</span><span className="r">tools</span><span className="r">time</span><span className="r">cost</span>
      </div>
      {rows.map((r, i) => {
        const hue = r.isMain ? 18 : agentMeta(r.type).hue;
        const col = `oklch(0.70 0.12 ${hue})`;
        const totTok = r.u.input + r.u.output + r.u.cw + r.u.cr;
        return (
          <button
            key={i}
            className={"atable-row " + (r.isMain ? "is-main" : "")}
            onClick={() => !r.isMain && r.id && onOpen(r.id)}
            disabled={r.isMain}
          >
            <span className="at-name">
              <span className="at-dot" style={{ background: col }} />
              <span className="at-type">{r.name}</span>
            </span>
            <span className="at-model" style={{ color: modelColor(r.model) }}>{modelLabel(r.model)}</span>
            <span className="r tnum at-tok">{fmtTokens(totTok)}</span>
            <span className="r tnum">{r.tools}</span>
            <span className="r tnum">{fmtDur(r.dur)}</span>
            <span className="r at-cost">
              <span className="at-costbar"><Bar pct={r.u.cost / maxCost} color="var(--accent)" h={5} track={false} /></span>
              <span className="mono tnum">{fmtCost(r.u.cost)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Timeline({ trace }: { trace: NormTrace }) {
  const start = trace.session.startedAt ? new Date(trace.session.startedAt).getTime() : 0;
  const end = trace.session.endedAt ? new Date(trace.session.endedAt).getTime() : start + 1;
  const span = Math.max(end - start, 1);
  const rows = [
    { name: "main", isMain: true, s: 0, e: span, col: "var(--accent)", dur: span, desc: "main" },
    ...trace.agents.map(a => ({
      name: a.agentType.replace("qa:", ""),
      isMain: false,
      s: a.startedAt ? new Date(a.startedAt).getTime() - start : 0,
      e: a.endedAt ? new Date(a.endedAt).getTime() - start : 0,
      col: agentColor(a.agentType),
      dur: a.durationMs,
      desc: a.description,
    })),
  ];
  const ticks = 5;
  return (
    <div className="timeline">
      <div className="tl-axis">
        {Array.from({ length: ticks + 1 }).map((_, i) => (
          <span key={i} className="tl-tick" style={{ left: (i / ticks * 100) + "%" }}>{fmtDur(span * i / ticks)}</span>
        ))}
      </div>
      <div className="tl-rows">
        {rows.map((r, i) => (
          <div className="tl-row" key={i}>
            <span className="tl-label" style={{ color: r.col }}>{r.isMain ? "main" : r.name}</span>
            <span className="tl-track">
              <span
                className="tl-bar"
                style={{
                  left: (r.s / span * 100) + "%",
                  width: Math.max((r.e - r.s) / span * 100, 1.5) + "%",
                  background: r.col,
                  opacity: r.isMain ? 0.28 : 0.9,
                }}
                title={r.desc}
              >
                {!r.isMain ? <span className="tl-bar-dur">{fmtDur(r.dur)}</span> : null}
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="tl-foot">subagents launched in parallel · total wall-clock {fmtDur(span)}</div>
    </div>
  );
}

export function StatsView({ trace, onOpenAgent }: Props) {
  const s = trace.stats;
  const sess = trace.session;
  const totTok = useMemo(() => s.totals.input + s.totals.output + s.totals.cw + s.totals.cr, [s.totals]);
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
        <Panel title="Cache efficiency" sub="reads vs fresh input">
          <div className="cache-row">
            <Donut pct={s.cacheRatio} color="var(--sonnet)" center={(s.cacheRatio * 100).toFixed(0) + "%"} label="cached" />
            <div className="cache-legend">
              <div className="cl-item"><span className="cl-dot" style={{ background: "var(--sonnet)" }} /><span>Cache read</span><b className="tnum">{fmtTokens(s.totals.cr)}</b></div>
              <div className="cl-item"><span className="cl-dot" style={{ background: "var(--warn)" }} /><span>Cache write</span><b className="tnum">{fmtTokens(s.totals.cw)}</b></div>
              <div className="cl-item"><span className="cl-dot" style={{ background: "var(--tx-2)" }} /><span>Fresh input</span><b className="tnum">{fmtTokens(s.totals.input)}</b></div>
              <div className="cl-note">{(s.cacheRatio * 100).toFixed(1)}% of context served from cache — major cost saver on long runs.</div>
            </div>
          </div>
        </Panel>

        <Panel title="Model mix" sub="by token volume">
          <ModelMix mix={s.modelMix} />
        </Panel>

        <Panel title="Tool usage frequency" span={2}>
          <ToolFreq freq={s.toolFreq} />
        </Panel>

        <Panel title="Per-agent breakdown" span={2} sub="click a row to inspect">
          <AgentTable trace={trace} onOpen={onOpenAgent} />
        </Panel>

        {trace.agents.length > 0 ? (
          <Panel title="Execution timeline" span={2} sub="parallel fan-out">
            <Timeline trace={trace} />
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
