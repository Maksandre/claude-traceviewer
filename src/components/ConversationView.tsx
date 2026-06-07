import { useCallback, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { NormAgent, NormTrace } from "../lib/normalize";
import { fmtCost, fmtDur, modelColor, modelLabel } from "../lib/format";
import { Icons } from "../lib/icons";
import { useSearchHighlight } from "../lib/searchHighlight";
import {
  ConversationEnd,
  GroupRow,
  LiveTail,
  useTranscriptModel,
  type ViewSettings,
} from "./conversation/Transcript";

interface Props {
  trace: NormTrace;
  query: string;
  onOpenAgent: (id: string) => void;
  settings: ViewSettings;
  live: boolean;
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

export function ConversationView({ trace, query, onOpenAgent, settings, live }: Props) {
  // Stable per-trace so the search index doesn't tear down on every render.
  const agentsByToolUse = useMemo(() => {
    const m: Record<string, NormAgent> = {};
    for (const a of trace.agents) if (a.toolUseId) m[a.toolUseId] = a;
    return m;
  }, [trace.agents]);

  const model = useTranscriptModel({
    messages: trace.main.messages,
    toolResults: trace.main.toolResults,
    agentsByToolUse,
    query,
  });
  const { filtered, q } = model;

  // Wrapper element scopes the highlight walker to the rendered transcript.
  // Virtuoso only mounts items that are on screen, so the walker is naturally
  // bounded by the viewport — no walking through thousands of off-screen nodes.
  const containerRef = useRef<HTMLDivElement>(null);
  useSearchHighlight(containerRef, query);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const showJump = !atBottom;

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" });
  }, []);

  const renderItem = useCallback((_index: number, g: typeof filtered[number]) => (
    <div className="conv-row">
      <GroupRow
        g={g}
        model={model}
        agentsByToolUse={agentsByToolUse}
        onOpenAgent={onOpenAgent}
        settings={settings}
        query={query}
      />
    </div>
  ), [model, agentsByToolUse, onOpenAgent, settings, query]);

  const Header = useCallback(() => (
    <div className="conv-row conv-row-header">
      <ConvHeader trace={trace} />
    </div>
  ), [trace]);

  const Footer = useCallback(() => {
    if (q && !filtered.length) {
      return <div className="conv-row"><div className="empty">no messages match "{query}"</div></div>;
    }
    if (q) return <div className="conv-row-spacer" />;
    if (filtered.length === 0) return null;
    return (
      <div className="conv-row conv-row-footer">
        {live ? <LiveTail live /> : <ConversationEnd />}
      </div>
    );
  }, [q, query, filtered.length, live]);

  return (
    <div className="conv-wrap" ref={containerRef}>
      <Virtuoso
        ref={virtuosoRef}
        className="conv-scroll"
        data={filtered}
        computeItemKey={(_i, g) => g.key}
        itemContent={renderItem}
        components={{ Header, Footer }}
        atBottomStateChange={setAtBottom}
        atBottomThreshold={120}
        increaseViewportBy={{ top: 600, bottom: 1200 }}
        followOutput={live ? "smooth" : false}
      />
      <button
        className={"jump-bottom " + (showJump ? "visible" : "")}
        onClick={scrollToBottom}
        aria-label="Jump to latest"
        title="Jump to latest"
      >
        <Icons.caretDown size={16} />
      </button>
    </div>
  );
}
