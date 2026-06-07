import { useEffect, useMemo, useRef, useState } from "react";
import { agentMeta, fmtCost, fmtDur, fmtTime, modelColor, modelFamily, modelLabel } from "../../lib/format";
import { Icons } from "../../lib/icons";
import { Caret, UsageChips } from "../../lib/md";
import type { NormAgent, NormBlock, NormMsg, NormToolResult } from "../../lib/normalize";
import { AskUserQuestionCard, TaskCreateCard, TaskGenericCard, TaskUpdateCard, ThinkingBlock, ToolCard, UserGroup, UserMessage, isUserTaskNotification, type TaskSnapshot } from "./blocks";

export interface ViewSettings { expandThinking: boolean; expandTools: boolean; }

export interface Group {
  kind: "user" | "user-tasknote" | "assistant";
  key: string;
  msg?: NormMsg;
  msgs?: NormMsg[];
  model?: string;
}

function buildGroups(messages: NormMsg[]): Group[] {
  const groups: Group[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      if (isUserTaskNotification(m)) {
        groups.push({ kind: "user-tasknote", msg: m, key: m.uuid });
        continue;
      }
      const last = groups[groups.length - 1];
      if (last && last.kind === "user") {
        last.msgs!.push(m);
      } else {
        groups.push({ kind: "user", msgs: [m], key: m.uuid });
      }
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && last.kind === "assistant" && last.model === m.model) {
      last.msgs!.push(m);
    } else {
      groups.push({ kind: "assistant", model: m.model, msgs: [m], key: m.uuid });
    }
  }
  return groups;
}

function sumUsage(msgs: NormMsg[]) {
  return msgs.reduce((a, m) => ({
    input: a.input + m.usage.input,
    output: a.output + m.usage.output,
    cw: a.cw + m.usage.cw,
    cr: a.cr + m.usage.cr,
    cost: a.cost + m.usage.cost,
  }), { input: 0, output: 0, cw: 0, cr: 0, cost: 0 });
}

// True when this block's own content (or, for spawn blocks, its subagent)
// contains the active query. Text/thinking blocks always count as visible —
// hiding the model's narration around a tool call would strip the context
// readers need to make sense of the match.
function blockMatchesQuery(
  b: NormBlock,
  getResult: (id: string) => NormToolResult | undefined,
  agentsByToolUse: Record<string, NormAgent>,
  forceExpandedAgents: Set<string> | undefined,
  q: string,
): boolean {
  if (!q) return true;
  if (b.type === "text" || b.type === "thinking") return true;
  if (b.type !== "tool_use") return true;
  if ((b.name === "Agent" || b.name === "Task") && b.id) {
    const agent = agentsByToolUse[b.id];
    if (agent && forceExpandedAgents?.has(agent.id)) return true;
  }
  if (b.name && b.name.toLowerCase().includes(q)) return true;
  if (b.input && JSON.stringify(b.input).toLowerCase().includes(q)) return true;
  const r = b.id ? getResult(b.id) : undefined;
  if (r) {
    const c = r.content;
    let s = "";
    if (typeof c === "string") s = c;
    else if (Array.isArray(c)) {
      for (const part of c) {
        if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
          const t = (part as { text?: string }).text;
          if (typeof t === "string") s += t;
        }
      }
    }
    if (s.toLowerCase().includes(q)) return true;
  }
  return false;
}

