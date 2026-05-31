import { useMemo } from "react";
import { fmtCost, fmtTime, modelFamily, modelLabel } from "../../lib/format";
import { Icons } from "../../lib/icons";
import { UsageChips } from "../../lib/md";
import type { NormAgent, NormBlock, NormMsg, NormToolResult } from "../../lib/normalize";
import { AgentSpawnCard, ThinkingBlock, ToolCard, UserGroup, UserMessage, isUserTaskNotification } from "./blocks";

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

function Blocks({ blocks, getResult, agentsByToolUse, onOpenAgent, settings }: {
  blocks: NormBlock[];
  getResult: (id: string) => NormToolResult | undefined;
  agentsByToolUse: Record<string, NormAgent>;
  onOpenAgent: (id: string) => void;
  settings: ViewSettings;
}) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "text") return b.text?.trim() ? <div className="blk text" key={i}><div className="md"><Markdown text={b.text} /></div></div> : null;
        if (b.type === "thinking") return <ThinkingBlock key={i} text={b.thinking || ""} defaultOpen={settings.expandThinking} />;
        if (b.type === "tool_use") {
          if (b.name === "Agent" || b.name === "Task")
            return <AgentSpawnCard key={i} block={b} agent={b.id ? agentsByToolUse[b.id] : undefined} onOpen={onOpenAgent} />;
          return <ToolCard key={i} block={b} result={b.id ? getResult(b.id) : undefined} defaultOpen={settings.expandTools} />;
        }
        return null;
      })}
    </>
  );
}

function AssistantGroup({ group, getResult, agentsByToolUse, onOpenAgent, settings }: {
  group: Group;
  getResult: (id: string) => NormToolResult | undefined;
  agentsByToolUse: Record<string, NormAgent>;
  onOpenAgent: (id: string) => void;
  settings: ViewSettings;
}) {
  const msgs = group.msgs!;
  const fam = modelFamily(group.model);
  const usage = sumUsage(msgs);
  const skill = msgs.find(m => m.attributionSkill)?.attributionSkill;
  const lastStop = msgs[msgs.length - 1].stopReason;
  const steps = msgs.length;
  const allBlocks = msgs.flatMap(m => m.blocks);
  return (
    <div className="msg asst fade-in">
      <div className="msg-gutter">
        <span className="role-dot asst-dot" style={{ "--mc": `var(--${fam})` } as React.CSSProperties}>
          <Icons.spark size={12} />
        </span>
        <span className="gutter-line" />
      </div>
      <div className="msg-main">
        <div className="msg-head">
          <span className="model-badge" style={{ "--mc": `var(--${fam})` } as React.CSSProperties}>
            <span className="model-dot" />{modelLabel(group.model)}
          </span>
          {steps > 1 ? <span className="steps-badge tnum" title={steps + " model turns combined"}>{steps} steps</span> : null}
          {skill ? <span className="skill-badge">{skill}</span> : null}
          <span className="msg-time">{fmtTime(msgs[0].ts)}</span>
          {lastStop && lastStop !== "end_turn" && lastStop !== "tool_use" ? <span className="stop-badge">{lastStop}</span> : null}
          <span className="msg-head-spacer" />
          <UsageChips u={usage} compact />
          {usage.cost > 0 ? <span className="msg-cost tnum">{fmtCost(usage.cost)}</span> : null}
        </div>
        <div className="msg-blocks">
          <Blocks blocks={allBlocks} getResult={getResult} agentsByToolUse={agentsByToolUse} onOpenAgent={onOpenAgent} settings={settings} />
        </div>
      </div>
    </div>
  );
}

export function Transcript({ messages, toolResults, agentsByToolUse, onOpenAgent, settings, query = "" }: {
  messages: NormMsg[];
  toolResults: Record<string, NormToolResult>;
  agentsByToolUse: Record<string, NormAgent>;
  onOpenAgent: (id: string) => void;
  settings: ViewSettings;
  query?: string;
}) {
  const getResult = (id: string) => toolResults[id];
  const groups = useMemo(() => buildGroups(messages), [messages]);
  const q = query.trim().toLowerCase();
  const filtered = q ? groups.filter(g => {
    const src = g.kind === "user-tasknote"
      ? g.msg!.blocks
      : (g.msgs || []).flatMap(m => m.blocks);
    return JSON.stringify(src).toLowerCase().includes(q);
  }) : groups;
  return (
    <div className="transcript">
      {filtered.map(g => {
        if (g.kind === "user-tasknote") {
          return <UserMessage key={g.key} msg={g.msg!} agentsByToolUse={agentsByToolUse} onOpenAgent={onOpenAgent} />;
        }
        if (g.kind === "user") {
          return <UserGroup key={g.key} msgs={g.msgs!} />;
        }
        return <AssistantGroup key={g.key} group={g} getResult={getResult} agentsByToolUse={agentsByToolUse} onOpenAgent={onOpenAgent} settings={settings} />;
      })}
      {q && !filtered.length ? <div className="empty">no messages match "{query}"</div> : null}
    </div>
  );
}

import { Markdown } from "../../lib/md";
