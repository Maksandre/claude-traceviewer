import type { NormAgent, NormTrace } from "../lib/normalize";
import { fmtCost, fmtDur, modelColor, modelLabel } from "../lib/format";
import { Icons } from "../lib/icons";
import { Transcript, type ViewSettings } from "./conversation/Transcript";

interface Props {
  trace: NormTrace;
  query: string;
  onOpenAgent: (id: string) => void;
  settings: ViewSettings;
}

function ConvHeader({ trace }: { trace: NormTrace }) {
  const s = trace.session;
  const totalTools = Object.values(trace.stats.toolFreq).reduce((a, b) => a + b, 0);
  return (
    <div className="conv-head">
      <div className="conv-head-main">
        <h1 className="conv-title">
          {s.attributionSkill ? <span className="conv-cmd">/{s.attributionSkill}</span> : "Session"}
        </h1>
        <div className="conv-head-meta">
          {s.project ? <span><Icons.folder size={12} />{s.project.replace(/^.*\//, "")}</span> : null}
          {s.gitBranch ? <span><Icons.branch size={12} />{s.gitBranch}</span> : null}
          {s.models[0] ? (
            <span>
              <span className="model-dot" style={{ background: modelColor(s.models[0]) }} />
              {modelLabel(s.models[0])}
            </span>
          ) : null}
          {s.durationMs > 0 ? <span><Icons.clock size={12} />{fmtDur(s.durationMs)}</span> : null}
        </div>
      </div>
      <div className="conv-head-stats">
        <div className="chs">
          <span className="chs-v tnum" style={{ color: "var(--accent)" }}>{fmtCost(trace.stats.totals.cost)}</span>
          <span className="chs-l">cost</span>
        </div>
        <div className="chs">
          <span className="chs-v tnum">{trace.agents.length}</span>
          <span className="chs-l">subagents</span>
        </div>
        <div className="chs">
          <span className="chs-v tnum">{totalTools}</span>
          <span className="chs-l">tool calls</span>
        </div>
      </div>
    </div>
  );
}

export function ConversationView({ trace, query, onOpenAgent, settings }: Props) {
  const agentsByToolUse: Record<string, NormAgent> = {};
  for (const a of trace.agents) if (a.toolUseId) agentsByToolUse[a.toolUseId] = a;

  return (
    <div className="conv-scroll">
      <div className="conv-inner">
        <ConvHeader trace={trace} />
        <Transcript
          messages={trace.main.messages}
          toolResults={trace.main.toolResults}
          agentsByToolUse={agentsByToolUse}
          onOpenAgent={onOpenAgent}
          settings={settings}
          query={query}
        />
        <div className="conv-end">
          <Icons.check size={13} /> end of session · {fmtDur(trace.session.durationMs)}
        </div>
      </div>
    </div>
  );
}