function Blocks({ blocks, getResult, agentsByToolUse, onOpenAgent, settings, taskStateById, query, forceExpandedAgents }: {
  blocks: NormBlock[];
  getResult: (id: string) => NormToolResult | undefined;
  agentsByToolUse: Record<string, NormAgent>;
  onOpenAgent: (id: string) => void;
  settings: ViewSettings;
  taskStateById: Map<string, TaskSnapshot[]>;
  query?: string;
  forceExpandedAgents?: Set<string>;
}) {
  const q = (query || "").trim().toLowerCase();
  const showAll = q.length < 3;
  let hidden = 0;
  const rendered: React.ReactNode[] = [];
  blocks.forEach((b, i) => {
    if (!showAll && !blockMatchesQuery(b, getResult, agentsByToolUse, forceExpandedAgents, q)) {
      hidden++;
      return;
    }
    if (b.type === "text") {
      if (b.text?.trim()) rendered.push(<div className="blk text" key={i}><div className="md"><Markdown text={b.text} /></div></div>);
      return;
    }
    if (b.type === "thinking") {
      rendered.push(<ThinkingBlock key={i} text={b.thinking || ""} defaultOpen={settings.expandThinking} />);
      return;
    }
    if (b.type === "tool_use") {
      if (b.name === "Agent" || b.name === "Task") {
        const agent = b.id ? agentsByToolUse[b.id] : undefined;
        const force = !!(agent && forceExpandedAgents?.has(agent.id));
        rendered.push(
          <AgentSpawnCard
            key={i}
            block={b}
            agent={agent}
            onOpen={onOpenAgent}
            settings={settings}
            query={query}
            forceExpanded={force}
          />,
        );
        return;
      }
      const tasks = b.id ? taskStateById.get(b.id) || [] : [];
      if (b.name === "TaskCreate") { rendered.push(<TaskCreateCard key={i} block={b} result={b.id ? getResult(b.id) : undefined} tasks={tasks} />); return; }
      if (b.name === "TaskUpdate") { rendered.push(<TaskUpdateCard key={i} block={b} result={b.id ? getResult(b.id) : undefined} tasks={tasks} />); return; }
      if (b.name === "AskUserQuestion") { rendered.push(<AskUserQuestionCard key={i} block={b} result={b.id ? getResult(b.id) : undefined} />); return; }
      if (b.name && b.name.startsWith("Task")) { rendered.push(<TaskGenericCard key={i} block={b} result={b.id ? getResult(b.id) : undefined} tasks={tasks} defaultOpen={settings.expandTools} />); return; }
      rendered.push(<ToolCard key={i} block={b} result={b.id ? getResult(b.id) : undefined} defaultOpen={settings.expandTools} />);
    }
  });
  return (
    <>
      {rendered}
      {hidden > 0 ? (
        <div className="blk-hidden" title={`${hidden} non-matching tool call${hidden === 1 ? "" : "s"} hidden by the search filter`}>
          + {hidden} hidden tool call{hidden === 1 ? "" : "s"}
        </div>
      ) : null}
    </>
  );
}

// Spawn card. Renders the subagent's transcript inline when expanded; the
// `→` button still opens the side drawer. When the parent transcript is
// filtering by a query and this subagent's transcript contained a hit,
// `forceExpanded` is set so the card opens automatically — and we pass the
// query into the inner Transcript so it filters to just the matching lines.
function AgentSpawnCard({ block, agent, onOpen, settings, query, forceExpanded }: {
  block: NormBlock;
  agent?: NormAgent;
  onOpen: (id: string) => void;
  settings?: ViewSettings;
  query?: string;
  forceExpanded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expandable = !!agent && agent.messages.length > 0;
  const expanded = expandable && (open || !!forceExpanded);
  const type = (block.input?.subagent_type as string) || (agent?.agentType || "agent");
  const hue = agent ? agentMeta(agent.agentType).hue : agentMeta(type).hue;
  const col = `oklch(0.70 0.12 ${hue})`;
  const modelStr = agent ? agent.model : (block.input?.model as string | undefined);
  return (
    <div className={"agent-spawn fade-in " + (expanded ? "is-expanded " : "") + (!agent ? "is-pending" : "")} style={{ "--ac": col } as React.CSSProperties}>
      <div
        className="agent-spawn-row"
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        onClick={() => expandable && setOpen(o => !o)}
        onKeyDown={(e) => {
          if (!expandable) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); }
        }}
      >
        <span className="agent-spawn-ic" style={{ color: col, background: `color-mix(in oklch, ${col} 16%, transparent)` }}>
          <Icons.agent size={16} />
        </span>
        <div className="agent-spawn-main">
          <div className="agent-spawn-top">
            <span className="agent-spawn-type" style={{ color: col }}>{type}</span>
            {modelStr ? (
              <span className="model-badge sm" style={{ "--mc": modelColor(modelStr) } as React.CSSProperties}>
                <span className="model-dot" />{modelLabel(modelStr)}
              </span>
            ) : null}
            <span className="agent-spawn-arrow">Subagent</span>
          </div>
          <div className="agent-spawn-desc">{block.input?.description || ""}</div>
          {agent ? (
            <div className="agent-spawn-stats">
              <span><Icons.layers size={11} /> {agent.msgCount} msgs</span>
              <span><Icons.terminal size={11} /> {Object.values(agent.toolCounts).reduce((a, b) => a + b, 0)} tools</span>
              <span><Icons.clock size={11} /> {fmtDur(agent.durationMs)}</span>
              <span style={{ color: "var(--accent)" }}>{fmtCost(agent.usage.cost)}</span>
            </div>
          ) : null}
        </div>
        {expandable ? (
          <div className="agent-spawn-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="agent-spawn-expand"
              onClick={() => setOpen(o => !o)}
              disabled={!!forceExpanded}
              aria-expanded={expanded}
              title={forceExpanded ? "Auto-expanded — clear the search to hide" : expanded ? "Hide transcript" : "Show transcript inline"}
            >
              <Caret open={expanded} />
              <span>{expanded ? "hide" : "expand"}</span>
            </button>
            <button
              type="button"
              className="agent-spawn-go"
              onClick={() => onOpen(agent!.id)}
              title="Open in side panel"
              aria-label="Open subagent details"
            >
              <Icons.arrowRight size={15} />
            </button>
          </div>
        ) : null}
      </div>
      {expanded && agent && settings ? (
        <div className="agent-spawn-transcript">
          <Transcript
            messages={agent.messages}
            toolResults={agent.toolResults}
            agentsByToolUse={{}}
            onOpenAgent={onOpen}
            settings={settings}
            query={query}
          />
        </div>
      ) : null}
    </div>
  );
}

