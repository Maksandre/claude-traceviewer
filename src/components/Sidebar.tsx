import type { SessionInfo } from "../types";

interface Props {
  projects: string[];
  selectedProject: string | null;
  onSelectProject: (p: string) => void;
  sessions: SessionInfo[];
  selectedSession: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onDeleteAllSessions: () => void;
}

function formatProjectName(slug: string): string {
  const cleaned = slug.replace(/^-Users-[^-]+-/, "~/").replace(/-/g, "/");
  // Show last 2-3 meaningful path segments
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length <= 3) return cleaned;
  return "~/" + parts.slice(-3).join("/");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / 1048576).toFixed(1)}M`;
}

function getSessionTitle(s: SessionInfo): string {
  // Use preview (first user message) as title, fall back to slug
  if (s.preview) {
    const clean = s.preview.replace(/\s+/g, " ").trim();
    return clean.length > 60 ? clean.slice(0, 57) + "..." : clean;
  }
  if (s.slug) return s.slug;
  return s.id.slice(0, 8);
}

export function Sidebar({
  projects,
  selectedProject,
  onSelectProject,
  sessions,
  selectedSession,
  onSelectSession,
  onDeleteSession,
  onDeleteAllSessions,
}: Props) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20V10"/>
          <path d="M18 20V4"/>
          <path d="M6 20v-4"/>
        </svg>
        Claude Trace Viewer
      </div>

      <div className="project-select">
        <select
          value={selectedProject || ""}
          onChange={(e) => onSelectProject(e.target.value)}
        >
          <option value="" disabled>
            Select project...
          </option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {formatProjectName(p)}
            </option>
          ))}
        </select>
      </div>

      {selectedProject && sessions.length > 0 && (
        <div className="session-list-header">
          <span className="session-count">{sessions.length} sessions</span>
          <button
            className="delete-all-btn"
            onClick={() => {
              if (confirm(`Delete all ${sessions.length} sessions in this project?`))
                onDeleteAllSessions();
            }}
          >
            Clear all
          </button>
        </div>
      )}

      <div className="session-list">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`session-item ${selectedSession === s.id ? "selected" : ""}`}
            onClick={() => onSelectSession(s.id)}
          >
            <div className="session-title-row">
              <div className="session-title">{getSessionTitle(s)}</div>
              <button
                className="session-delete"
                title="Delete session"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("Delete this session?")) onDeleteSession(s.id);
                }}
              >
                &#10005;
              </button>
            </div>
            {s.slug && s.preview && (
              <div className="session-slug-label">{s.slug}</div>
            )}
            <div className="session-meta">
              <span>{formatDate(s.modified)}</span>
              <span>{s.lineCount} msgs</span>
              <span>{formatSize(s.size)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
