import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { NormAgent, NormTrace } from "../lib/normalize";
import { contextWindow, fmtCost, fmtDur, fmtTokens, modelColor, modelLabel } from "../lib/format";
import { Icons } from "../lib/icons";
import { useSearchHighlight } from "../lib/searchHighlight";
import { ToolFilterStrip } from "./ToolFilterStrip";
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
  targetMsg?: string | null;
  targetBlock?: string | null;
}

function ConvHeader({ trace, toolFilter, onToggleTool, onClearTool }: {
  trace: NormTrace;
  toolFilter: Set<string>;
  onToggleTool: (name: string) => void;
  onClearTool: () => void;
}) {
  const s = trace.session;
  const totalTools = Object.values(trace.stats.toolFreq).reduce((a, b) => a + b, 0);
  const mainToolCounts = trace.main.toolCounts;
  const hasMainTools = Object.keys(mainToolCounts).length > 0;
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
        {trace.main.peakContext > 0 ? (
          <div className="chs" title="Largest context sent to the model; the harness compacts as this nears the window">
            <span className="chs-v tnum">{fmtTokens(trace.main.peakContext)}<span className="chs-sub"> / {fmtTokens(contextWindow(s.models[0]))}</span></span>
            <span className="chs-l">peak context</span>
          </div>
        ) : null}
      </div>
      {hasMainTools ? (
        <div className="conv-head-tools">
          <span className="kv-label">tools used</span>
          <ToolFilterStrip
            counts={mainToolCounts}
            selected={toolFilter}
            onToggle={onToggleTool}
            onClear={onClearTool}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ConversationView({ trace, query, onOpenAgent, settings, live, targetMsg, targetBlock }: Props) {
  // Stable per-trace so the search index doesn't tear down on every render.
  const agentsByToolUse = useMemo(() => {
    const m: Record<string, NormAgent> = {};
    for (const a of trace.agents) if (a.toolUseId) m[a.toolUseId] = a;
    return m;
  }, [trace.agents]);

  const [toolFilter, setToolFilter] = useState<Set<string>>(() => new Set());
  // A new session/trace can have a totally different tool list, so drop any
  // selection that wouldn't match anything here.
  useEffect(() => {
    setToolFilter(prev => {
      if (prev.size === 0) return prev;
      const valid = new Set<string>();
      for (const name of prev) if (trace.main.toolCounts[name]) valid.add(name);
      if (valid.size === prev.size) return prev;
      return valid;
    });
  }, [trace.main.toolCounts]);
  const toggleTool = useCallback((name: string) => {
    setToolFilter(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);
  const clearTool = useCallback(() => setToolFilter(new Set()), []);

  const model = useTranscriptModel({
    messages: trace.main.messages,
    toolResults: trace.main.toolResults,
    agentsByToolUse,
    query,
    toolFilter,
  });
  const { filtered, q } = model;
  const hasToolFilter = toolFilter.size > 0;

  // Wrapper element scopes the highlight walker to the rendered transcript.
  // Virtuoso only mounts items that are on screen, so the walker is naturally
  // bounded by the viewport — no walking through thousands of off-screen nodes.
  const containerRef = useRef<HTMLDivElement>(null);
  useSearchHighlight(containerRef, query);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [atTop, setAtTop] = useState(true);

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
  }, []);
  const scrollToTop = useCallback(() => {
    // scrollTo(top:0) hits the absolute top (including the header), unlike
    // scrollToIndex(0) which stops at the first message.
    virtuosoRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  // Walk every msg in every group so links targeting the 2nd part of a
  // multi-step asst turn (or part N of a bundled user group) still resolve.
  const targetIndex = useMemo(() => {
    if (!targetMsg) return -1;
    for (let i = 0; i < filtered.length; i++) {
      const g = filtered[i];
      if (g.key === targetMsg) return i;
      if (g.msg?.uuid === targetMsg) return i;
      if (g.msgs?.some(m => m.uuid === targetMsg)) return i;
    }
    return -1;
  }, [targetMsg, filtered]);

  // Block deep-links flash just the block, not the whole row — the row
  // may be many screens tall and flashing it all is more distracting
  // than helpful. A ref-gate means we only auto-scroll once per unique
  // (msg, block) pair: poll-driven re-renders won't yank the user back.
  // The URL stays set so the address bar is shareable.
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const lastScrolledRef = useRef<string>("");
  useEffect(() => {
    if (!targetMsg || targetIndex < 0) return;
    const key = `${targetMsg}|${targetBlock ?? ""}`;
    if (lastScrolledRef.current === key) return;
    lastScrolledRef.current = key;

    const groupKey = filtered[targetIndex].key;
    const wantsBlock = !!targetBlock;
    let cancelled = false;
    let raf = 0;
    let clearHighlightT = 0;
    let clearBlockT = 0;
    const root = containerRef.current;

    // Fast path: block is already in the DOM (e.g. user clicked a
    // permalink while looking at the block, or the row was already on
    // screen). Skip the Virtuoso scrollToIndex jolt — go straight to
    // the block.
    if (wantsBlock && root) {
      const sel = `[data-block-id="${CSS.escape(targetBlock!)}"]`;
      const el = root.querySelector<HTMLElement>(sel);
      if (el) {
        el.scrollIntoView({ behavior: "auto", block: "start" });
        el.classList.add("is-target");
        clearBlockT = window.setTimeout(() => el.classList.remove("is-target"), 2400);
        return () => { window.clearTimeout(clearBlockT); };
      }
    }

    // Slow path: row not mounted yet (initial deep-link load on a long
    // transcript). Scroll the row in via Virtuoso, then poll for the
    // block element and finalize.
    const scrollT = window.setTimeout(() => {
      if (cancelled) return;
      virtuosoRef.current?.scrollToIndex({ index: targetIndex, align: "start", behavior: "auto" });
      if (!wantsBlock) {
        setHighlightKey(groupKey);
        clearHighlightT = window.setTimeout(() => setHighlightKey(null), 2400);
        return;
      }
      if (!root) return;
      const sel = `[data-block-id="${CSS.escape(targetBlock!)}"]`;
      let attempts = 0;
      const tryFind = () => {
        if (cancelled) return;
        const el = root.querySelector<HTMLElement>(sel);
        if (el) {
          el.scrollIntoView({ behavior: "auto", block: "start" });
          el.classList.add("is-target");
          clearBlockT = window.setTimeout(() => el.classList.remove("is-target"), 2400);
          return;
        }
        if (++attempts > 90) return;
        raf = window.requestAnimationFrame(tryFind);
      };
      window.setTimeout(tryFind, 80);
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(scrollT);
      if (clearHighlightT) window.clearTimeout(clearHighlightT);
      if (clearBlockT) window.clearTimeout(clearBlockT);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [targetMsg, targetBlock, targetIndex, filtered]);

  const renderItem = useCallback((_index: number, g: typeof filtered[number]) => (
    <div className={"conv-row " + (highlightKey === g.key ? "is-target" : "")}>
      <GroupRow
        g={g}
        model={model}
        agentsByToolUse={agentsByToolUse}
        onOpenAgent={onOpenAgent}
        settings={settings}
        query={query}
        toolFilter={toolFilter}
      />
    </div>
  ), [model, agentsByToolUse, onOpenAgent, settings, query, highlightKey, toolFilter]);

  const Header = useCallback(() => (
    <div className="conv-row conv-row-header">
      <ConvHeader trace={trace} toolFilter={toolFilter} onToggleTool={toggleTool} onClearTool={clearTool} />
    </div>
  ), [trace, toolFilter, toggleTool, clearTool]);

  const Footer = useCallback(() => {
    if (q && !filtered.length) {
      return <div className="conv-row"><div className="empty">no messages match "{query}"</div></div>;
    }
    if (hasToolFilter && !filtered.length) {
      return <div className="conv-row"><div className="empty">no messages match the selected tools</div></div>;
    }
    if (q || hasToolFilter) return <div className="conv-row-spacer" />;
    if (filtered.length === 0) return null;
    return (
      <div className="conv-row conv-row-footer">
        {live ? <LiveTail live /> : <ConversationEnd />}
      </div>
    );
  }, [q, query, filtered.length, live, hasToolFilter]);

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
        atTopStateChange={setAtTop}
        atTopThreshold={120}
        increaseViewportBy={{ top: 600, bottom: 1200 }}
        followOutput={live ? "smooth" : false}
      />
      <button
        className={"jump-top " + (!atTop ? "visible" : "")}
        onClick={scrollToTop}
        aria-label="Jump to top"
        title="Jump to top"
      >
        <Icons.caretUp size={16} />
      </button>
      <button
        className={"jump-bottom " + (!atBottom ? "visible" : "")}
        onClick={scrollToBottom}
        aria-label="Jump to latest"
        title="Jump to latest"
      >
        <Icons.caretDown size={16} />
      </button>
    </div>
  );
}