function AssistantGroup({ group, getResult, agentsByToolUse, onOpenAgent, settings, taskStateById, query, forceExpandedAgents, extraClass = "" }: {
  group: Group;
  getResult: (id: string) => NormToolResult | undefined;
  agentsByToolUse: Record<string, NormAgent>;
  onOpenAgent: (id: string) => void;
  settings: ViewSettings;
  taskStateById: Map<string, TaskSnapshot[]>;
  query?: string;
  forceExpandedAgents?: Set<string>;
  extraClass?: string;
}) {
  const msgs = group.msgs!;
  const fam = modelFamily(group.model);
  const usage = sumUsage(msgs);
  const skill = msgs.find(m => m.attributionSkill)?.attributionSkill;
  const lastStop = msgs[msgs.length - 1].stopReason;
  const steps = msgs.length;
  const allBlocks = msgs.flatMap(m => m.blocks);
  return (
    <div className={"msg asst " + (extraClass || "fade-in")} style={{ "--mc": `var(--${fam})` } as React.CSSProperties}>
      <div className="msg-gutter">
        <span className="gutter-anchor">
          <span className="role-dot asst-dot">
            <Icons.spark size={12} />
          </span>
          <span className="gutter-label asst">{modelLabel(group.model)}</span>
        </span>
        <span className="gutter-line" />
      </div>
      <div className="msg-main">
        <div className="msg-head">
          {steps > 1 ? <span className="steps-badge tnum" title={steps + " model turns combined"}>{steps} steps</span> : null}
          {skill ? <span className="skill-badge">{skill}</span> : null}
          <span className="msg-time">{fmtTime(msgs[0].ts)}</span>
          {lastStop && lastStop !== "end_turn" && lastStop !== "tool_use" ? <span className="stop-badge">{lastStop}</span> : null}
          <span className="msg-head-spacer" />
          <UsageChips u={usage} compact />
          {usage.cost > 0 ? <span className="msg-cost tnum">{fmtCost(usage.cost)}</span> : null}
        </div>
        <div className="msg-blocks">
          <Blocks blocks={allBlocks} getResult={getResult} agentsByToolUse={agentsByToolUse} onOpenAgent={onOpenAgent} settings={settings} taskStateById={taskStateById} query={query} forceExpandedAgents={forceExpandedAgents} />
        </div>
      </div>
    </div>
  );
}

function resultToText(content: NormToolResult["content"] | undefined): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b: any) => b?.type === "text" ? (b.text || "") : "").join("\n");
  return "";
}

