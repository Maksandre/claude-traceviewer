import { useEffect, useMemo, useState } from "react";
import { agentColor, agentMeta, fmtCost, fmtDur, fmtTokens, modelColor, modelLabel, toolColor } from "../lib/format";
import { Icons, toolIcon } from "../lib/icons";
import { CodeBlock, Markdown } from "../lib/md";
import type { NormAgent, NormTrace } from "../lib/normalize";
import { clearCachedPersona, getCachedPersona, pickPluginDirectory, type CachedPersona } from "../lib/personaCache";
import { Transcript, type ViewSettings } from "./conversation/Transcript";

interface Props {
  trace: NormTrace;
  settings: ViewSettings;
  onGotoConversation: () => void;
  focusAgentId?: string | null;
  clearFocus?: () => void;
}

interface TreeNodeProps {
  kind: "main" | "agent";
  nodeKey: string;
  agentType?: string;
  description?: string;
  subtitle?: string;
  usage: { cost: number };
  durationMs: number;
  toolCounts: Record<string, number>;
  selected: string;
  depth: number;
  onSelect: (k: string) => void;
}

function TreeNode({ kind, nodeKey, agentType, description, subtitle, usage, durationMs, toolCounts, selected, depth, onSelect }: TreeNodeProps) {
  const isMain = kind === "main";
  const hue = isMain ? 18 : agentMeta(agentType || "").hue;
  const col = `oklch(0.70 0.12 ${hue})`;
  const active = selected === nodeKey;
  const tools = Object.values(toolCounts || {}).reduce((a, b) => a + b, 0);
  return (
    <div className={"tn-wrap depth-" + depth}>
      {depth > 0 ? <span className="tn-elbow" /> : null}
      <button
        className={"tnode " + (active ? "active" : "")}
        style={{ "--ac": col } as React.CSSProperties}
        onClick={() => onSelect(nodeKey)}
      >
        <span className="tnode-ic" style={{ color: col, background: `color-mix(in oklch, ${col} 16%, transparent)` }}>
          {isMain ? <Icons.spark size={14} /> : <Icons.agent size={14} />}
        </span>
        <span className="tnode-main">
          <span className="tnode-title">{isMain ? "main agent" : agentType}</span>
          <span className="tnode-desc">{isMain ? subtitle : description}</span>
        </span>
        <span className="tnode-meta tnum">
          <span className="tnode-cost">{fmtCost(usage.cost)}</span>
          <span className="tnode-sub">{fmtDur(durationMs)} · {tools}t</span>
        </span>
      </button>
    </div>
  );
}

function StatPill({ icon: Ic, label, value, color }: { icon: (p?: { size?: number }) => React.ReactElement; label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="statpill">
      <span className="statpill-ic" style={color ? { color } : undefined}><Ic size={14} /></span>
      <span className="statpill-body">
        <span className="statpill-val tnum" style={color ? { color } : undefined}>{value}</span>
        <span className="statpill-label">{label}</span>
      </span>
    </div>
  );
}

