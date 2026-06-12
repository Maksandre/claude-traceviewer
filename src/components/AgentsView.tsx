import { useCallback, useEffect, useMemo, useState } from "react";
import { agentColor, agentMeta, contextWindow, fmtCost, fmtDur, fmtTokens, modelColor, modelLabel } from "../lib/format";
import { Icons } from "../lib/icons";
import { CodeBlock, Markdown } from "../lib/md";
import type { NormAgent, NormTrace } from "../lib/normalize";

interface WorkflowGroup { name: string; runId: string; agents: NormAgent[] }

// Group agents by their parent (parentId === "" means spawned by main), so the
// delegation tree mirrors the real nesting: subagents that spawned their own
// subagents become parents of those children rather than peers under main.
function buildChildrenMap(agents: NormAgent[]): Map<string, NormAgent[]> {
  const m = new Map<string, NormAgent[]>();
  for (const a of agents) {
    const p = a.parentId || "";
    (m.get(p) ?? m.set(p, []).get(p)!).push(a);
  }
  return m;
}

function resolveWorkflowGroups(trace: NormTrace): WorkflowGroup[] {
  const byId = Object.fromEntries(trace.agents.map(a => [a.id, a]));
  return trace.workflows
    .map(w => ({ name: w.name || "workflow", runId: w.runId, agents: w.agentIds.map(id => byId[id]).filter(Boolean) }))
    .filter(g => g.agents.length > 0);
}
import { clearCachedPersona, getCachedPersona, pickPluginDirectory, type CachedPersona } from "../lib/personaCache";
import { Transcript, type ViewSettings } from "./conversation/Transcript";
import { ToolFilterStrip } from "./ToolFilterStrip";

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