function buildTaskStateById(messages: NormMsg[], toolResults: Record<string, NormToolResult>): Map<string, TaskSnapshot[]> {
  const snapshots = new Map<string, TaskSnapshot[]>();
  const state = new Map<string, TaskSnapshot>();
  let pendingCounter = 0;
  const order: string[] = [];

  for (const msg of messages) {
    for (const b of msg.blocks) {
      if (b.type !== "tool_use") continue;
      const name = b.name || "";
      if (!name.startsWith("Task") || name === "Task") continue;
      const input = (b.input || {}) as Record<string, unknown>;

      if (name === "TaskCreate") {
        const subject = String(input.subject || input.title || "");
        const description = String(input.description || "");
        const activeForm = String(input.activeForm || "");
        const result = b.id ? toolResults[b.id] : undefined;
        const rt = resultToText(result?.content);
        const m = rt.match(/Task\s*#(\d+)/i);
        const id = m ? m[1] : `?${++pendingCounter}`;
        if (!state.has(id)) order.push(id);
        state.set(id, { id, subject, description, activeForm, status: "pending" });
      } else if (name === "TaskUpdate") {
        const id = String(input.taskId ?? "");
        const status = String(input.status || "");
        const existing = state.get(id);
        if (existing) {
          state.set(id, { ...existing, status: status || existing.status });
        } else if (id) {
          state.set(id, { id, subject: "", description: "", activeForm: "", status });
          order.push(id);
        }
      } else if (name === "TaskDelete" || name === "TaskRemove") {
        const id = String(input.taskId ?? "");
        if (state.delete(id)) {
          const ix = order.indexOf(id);
          if (ix >= 0) order.splice(ix, 1);
        }
      }

      if (b.id) {
        const snap = order
          .map(id => state.get(id))
          .filter((t): t is TaskSnapshot => !!t)
          .sort((a, b) => {
            const an = Number(a.id), bn = Number(b.id);
            if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
            return a.id.localeCompare(b.id);
          })
          .map(t => ({ ...t }));
        snapshots.set(b.id, snap);
      }
    }
  }
  return snapshots;
}

export function LiveTail({ live }: { live: boolean }) {
  return (
    <div className={"live-tail " + (live ? "is-live" : "")} aria-label={live ? "Watching for new messages" : "Paused"}>
      <span /><span /><span />
    </div>
  );
}

export function ConversationEnd() {
  return (
    <div className="conv-end" aria-label="End of conversation">
      <span className="conv-end-line" />
      <span className="conv-end-label"><Icons.check size={12} /> end of conversation</span>
      <span className="conv-end-line" />
    </div>
  );
}

export interface TranscriptModel {
  groups: Group[];
  filtered: Group[];
  forceExpandedAgents: Set<string>;
  taskStateById: Map<string, TaskSnapshot[]>;
  newKeys: Set<string>;
  getResult: (id: string) => NormToolResult | undefined;
  q: string;
}

// All the filtering + animation state lives in this hook so we can drive
// either the flat fallback renderer or a virtualized renderer (Virtuoso)
// from the same source of truth.
export function useTranscriptModel({ messages, toolResults, agentsByToolUse, query }: {
  messages: NormMsg[];
  toolResults: Record<string, NormToolResult>;
  agentsByToolUse: Record<string, NormAgent>;
  query: string;
}): TranscriptModel {
  const groups = useMemo(() => buildGroups(messages), [messages]);
  const taskStateById = useMemo(() => buildTaskStateById(messages, toolResults), [messages, toolResults]);
  const q = query.trim().toLowerCase();

  const groupHaystack = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) {
      const blocks = g.kind === "user-tasknote" ? g.msg!.blocks : (g.msgs || []).flatMap(x => x.blocks);
      m.set(g.key, JSON.stringify(blocks).toLowerCase());
    }
    return m;
  }, [groups]);

  const agentHaystack = useMemo(() => {
    const m = new Map<string, string>();
    for (const id in agentsByToolUse) {
      const a = agentsByToolUse[id];
      if (m.has(a.id)) continue;
      m.set(a.id, JSON.stringify({ m: a.messages, r: a.toolResults }).toLowerCase());
    }
    return m;
  }, [agentsByToolUse]);

  const { filtered, forceExpandedAgents } = useMemo(() => {
    if (!q) return { filtered: groups, forceExpandedAgents: new Set<string>() };
    const expanded = new Set<string>();
    const kept = groups.filter(g => {
      if (g.kind === "user-tasknote") {
        if (groupHaystack.get(g.key)?.includes(q)) return true;
        const tn = isUserTaskNotification(g.msg!);
        const a = tn ? agentsByToolUse[tn.toolUseId] : undefined;
        if (a && agentHaystack.get(a.id)?.includes(q)) { expanded.add(a.id); return true; }
        return false;
      }
      let keep = !!groupHaystack.get(g.key)?.includes(q);
      for (const m of g.msgs || []) {
        for (const b of m.blocks) {
          if (b.type !== "tool_use") continue;
          if (b.name !== "Agent" && b.name !== "Task") continue;
          const a = b.id ? agentsByToolUse[b.id] : undefined;
          if (a && agentHaystack.get(a.id)?.includes(q)) { expanded.add(a.id); keep = true; }
        }
      }
      return keep;
    });
    return { filtered: kept, forceExpandedAgents: expanded };
  }, [groups, q, agentsByToolUse, groupHaystack, agentHaystack]);

  const seenKeysRef = useRef<Set<string> | null>(null);
  const [newKeys, setNewKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    const currentKeys = new Set(groups.map(g => g.key));
    if (seenKeysRef.current === null) {
      seenKeysRef.current = currentKeys;
      return;
    }
    const fresh = new Set<string>();
    for (const k of currentKeys) if (!seenKeysRef.current.has(k)) fresh.add(k);
    seenKeysRef.current = currentKeys;
    if (fresh.size === 0) return;
    setNewKeys(prev => {
      const merged = new Set(prev);
      fresh.forEach(k => merged.add(k));
      return merged;
    });
    const t = setTimeout(() => {
      setNewKeys(prev => {
        const next = new Set(prev);
        fresh.forEach(k => next.delete(k));
        return next;
      });
    }, 700);
    return () => clearTimeout(t);
  }, [groups]);

  const getResult = (id: string) => toolResults[id];
  return { groups, filtered, forceExpandedAgents, taskStateById, newKeys, getResult, q };
}

