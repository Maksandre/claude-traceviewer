import { useEffect, useMemo, useRef, useState } from "react";
import { fmtCost, fmtTime, modelFamily, modelLabel } from "../../lib/format";
import { Icons } from "../../lib/icons";
import { UsageChips } from "../../lib/md";
import type { NormAgent, NormBlock, NormMsg, NormToolResult } from "../../lib/normalize";
import { AgentSpawnCard, AskUserQuestionCard, TaskCreateCard, TaskGenericCard, TaskUpdateCard, ThinkingBlock, ToolCard, UserGroup, UserMessage, isUserTaskNotification, type TaskSnapshot } from "./blocks";

export interface ViewSettings { expandThinking: boolean; expandTools: boolean; }

interface Group {
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

function Blocks({ blocks, getResult, agentsByToolUse, onOpenAgent, settings, taskStateById }: {
  blocks: NormBlock[];
  getResult: (id: string) => NormToolResult | undefined;
  agentsByToolUse: Record<string, NormAgent>;
  onOpenAgent: (id: string) => void;
  settings: ViewSettings;
  taskStateById: Map<string, TaskSnapshot[]>;
}) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "text") return b.text?.trim() ? <div className="blk text" key={i}><div className="md"><Markdown text={b.text} /></div></div> : null;
        if (b.type === "thinking") return <ThinkingBlock key={i} text={b.thinking || ""} defaultOpen={settings.expandThinking} />;
        if (b.type === "tool_use") {
          if (b.name === "Agent" || b.name === "Task")
            return <AgentSpawnCard key={i} block={b} agent={b.id ? agentsByToolUse[b.id] : undefined} onOpen={onOpenAgent} />;
          const tasks = b.id ? taskStateById.get(b.id) || [] : [];
          if (b.name === "TaskCreate")
            return <TaskCreateCard key={i} block={b} result={b.id ? getResult(b.id) : undefined} tasks={tasks} />;
          if (b.name === "TaskUpdate")
            return <TaskUpdateCard key={i} block={b} result={b.id ? getResult(b.id) : undefined} tasks={tasks} />;
          if (b.name === "AskUserQuestion")
            return <AskUserQuestionCard key={i} block={b} result={b.id ? getResult(b.id) : undefined} />;
          if (b.name && b.name.startsWith("Task"))
            return <TaskGenericCard key={i} block={b} result={b.id ? getResult(b.id) : undefined} tasks={tasks} defaultOpen={settings.expandTools} />;
          return <ToolCard key={i} block={b} result={b.id ? getResult(b.id) : undefined} defaultOpen={settings.expandTools} />;
        }
        return null;
      })}
    </>
  );
}

function AssistantGroup({ group, getResult, agentsByToolUse, onOpenAgent, settings, taskStateById, extraClass = "" }: {
  group: Group;
  getResult: (id: string) => NormToolResult | undefined;
  agentsByToolUse: Record<string, NormAgent>;
  onOpenAgent: (id: string) => void;
  settings: ViewSettings;
  taskStateById: Map<string, TaskSnapshot[]>;
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
          <Blocks blocks={allBlocks} getResult={getResult} agentsByToolUse={agentsByToolUse} onOpenAgent={onOpenAgent} settings={settings} taskStateById={taskStateById} />
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

function LiveTail({ live }: { live: boolean }) {
  return (
    <div className={"live-tail " + (live ? "is-live" : "")} aria-label={live ? "Watching for new messages" : "Paused"}>
      <span /><span /><span />
    </div>
  );
}

function ConversationEnd() {
  return (
    <div className="conv-end" aria-label="End of conversation">
      <span className="conv-end-line" />
      <span className="conv-end-label"><Icons.check size={12} /> end of conversation</span>
      <span className="conv-end-line" />
    </div>
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
  const getResult = (id: string) => toolResults[id];
  const groups = useMemo(() => buildGroups(messages), [messages]);
  const taskStateById = useMemo(() => buildTaskStateById(messages, toolResults), [messages, toolResults]);
  const q = query.trim().toLowerCase();
  const filtered = q ? groups.filter(g => {
    const src = g.kind === "user-tasknote"
      ? g.msg!.blocks
      : (g.msgs || []).flatMap(m => m.blocks);
    return JSON.stringify(src).toLowerCase().includes(q);
  }) : groups;

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

  return (
    <div className="transcript">
      {filtered.map(g => {
        const extra = newKeys.has(g.key) ? "slide-in-right" : "";
        if (g.kind === "user-tasknote") {
          return <UserMessage key={g.key} msg={g.msg!} agentsByToolUse={agentsByToolUse} onOpenAgent={onOpenAgent} extraClass={extra} />;
        }
        if (g.kind === "user") {
          return <UserGroup key={g.key} msgs={g.msgs!} extraClass={extra} />;
        }
        return <AssistantGroup key={g.key} group={g} getResult={getResult} agentsByToolUse={agentsByToolUse} onOpenAgent={onOpenAgent} settings={settings} taskStateById={taskStateById} extraClass={extra} />;
      })}
      {!q && filtered.length > 0 ? (live ? <LiveTail live /> : <ConversationEnd />) : null}
      {q && !filtered.length ? <div className="empty">no messages match "{query}"</div> : null}
    </div>
  );
}

import { Markdown } from "../../lib/md";
