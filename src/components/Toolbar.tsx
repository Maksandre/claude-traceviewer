import { useRef } from "react";
import type { ViewKey, Theme } from "../App";
import { Icons } from "../lib/icons";

interface Props {
  view: ViewKey;
  onViewChange: (v: ViewKey) => void;
  agentCount: number;
  hasSession: boolean;
  onRefresh: () => void;
  refreshSpin: number;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  updatedLabel: string;
  theme: Theme;
  onToggleTheme: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  query: string;
  onQueryChange: (v: string) => void;
  showSearch: boolean;
  onShowSearch: (v: boolean) => void;
}

interface ViewDef { k: ViewKey; label: string; icon: (p?: { size?: number }) => React.ReactElement; }
const VIEWS: ViewDef[] = [
  { k: "conversation", label: "Conversation", icon: Icons.chat },
  { k: "agents", label: "Agents", icon: Icons.tree },
  { k: "stats", label: "Stats", icon: Icons.chart },
];

export function Toolbar({
  view,
  onViewChange,
  agentCount,
  hasSession,
  onRefresh,
  refreshSpin,
  autoRefresh,
  onToggleAutoRefresh,
  updatedLabel,
  theme,
  onToggleTheme,
  sidebarOpen,
  onToggleSidebar,
  query,
  onQueryChange,
  showSearch,
  onShowSearch,
}: Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  const handleSearchToggle = () => {
    const next = !showSearch;
    onShowSearch(next);
    if (next) requestAnimationFrame(() => searchRef.current?.focus());
  };
  return (
    <header className="toolbar">
      <button className="icon-btn collapse-btn" onClick={onToggleSidebar} title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
        <Icons.layers size={16} />
      </button>
      <nav className="viewtabs">
        {VIEWS.map(v => (
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
        <div className={"searchbox " + (showSearch || query ? "open" : "")}>
          <button className="icon-btn" onClick={handleSearchToggle} title="Search transcript">
            <Icons.search size={15} />
          </button>
          <input
            ref={searchRef}
            placeholder="search transcript…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={() => onShowSearch(true)}
          />
          {query ? <button className="search-clear" onClick={() => onQueryChange("")}>×</button> : null}
        </div>
      ) : null}

      {updatedLabel ? <span className="toolbar-meta">updated {updatedLabel}</span> : null}
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