// One rendered transcript row. Exported so the virtualized renderer in
// ConversationView can call it for each Virtuoso item.
export function GroupRow({ g, model, agentsByToolUse, onOpenAgent, settings, query }: {
  g: Group;
  model: TranscriptModel;
  agentsByToolUse: Record<string, NormAgent>;
  onOpenAgent: (id: string) => void;
  settings: ViewSettings;
  query: string;
}) {
  const extra = model.newKeys.has(g.key) ? "slide-in-right" : "";
  if (g.kind === "user-tasknote") {
    return <UserMessage msg={g.msg!} agentsByToolUse={agentsByToolUse} onOpenAgent={onOpenAgent} extraClass={extra} />;
  }
  if (g.kind === "user") {
    return <UserGroup msgs={g.msgs!} extraClass={extra} />;
  }
  return (
    <AssistantGroup
      group={g}
      getResult={model.getResult}
      agentsByToolUse={agentsByToolUse}
      onOpenAgent={onOpenAgent}
      settings={settings}
      taskStateById={model.taskStateById}
      query={query}
      forceExpandedAgents={model.forceExpandedAgents}
      extraClass={extra}
    />
  );
}

export function Transcript({ messages, toolResults, agentsByToolUse, onOpenAgent, settings, query = "", live = false }: {
  messages: NormMsg[];
  toolResults: Record<string, NormToolResult>;
  agentsByToolUse: Record<string, NormAgent>;
  onOpenAgent: (id: string) => void;
  settings: ViewSettings;
  query?: string;
  live?: boolean;
}) {
  const model = useTranscriptModel({ messages, toolResults, agentsByToolUse, query });
  const { filtered, q } = model;
  return (
    <div className="transcript">
      {filtered.map(g => (
        <GroupRow
          key={g.key}
          g={g}
          model={model}
          agentsByToolUse={agentsByToolUse}
          onOpenAgent={onOpenAgent}
          settings={settings}
          query={query}
        />
      ))}
      {!q && filtered.length > 0 ? (live ? <LiveTail live /> : <ConversationEnd />) : null}
      {q && !filtered.length ? <div className="empty">no messages match "{query}"</div> : null}
    </div>
  );
}

import { Markdown } from "../../lib/md";
