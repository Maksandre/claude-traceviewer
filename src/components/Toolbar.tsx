import { useEffect, useRef, useState } from "react";
import type { ViewKey, Theme } from "../App";
import { Icons } from "../lib/icons";

interface Props {
  view: ViewKey;
  onViewChange: (v: ViewKey) => void;
  agentCount: number;
  /** Hide the Agents tab entirely (Codex sessions have no subagents). */
  hideAgents?: boolean;
  hasSession: boolean;
  onRefresh: () => void;
  refreshSpin: number;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  lastUpdated: number | null;
  theme: Theme;
  onToggleTheme: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  query: string;
  onQueryChange: (v: string) => void;
  showSearch: boolean;
  onShowSearch: (v: boolean) => void;
  searching: boolean;
}

interface ViewDef { k: ViewKey; label: string; icon: (p?: { size?: number }) => React.ReactElement; }
const VIEWS: ViewDef[] = [
  { k: "conversation", label: "Conversation", icon: Icons.chat },
  { k: "agents", label: "Agents", icon: Icons.tree },
  { k: "stats", label: "Stats", icon: Icons.chart },
];

// Self-contained tick. App used to own the seconds-ago counter and re-render
// itself (and therefore Sidebar + Toolbar + the rest) every second. That
// background work was colliding with keystrokes. Isolating the tick means
// only this <span> re-renders.
function UpdatedLabel({ lastUpdated }: { lastUpdated: number | null }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (!lastUpdated) { setLabel(""); return; }
    const compute = () => {
      const diff = Math.floor((Date.now() - lastUpdated) / 1000);
      if (diff < 2) return "just now";
      if (diff < 60) return `${diff}s ago`;
      return `${Math.floor(diff / 60)}m ago`;
    };
    setLabel(compute());
    const id = setInterval(() => setLabel(compute()), 1000);
    return () => clearInterval(id);
  }, [lastUpdated]);
  return label ? <span className="toolbar-meta">updated {label}</span> : null;
}

export function Toolbar({
  view,
  onViewChange,
  agentCount,
  hideAgents,
  hasSession,
  onRefresh,
  refreshSpin,
  autoRefresh,
  onToggleAutoRefresh,
  lastUpdated,
  theme,
  onToggleTheme,
  sidebarOpen,
  onToggleSidebar,
  query,
  onQueryChange,
  showSearch,
  onShowSearch,
  searching,
}: Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  const handleSearchToggle = () => {
    const next = !showSearch;
    onShowSearch(next);
    if (next) requestAnimationFrame(() => searchRef.current?.focus());
  };

  // Local input state — typing only re-renders Toolbar. The query is only
  // pushed to the parent (and the transcript filter + highlighter actually
  // run) when the user presses Enter. Auto-debounced filtering looked
  // smooth on small sessions but was patchy/glitchy on large ones, since
  // every pause re-triggered the whole pipeline.
  const [localQuery, setLocalQuery] = useState(query);
  useEffect(() => { setLocalQuery(query); }, [query]);
  const apply = () => {
    if (localQuery !== query) onQueryChange(localQuery);
  };
  const clear = () => {
    setLocalQuery("");
    if (query) onQueryChange("");
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); apply(); }
    else if (e.key === "Escape") { e.preventDefault(); clear(); searchRef.current?.blur(); }
  };
  const trimmedLen = localQuery.trim().length;
  const dirty = localQuery !== query;
  const tooShort = trimmedLen > 0 && trimmedLen < 3;
  return (
    <header className="toolbar">
      <button className="icon-btn collapse-btn" onClick={onToggleSidebar} title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
        <Icons.layers size={16} />
      </button>
      <nav className="viewtabs">
        {VIEWS.filter(v => !(hideAgents && v.k === "agents")).map(v => (
          <button
            key={v.k}
            className={"viewtab " + (view === v.k ? "active" : "")}
            onClick={() => onViewChange(v.k)}
            disabled={!hasSession}
          >
            <v.icon size={15} />
            <span>{v.label}</span>
            {v.k === "agents" && hasSession && agentCount > 0 ? <span className="viewtab-count tnum">{agentCount}</span> : null}
          </button>
        ))}
      </nav>

      <div className="toolbar-spacer" />

      {view === "conversation" && hasSession ? (
        <div className={"searchbox " + (showSearch || localQuery ? "open" : "") + (dirty ? " dirty" : "") + (searching ? " busy" : "")}>
          <button className="icon-btn" onClick={handleSearchToggle} title="Search transcript">
            {searching ? <span className="search-spinner" aria-label="Searching"><Icons.refresh size={15} /></span> : <Icons.search size={15} />}
          </button>
          <input
            ref={searchRef}
            placeholder="search transcript… (Enter)"
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => onShowSearch(true)}
          />
          {tooShort ? (
            <span className="search-hint" title="Type at least 3 characters to search">3+</span>
          ) : dirty && trimmedLen >= 3 ? (
            <button className="search-apply" onClick={apply} title="Run search (Enter)">↵</button>
          ) : null}
          {localQuery ? (
            <button className="search-clear" onClick={clear} title="Clear (Esc)">×</button>
          ) : null}
        </div>
      ) : null}

      <UpdatedLabel lastUpdated={lastUpdated} />
      <button
        className={"live-toggle " + (autoRefresh ? "on" : "")}
        onClick={onToggleAutoRefresh}
        title={autoRefresh ? "Auto-refresh on — click to pause" : "Auto-refresh paused — click to enable"}
        aria-pressed={autoRefresh}
      >
        <span className="toggle-dot" />
      </button>
      <button
        className="icon-btn"
        onClick={onRefresh}
        disabled={!hasSession}
        title="Refresh now"
        key={refreshSpin}
      >
        <Icons.refresh size={15} />
      </button>
      <button
        className="icon-btn"
        onClick={onToggleTheme}
        title={theme === "dark" ? "Light theme" : "Dark theme"}
      >
        {theme === "dark" ? <Icons.sun size={15} /> : <Icons.moon size={15} />}
      </button>
    </header>
  );
}
