import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Icons } from "./lib/icons";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { ConversationView } from "./components/ConversationView";
import { AgentsView } from "./components/AgentsView";
import { StatsView } from "./components/StatsView";
import { AgentDrawer } from "./components/AgentDrawer";
import type { ProjectMeta, SessionInfo, TraceRecord } from "./types";
import { fetchNormalizedTrace, type NormTrace } from "./lib/normalize";
import { PermalinkContext } from "./lib/permalinkCtx";
import "./App.css";

export type ViewKey = "conversation" | "agents" | "stats";
export type Theme = "dark" | "light";

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("trace-viewer-theme");
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

function readInitialFromUrl() {
  if (typeof window === "undefined") return { project: null, session: null, view: "conversation" as ViewKey, msg: null, block: null };
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  return {
    project: params.get("project"),
    session: params.get("session"),
    view: (view === "agents" || view === "stats" || view === "conversation" ? view : "conversation") as ViewKey,
    msg: params.get("msg"),
    block: params.get("block"),
  };
}

function App() {
  const initial = readInitialFromUrl();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(initial.project);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(initial.session);
  const [records, setRecords] = useState<TraceRecord[]>([]);
  const [trace, setTrace] = useState<NormTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<ViewKey>(initial.view);
  // On phones the sidebar is an overlay drawer (see the mobile CSS section),
  // so it starts closed there instead of covering the content.
  const isMobile = () => typeof window !== "undefined" && window.innerWidth <= 820;
  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobile());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSpin, setRefreshSpin] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  // `targetMsg` / `targetBlock` track the active deep-link target. The
  // URL effect mirrors them into ?msg=&block= so the URL bar always
  // reflects what's selected. ConversationView ref-gates the actual
  // scroll-flash to once per (msg, block) pair so polling doesn't
  // re-trigger it.
  const [targetMsg, setTargetMsg] = useState<string | null>(initial.msg);
  const [targetBlock, setTargetBlock] = useState<string | null>(initial.block);
  const selectTarget = useCallback((msg: string, block: string | null) => {
    setTargetMsg(msg);
    setTargetBlock(block);
  }, []);
  const permalinkApi = useMemo(() => ({ selectTarget }), [selectTarget]);
  const [query, setQuery] = useState("");
  // Search runs when the user presses Enter in the Toolbar. We wrap the
  // state update in a transition so React can keep the input painted while
  // it works through the heavy filter + highlight + re-render pass.
  // `isSearching` drives the spinner shown back in the search box.
  const [isSearching, startSearchTransition] = useTransition();
  const submitQuery = useCallback((next: string) => {
    startSearchTransition(() => setQuery(next));
  }, []);
  const deferredQuery = useDeferredValue(query);
  const effectiveQuery = deferredQuery.trim().length >= 3 ? deferredQuery : "";
  const [showSearch, setShowSearch] = useState(false);
  const [focusAgentId, setFocusAgentId] = useState<string | null>(null);
  const [sidebarW, setSidebarW] = useState<number>(() => {
    try {
      const v = parseInt(window.localStorage.getItem("trace-viewer-sidebar-w") || "");
      return Number.isFinite(v) && v >= 200 && v <= 600 ? v : 264;
    } catch { return 264; }
  });
  const [resizing, setResizing] = useState(false);
  const sidebarWRef = useRef(sidebarW);
  sidebarWRef.current = sidebarW;

  useEffect(() => {
    try { window.localStorage.setItem("trace-viewer-sidebar-w", String(sidebarW)); } catch {}
  }, [sidebarW]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWRef.current;
    setResizing(true);
    const move = (ev: MouseEvent) => {
      const next = Math.max(220, Math.min(560, startW + (ev.clientX - startX)));
      setSidebarW(next);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      setResizing(false);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { window.localStorage.setItem("trace-viewer-theme", theme); } catch {}
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (selectedProject) params.set("project", selectedProject);
    if (selectedSession) params.set("session", selectedSession);
    if (view !== "conversation") params.set("view", view);
    if (targetMsg) params.set("msg", targetMsg);
    if (targetBlock) params.set("block", targetBlock);
    const qs = params.toString();
    const next = qs ? `?${qs}` : window.location.pathname;
    if (window.location.search !== (qs ? `?${qs}` : "")) {
      window.history.replaceState(null, "", next);
    }
  }, [selectedProject, selectedSession, view, targetMsg, targetBlock]);

  // Tolerate both old (string[]) and new ({name,sessionCount,mtime}[]) API shapes
  // so a stale dev server doesn't blank the page on hot-reload.
  const normalizeProjects = (data: unknown): ProjectMeta[] => {
    if (!Array.isArray(data)) return [];
    return data.map((it: any) =>
      typeof it === "string"
        ? { name: it, sessionCount: 0, mtime: 0 }
        : { name: String(it?.name || ""), sessionCount: Number(it?.sessionCount || 0), mtime: Number(it?.mtime || 0), cwd: typeof it?.cwd === "string" ? it.cwd : undefined }
    ).filter((p) => p.name);
  };

  const refreshProjectsAndSessions = useCallback(() => {
    fetch("/api/projects").then(r => r.json()).then((d) => setProjects(normalizeProjects(d))).catch(() => {});
    if (selectedProject) {
      fetch(`/api/projects/${encodeURIComponent(selectedProject)}/sessions`)
        .then(r => r.json()).then(setSessions).catch(() => {});
    }
  }, [selectedProject]);

  useEffect(() => {
    fetch("/api/projects").then(r => r.json()).then((d) => setProjects(normalizeProjects(d))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    fetch(`/api/projects/${encodeURIComponent(selectedProject)}/sessions`)
      .then(r => r.json()).then(setSessions);
  }, [selectedProject]);

  const fetchSession = useCallback(() => {
    if (!selectedProject || !selectedSession) return;
    fetch(`/api/projects/${encodeURIComponent(selectedProject)}/sessions/${encodeURIComponent(selectedSession)}`)
      .then(r => r.json())
      .then((data) => {
        const next: TraceRecord[] = Array.isArray(data) ? data : [];
        setRecords(prev => {
          // Polling: skip the re-normalize + re-render storm when the
          // session hasn't actually grown or shifted.
          if (prev.length === next.length) {
            const a = prev[prev.length - 1];
            const b = next[next.length - 1];
            if (a === b) return prev;
            if (a && b && a.uuid && a.uuid === b.uuid && a.timestamp === b.timestamp) return prev;
          }
          return next;
        });
        setLoading(false);
        setLastUpdated(Date.now());
      })
      .catch(() => { setRecords([]); setLoading(false); });
  }, [selectedProject, selectedSession]);

  useEffect(() => {
    if (!selectedSession) { setRecords([]); setTrace(null); return; }
    setLoading(true);
    fetchSession();
  }, [fetchSession, selectedSession]);

  useEffect(() => {
    if (!selectedProject || !selectedSession || !autoRefresh) return;
    const id = setInterval(fetchSession, 5000);
    return () => clearInterval(id);
  }, [selectedProject, selectedSession, fetchSession, autoRefresh]);

  // A subagent is "open" if the main session has an Agent/Task tool_use
  // whose matching tool_result hasn't landed yet. While that's the case the
  // subagent's own JSONL is appended to without touching the main JSONL, so
  // the normal poll doesn't pull in the new lines — we need an extra tick.
  const hasOpenSubagent = useMemo(() => {
    const toolUseIds = new Set<string>();
    const resultIds = new Set<string>();
    for (const rec of records) {
      const content = rec.message?.content;
      if (!Array.isArray(content)) continue;
      if (rec.type === "assistant") {
        for (const b of content) {
          if (b.type === "tool_use" && (b.name === "Agent" || b.name === "Task") && b.id) {
            toolUseIds.add(b.id);
          }
        }
      } else if (rec.type === "user") {
        for (const b of content) {
          if (b.type === "tool_result" && b.tool_use_id) resultIds.add(b.tool_use_id);
        }
      }
    }
    for (const id of toolUseIds) if (!resultIds.has(id)) return true;
    return false;
  }, [records]);

  // Bumping this re-runs the normalize effect, which re-fetches every
  // subagent's JSONL. The agent endpoint has conditional GET, so most of
  // those round-trips short-circuit at 304.
  const [subagentTick, setSubagentTick] = useState(0);
  useEffect(() => {
    if (!hasOpenSubagent || !autoRefresh) return;
    const id = setInterval(() => setSubagentTick(t => t + 1), 2500);
    return () => clearInterval(id);
  }, [hasOpenSubagent, autoRefresh]);

  // normalize whenever records change
  useEffect(() => {
    let cancelled = false;
    if (!selectedProject || !selectedSession || records.length === 0) {
      setTrace(null);
      return;
    }
    fetchNormalizedTrace(selectedProject, selectedSession, records).then(t => {
      if (!cancelled) setTrace(t);
    });
    return () => { cancelled = true; };
  }, [records, selectedProject, selectedSession, subagentTick]);


  const handleRefresh = useCallback(() => {
    setRefreshSpin(n => n + 1);
    if (selectedSession) fetchSession();
    refreshProjectsAndSessions();
  }, [fetchSession, refreshProjectsAndSessions, selectedSession]);

  const settings = useMemo(() => ({ expandThinking: false, expandTools: false }), []);
  const isWorking = useMemo(() => {
    const msgs = trace?.main.messages;
    if (!msgs || !msgs.length) return false;
    const last = msgs[msgs.length - 1];
    if (last.role === "user") return true;
    const s = last.stopReason;
    return !(s === "end_turn" || s === "stop_sequence" || s === "max_tokens");
  }, [trace]);
  const drawerAgent = useMemo(() => trace?.agents.find(a => a.id === drawerId) || null, [trace, drawerId]);
  const agentCount = trace?.agents.length || 0;
  const hasSession = !!selectedSession;

  return (
    <PermalinkContext.Provider value={permalinkApi}>
    <div
      className={"app " + (sidebarOpen ? "" : "no-sidebar") + (resizing ? " resizing" : "")}
      style={{ "--sidebar-w": sidebarOpen ? `${sidebarW}px` : "0px" } as React.CSSProperties}
    >
      <Sidebar
        projects={projects}
        selectedProject={selectedProject}
        onSelectProject={(p) => { setSelectedProject(p); setSelectedSession(null); setRecords([]); setTargetMsg(null); setTargetBlock(null); }}
        sessions={sessions}
        selectedSession={selectedSession}
        onSelectSession={(s) => { setSelectedSession(s); setTargetMsg(null); setTargetBlock(null); if (isMobile()) setSidebarOpen(false); }}
        onDeleteSession={(id) => {
          fetch(`/api/projects/${encodeURIComponent(selectedProject!)}/sessions/${encodeURIComponent(id)}`, { method: "DELETE" })
            .then(() => {
              setSessions(s => s.filter(x => x.id !== id));
              if (selectedSession === id) { setSelectedSession(null); setRecords([]); }
            });
        }}
        onDeleteAllSessions={() => {
          fetch(`/api/projects/${encodeURIComponent(selectedProject!)}/sessions`, { method: "DELETE" })
            .then(() => { setSessions([]); setSelectedSession(null); setRecords([]); });
        }}
        onResizeStart={startResize}
      />
      {sidebarOpen ? <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} /> : null}
      <main className="main">
        <Toolbar
          view={view}
          onViewChange={setView}
          agentCount={agentCount}
          hasSession={hasSession}
          onRefresh={handleRefresh}
          refreshSpin={refreshSpin}
          autoRefresh={autoRefresh}
          onToggleAutoRefresh={() => setAutoRefresh(v => !v)}
          lastUpdated={lastUpdated}
          theme={theme}
          onToggleTheme={() => setTheme(t => t === "dark" ? "light" : "dark")}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(o => !o)}
          query={query}
          onQueryChange={submitQuery}
          showSearch={showSearch}
          onShowSearch={setShowSearch}
          searching={isSearching}
        />
        <div className="canvas">
          {!hasSession ? (
            <div className="empty-hero">
              <div className="empty-hero-inner">
                <div className="empty-hero-mark"><Icons.layers size={28} /></div>
                <div className="empty-hero-title">Pick a session to inspect</div>
                <div className="empty-hero-desc">
                  Browse projects in the sidebar and open a conversation to see its
                  transcript, agent delegation tree, and aggregate stats.
                </div>
                <div className="empty-hero-stats">
                  <span><b>{projects.length}</b> projects</span>
                  <span><b>{projects.reduce((a, p) => a + (p.sessionCount || 0), 0)}</b> sessions</span>
                </div>
              </div>
            </div>
          ) : loading && !trace ? (
            <div className="loading-row">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" style={{ height: 120 }} />
              <div className="skeleton" />
            </div>
          ) : !trace ? (
            <div className="empty-state"><div>Loading trace…</div></div>
          ) : view === "conversation" ? (
            <ConversationView trace={trace} query={effectiveQuery} onOpenAgent={setDrawerId} settings={settings} live={isWorking} targetMsg={targetMsg} targetBlock={targetBlock} />
          ) : view === "agents" ? (
            <AgentsView
              trace={trace}
              settings={settings}
              onGotoConversation={() => setView("conversation")}
              focusAgentId={focusAgentId}
              clearFocus={() => setFocusAgentId(null)}
            />
          ) : (
            <div className="stats-scroll"><StatsView trace={trace} onOpenAgent={setDrawerId} /></div>
          )}
        </div>
      </main>
      <AgentDrawer
        agent={drawerAgent}
        settings={settings}
        onOpenAgent={setDrawerId}
        onClose={() => setDrawerId(null)}
      />
    </div>
    </PermalinkContext.Provider>
  );
}

export default App;