// Renders the children of one tree node, recursing so each subagent's own
// subagents nest beneath it. `workflowGroups` is only passed at the top level
// (main's children) — workflow runs are launched by the main agent — and their
// agents are pulled out of the flat child list into a labelled group node.
function TreeBranch({ parentId, childrenOf, workflowGroups, selected, onSelect }: {
  parentId: string;
  childrenOf: Map<string, NormAgent[]>;
  workflowGroups: WorkflowGroup[];
  selected: string;
  onSelect: (k: string) => void;
}) {
  const wfAgentIds = new Set(workflowGroups.flatMap(g => g.agents.map(a => a.id)));
  const kids = (childrenOf.get(parentId) || []).filter(a => !wfAgentIds.has(a.id));
  if (!kids.length && !workflowGroups.length) return null;

  const renderNode = (a: NormAgent) => (
    <div className="tree-node-group" key={a.id}>
      <TreeNode
        kind="agent"
        nodeKey={"agent:" + a.id}
        agentType={a.agentType}
        description={a.description}
        usage={a.usage}
        durationMs={a.durationMs}
        toolCounts={a.toolCounts}
        selected={selected}
        depth={1}
        onSelect={onSelect}
      />
      <TreeBranch parentId={a.id} childrenOf={childrenOf} workflowGroups={[]} selected={selected} onSelect={onSelect} />
    </div>
  );

  return (
    <div className="tree-children">
      {kids.map(renderNode)}
      {workflowGroups.map(g => (
        <div className="tree-wf-group" key={g.runId}>
          <div className="tn-wrap depth-1">
            <span className="tn-elbow" />
            <div className="tree-wf-head" title={g.runId}>
              <span className="tree-wf-ic"><Icons.workflow size={13} /></span>
              <span className="tree-wf-name">{g.name}</span>
              <span className="tree-wf-count tnum">{g.agents.length}</span>
            </div>
          </div>
          <div className="tree-children tree-wf-children">
            {g.agents.map(renderNode)}
          </div>
        </div>
      ))}
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

export function AgentDetail({ agent, onOpenAgent, settings, allAgents }: { agent: NormAgent; onOpenAgent: (id: string) => void; settings: ViewSettings; allAgents?: NormAgent[] }) {
  // A global tool_use→agent map so this agent's own spawn cards (and their
  // descendants) resolve and expand inline. Every agent has a unique
  // toolUseId, so one flat map serves every nesting level.
  const agentsByToolUse = useMemo(() => {
    const m: Record<string, NormAgent> = {};
    for (const a of allAgents || []) if (a.toolUseId) m[a.toolUseId] = a;
    return m;
  }, [allAgents]);
  const children = useMemo(() => (allAgents || []).filter(a => a.parentId === agent.id), [allAgents, agent.id]);
  const [tab, setTab] = useState<"result" | "prompt" | "transcript">("result");
  const col = agentColor(agent.agentType);
  const tools = Object.values(agent.toolCounts).reduce((a, b) => a + b, 0);
  const u = agent.usage;
  // Tool filter state is freshly initialised on mount; call sites must
  // pass `key={agent.id}` so switching subagents remounts and clears it.
  const [toolFilter, setToolFilter] = useState<Set<string>>(() => new Set());
  const toggleTool = useCallback((name: string) => {
    // Filtering only changes the transcript tab; jump there on the first
    // toggle so the user sees the result of their click immediately.
    setTab("transcript");
    setToolFilter(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);
  const clearTool = useCallback(() => setToolFilter(new Set()), []);
  return (
    <div className="adetail fade-in">
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
        <StatPill icon={Icons.layers} label="peak ctx" value={`${fmtTokens(agent.peakContext)} / ${fmtTokens(contextWindow(agent.model))}`} color="var(--sonnet)" />
      </div>

      <div className="adetail-toolstrip">
        <span className="kv-label">tools used</span>
        <ToolFilterStrip
          counts={agent.toolCounts}
          selected={toolFilter}
          onToggle={toggleTool}
          onClear={clearTool}
        />
      </div>

      {children.length > 0 ? (
        <div className="adetail-children">
          <span className="kv-label">spawned {children.length} subagent{children.length === 1 ? "" : "s"}</span>
          <div className="deleg-list" style={{ marginTop: 8 }}>
            {children.map(c => <DelegItem key={c.id} agent={c} onSelect={(k) => onOpenAgent(k.slice(6))} />)}
          </div>
        </div>
      ) : null}

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
              agentsByToolUse={agentsByToolUse}
              onOpenAgent={onOpenAgent}
              settings={settings}
              toolFilter={toolFilter}
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

function DelegItem({ agent: a, onSelect, childrenOf }: { agent: NormAgent; onSelect: (k: string) => void; childrenOf?: Map<string, NormAgent[]> }) {
  const col = agentColor(a.agentType);
  const kids = childrenOf?.get(a.id) || [];
  return (
    <>
      <button className="deleg-item" style={{ "--ac": col } as React.CSSProperties} onClick={() => onSelect("agent:" + a.id)}>
        <span className="deleg-ic" style={{ color: col, background: `color-mix(in oklch, ${col} 16%, transparent)` }}>
          <Icons.agent size={15} />
        </span>
        <span className="deleg-body">
          <span className="deleg-type" style={{ color: col }}>{a.agentType}</span>
          <span className="deleg-desc">{a.description}</span>
        </span>
        <span className="deleg-meta tnum">
          <b>{fmtCost(a.usage.cost)}</b>
          <span>{fmtDur(a.durationMs)}{kids.length ? ` · ${kids.length} sub` : ""}</span>
        </span>
        <span className="deleg-go"><Icons.arrowRight size={14} /></span>
      </button>
      {kids.length ? (
        <div className="deleg-nested">
          {kids.map(c => <DelegItem key={c.id} agent={c} onSelect={onSelect} childrenOf={childrenOf} />)}
        </div>
      ) : null}
    </>
  );
}

function MainDetail({ trace, onSelect, onGotoConversation }: { trace: NormTrace; onSelect: (k: string) => void; onGotoConversation: () => void }) {
  const s = trace.session;
  const mainTools = Object.values(trace.main.toolCounts).reduce((a, b) => a + b, 0);
  const childrenOf = buildChildrenMap(trace.agents);
  const workflowGroups = resolveWorkflowGroups(trace);
  const wfAgentIds = new Set(workflowGroups.flatMap(g => g.agents.map(a => a.id)));
  const directKids = (childrenOf.get("") || []).filter(a => !wfAgentIds.has(a.id));
  const total = trace.agents.length;
  const direct = directKids.length + workflowGroups.length;
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
              {s.attributionSkill ? "running /" + s.attributionSkill : "orchestrator"} · delegated to {direct} subagent{direct === 1 ? "" : "s"}{total > direct ? ` (${total} total)` : ""}
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
        <StatPill icon={Icons.layers} label="peak ctx" value={`${fmtTokens(trace.main.peakContext)} / ${fmtTokens(contextWindow(trace.session.models[0]))}`} color="var(--sonnet)" />
        <StatPill icon={Icons.agent} label="subagents" value={trace.agents.length} color="var(--tool-agent)" />
      </div>
      <div className="adetail-toolstrip">
        <span className="kv-label">direct tool calls</span>
        <ToolFilterStrip counts={trace.main.toolCounts} />
      </div>
      <div className="delegation">
        <div className="kv-label" style={{ marginBottom: 10 }}>delegated work</div>
        <div className="deleg-list">
          {directKids.map(a => <DelegItem key={a.id} agent={a} onSelect={onSelect} childrenOf={childrenOf} />)}
          {workflowGroups.map(g => (
            <div className="deleg-wf-group" key={g.runId}>
              <div className="deleg-wf-head" title={g.runId}>
                <span className="deleg-wf-ic"><Icons.workflow size={13} /></span>
                <span className="deleg-wf-name">{g.name}</span>
                <span className="deleg-wf-count tnum">{g.agents.length} agents · {fmtCost(g.agents.reduce((acc, a) => acc + a.usage.cost, 0))}</span>
              </div>
              {g.agents.map(a => <DelegItem key={a.id} agent={a} onSelect={onSelect} childrenOf={childrenOf} />)}
            </div>
          ))}
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
  const childrenOf = useMemo(() => buildChildrenMap(trace.agents), [trace.agents]);
  const workflowGroups = useMemo(() => resolveWorkflowGroups(trace), [trace]);
  const directChildren = (childrenOf.get("") || []).length;

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
          <TreeBranch parentId="" childrenOf={childrenOf} workflowGroups={workflowGroups} selected={sel} onSelect={setSel} />
        </div>
        <div className="tree-rail-foot">
          <span>fan-out</span>
          <span className="tnum">{directChildren} direct</span>
        </div>
      </div>
      <div className="agent-detail-wrap">
        {sel === "main" || !selectedAgent
          ? <MainDetail trace={trace} onSelect={setSel} onGotoConversation={onGotoConversation} />
          : <AgentDetail key={selectedAgent.id} agent={selectedAgent} onOpenAgent={onOpenAgent} settings={settings} allAgents={trace.agents} />}
      </div>
    </div>
  );
}