function ToolCountStrip({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <span className="mono" style={{ color: "var(--tx-3)", fontSize: 12 }}>no tool calls</span>;
  return (
    <div className="toolcounts">
      {entries.map(([n, c]) => {
        const TI = toolIcon(n);
        const col = toolColor(n);
        return (
          <span key={n} className="tcount" style={{ "--tc": col } as React.CSSProperties}>
            <TI size={12} />{n}<b className="tnum">{c}</b>
          </span>
        );
      })}
    </div>
  );
}

export function AgentDetail({ agent, onOpenAgent, settings }: { agent: NormAgent; onOpenAgent: (id: string) => void; settings: ViewSettings }) {
  const [tab, setTab] = useState<"result" | "prompt" | "transcript">("result");
  const col = agentColor(agent.agentType);
  const tools = Object.values(agent.toolCounts).reduce((a, b) => a + b, 0);
  const u = agent.usage;
  return (
    <div className="adetail fade-in" key={agent.id}>
      <div className="adetail-head">
        <div className="adetail-title">
          <span className="adetail-ic" style={{ color: col, background: `color-mix(in oklch, ${col} 16%, transparent)` }}>
            <Icons.agent size={20} />
          </span>
          <div>
            <div className="adetail-type" style={{ color: col }}>{agent.agentType}</div>
            <div className="adetail-desc">{agent.description}</div>
          </div>
        </div>
        <div className="adetail-id">
          <span className="model-badge" style={{ "--mc": modelColor(agent.model) } as React.CSSProperties}>
            <span className="model-dot" />{modelLabel(agent.model)}
          </span>
          <span className="aid">id {agent.id.slice(0, 10)}</span>
        </div>
      </div>

      <div className="adetail-stats">
        <StatPill icon={Icons.coins} label="total cost" value={fmtCost(u.cost)} color="var(--accent)" />
        <StatPill icon={Icons.clock} label="duration" value={fmtDur(agent.durationMs)} />
        <StatPill icon={Icons.layers} label="messages" value={agent.msgCount} />
        <StatPill icon={Icons.terminal} label="tool calls" value={tools} />
        <StatPill icon={Icons.hash} label="output tok" value={fmtTokens(u.output)} color="var(--tx-1)" />
        <StatPill icon={Icons.refresh} label="cache read" value={fmtTokens(u.cr)} color="var(--sonnet)" />
      </div>

      <div className="adetail-toolstrip">
        <span className="kv-label">tools used</span>
        <ToolCountStrip counts={agent.toolCounts} />
      </div>

      <div className="adetail-tabs">
        {(["result", "prompt", "transcript"] as const).map(t => (
          <button key={t} className={"atab " + (tab === t ? "active" : "")} onClick={() => setTab(t)}>
            {t === "result" ? "Result" : t === "prompt" ? "Prompt" : "Transcript"}
            {t === "transcript" ? <span className="atab-count tnum">{agent.messages.length}</span> : null}
          </button>
        ))}
      </div>

      <div className="adetail-pane">
        {tab === "result" ? <div className="result-card"><Markdown text={agent.result || "_No textual result captured._"} /></div> : null}
        {tab === "prompt" ? (
          <div className="prompt-card">
            <PersonaSection agent={agent} />
            <CodeBlock code={agent.prompt} max={1000} />
          </div>
        ) : null}
        {tab === "transcript" ? (
          <div className="adetail-transcript">
            <Transcript
              messages={agent.messages}
              toolResults={agent.toolResults}
              agentsByToolUse={{}}
              onOpenAgent={onOpenAgent}
              settings={settings}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PersonaSection({ agent }: { agent: NormAgent }) {
  const [cached, setCached] = useState<CachedPersona | null>(() => getCachedPersona(agent.agentType));
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Reset state whenever the agent changes (when user switches subagents in the drawer).
  useEffect(() => {
    setCached(getCachedPersona(agent.agentType));
    setNotice(null);
  }, [agent.agentType]);

  const onPick = async () => {
    setPicking(true);
    setNotice(null);
    try {
      const result = await pickPluginDirectory();
      if (result.cancelled) return;
      const hit = result.added.find((a) => a.agentType === agent.agentType);
      if (hit) {
        setCached(getCachedPersona(agent.agentType));
        setNotice(`loaded ${result.added.length} agent${result.added.length === 1 ? "" : "s"} from the picked directory`);
      } else if (result.added.length > 0) {
        setNotice(`loaded ${result.added.length} agent${result.added.length === 1 ? "" : "s"}, but none matched ${agent.agentType}`);
      } else {
        setNotice("no agent definitions (*.md under agents/) found in this directory");
      }
    } finally {
      setPicking(false);
    }
  };

  const onClear = () => {
    clearCachedPersona(agent.agentType);
    setCached(null);
    setNotice(null);
  };

  // 1. Server resolved the persona — show as-is.
  if (agent.persona) {
    return (
      <details className="persona-block">
        <summary>
          <span className="persona-label">persona</span>
          <span className="persona-path" title={agent.persona.resolvedPath}>{agent.persona.resolvedPath}</span>
        </summary>
        <div className="persona-body"><CodeBlock code={agent.persona.content} max={1000} /></div>
      </details>
    );
  }

  // 2. Loaded from the client cache via a previous pick.
  if (cached) {
    return (
      <details className="persona-block">
        <summary>
          <span className="persona-label">persona <span className="persona-cache-tag">cached</span></span>
          <span className="persona-path" title={cached.sourceRelPath}>{cached.sourceRelPath}</span>
          <button type="button" className="persona-clear" onClick={(e) => { e.preventDefault(); onClear(); }} title="forget this cached persona">×</button>
        </summary>
        <div className="persona-body"><CodeBlock code={cached.content} max={1000} /></div>
      </details>
    );
  }

  // 3. Nothing resolved — offer the pick button.
  return (
    <div className="persona-empty">
      <div className="persona-empty-head">
        <span className="persona-label">persona</span>
        <span className="persona-empty-msg">not found for <code>{agent.agentType}</code></span>
      </div>
      <button type="button" className="persona-pick-btn" onClick={onPick} disabled={picking}>
        {picking ? "loading…" : "load plugin directory…"}
      </button>
      {notice ? <div className="persona-notice">{notice}</div> : null}
      <div className="persona-empty-hint">
        pick the directory that contains <code>agents/{agent.agentType.includes(":") ? agent.agentType.split(":")[1] : agent.agentType}.md</code> (or any ancestor of it). cached in your browser; you only need to do this once per source.
      </div>
    </div>
  );
}

function MainDetail({ trace, onSelect, onGotoConversation }: { trace: NormTrace; onSelect: (k: string) => void; onGotoConversation: () => void }) {
  const s = trace.session;
  const mainTools = Object.values(trace.main.toolCounts).reduce((a, b) => a + b, 0);
  return (
    <div className="adetail fade-in">
      <div className="adetail-head">
        <div className="adetail-title">
          <span className="adetail-ic" style={{ color: "var(--accent)", background: "var(--accent-soft)" }}>
            <Icons.spark size={20} />
          </span>
          <div>
            <div className="adetail-type" style={{ color: "var(--accent)" }}>main agent</div>
            <div className="adetail-desc">
              {s.attributionSkill ? "running /" + s.attributionSkill : "orchestrator"} · delegated to {trace.agents.length} subagents
            </div>
          </div>
        </div>
        <div className="adetail-id">
          {s.models[0] ? (
            <span className="model-badge" style={{ "--mc": modelColor(s.models[0]) } as React.CSSProperties}>
              <span className="model-dot" />{modelLabel(s.models[0])}
            </span>
          ) : null}
        </div>
      </div>
      <div className="adetail-stats">
        <StatPill icon={Icons.coins} label="main cost" value={fmtCost(trace.main.usage.cost)} color="var(--accent)" />
        <StatPill icon={Icons.clock} label="session" value={fmtDur(s.durationMs)} />
        <StatPill icon={Icons.terminal} label="direct tools" value={mainTools} />
        <StatPill icon={Icons.agent} label="subagents" value={trace.agents.length} color="var(--tool-agent)" />
      </div>
      <div className="adetail-toolstrip">
        <span className="kv-label">direct tool calls</span>
        <ToolCountStrip counts={trace.main.toolCounts} />
      </div>
      <div className="delegation">
        <div className="kv-label" style={{ marginBottom: 10 }}>delegated work</div>
        <div className="deleg-list">
          {trace.agents.map(a => {
            const col = agentColor(a.agentType);
            return (
              <button key={a.id} className="deleg-item" style={{ "--ac": col } as React.CSSProperties} onClick={() => onSelect("agent:" + a.id)}>
                <span className="deleg-ic" style={{ color: col, background: `color-mix(in oklch, ${col} 16%, transparent)` }}>
                  <Icons.agent size={15} />
                </span>
                <span className="deleg-body">
                  <span className="deleg-type" style={{ color: col }}>{a.agentType}</span>
                  <span className="deleg-desc">{a.description}</span>
                </span>
                <span className="deleg-meta tnum">
                  <b>{fmtCost(a.usage.cost)}</b>
                  <span>{fmtDur(a.durationMs)}</span>
                </span>
                <span className="deleg-go"><Icons.arrowRight size={14} /></span>
              </button>
            );
          })}
          {trace.agents.length === 0 ? <div className="empty">no subagents in this session</div> : null}
        </div>
      </div>
      <button className="goto-conv" onClick={onGotoConversation}>
        <Icons.chat size={15} /> Open full conversation transcript
      </button>
    </div>
  );
}

export function AgentsView({ trace, settings, onGotoConversation, focusAgentId, clearFocus }: Props) {
  const [sel, setSel] = useState<string>("main");
  useEffect(() => {
    if (focusAgentId) {
      setSel("agent:" + focusAgentId);
      clearFocus?.();
    }
  }, [focusAgentId, clearFocus]);
  const agentsById = useMemo(() => Object.fromEntries(trace.agents.map(a => [a.id, a])), [trace]);

  const onOpenAgent = (id: string) => setSel("agent:" + id);
  const selectedAgent = sel.startsWith("agent:") ? agentsById[sel.slice(6)] : undefined;

  return (
    <div className="agents-view">
      <div className="tree-rail">
        <div className="tree-rail-head">
          <span className="rail-title">Delegation tree</span>
          <span className="rail-sub">{trace.agents.length + 1} agents</span>
        </div>
        <div className="tree-scroll">
          <TreeNode
            kind="main"
            nodeKey="main"
            subtitle={trace.session.attributionSkill ? "/" + trace.session.attributionSkill : "orchestrator"}
            usage={trace.main.usage}
            durationMs={trace.session.durationMs}
            toolCounts={trace.main.toolCounts}
            selected={sel}
            depth={0}
            onSelect={setSel}
          />
          <div className="tree-children">
            {trace.agents.map(a => (
              <TreeNode
                key={a.id}
                kind="agent"
                nodeKey={"agent:" + a.id}
                agentType={a.agentType}
                description={a.description}
                usage={a.usage}
                durationMs={a.durationMs}
                toolCounts={a.toolCounts}
                selected={sel}
                depth={1}
                onSelect={setSel}
              />
            ))}
          </div>
        </div>
        <div className="tree-rail-foot">
          <span>fan-out</span>
          <span className="tnum">{trace.agents.length} parallel</span>
        </div>
      </div>
      <div className="agent-detail-wrap">
        {sel === "main" || !selectedAgent
          ? <MainDetail trace={trace} onSelect={setSel} onGotoConversation={onGotoConversation} />
          : <AgentDetail agent={selectedAgent} onOpenAgent={onOpenAgent} settings={settings} />}
      </div>
    </div>
  );
}
