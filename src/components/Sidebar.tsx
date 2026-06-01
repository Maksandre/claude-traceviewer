import { useMemo, useState } from "react";
import type { ProjectMeta, SessionInfo } from "../types";
import { Icons } from "../lib/icons";
import { modelFamily, relTime } from "../lib/format";

interface Props {
  projects: ProjectMeta[];
  selectedProject: string | null;
  onSelectProject: (p: string | null) => void;
  sessions: SessionInfo[];
  selectedSession: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onDeleteAllSessions: () => void;
  onResizeStart?: (e: React.MouseEvent) => void;
}

interface ProjectNode {
  id: string;
  group: string;
  leaf: string;
  sessionCount: number;
}

function decodeProject(p: ProjectMeta): ProjectNode {
  const cleaned = p.name.replace(/^-Users-[^-]+-/, "").replace(/-/g, "/");
  const parts = cleaned.split("/").filter(Boolean);
  const leaf = parts[parts.length - 1] || p.name;
  const group = parts.slice(Math.max(0, parts.length - 3), parts.length - 1).join("/");
  return { id: p.name, group: group ? group + "/" : "", leaf, sessionCount: p.sessionCount };
}

function isLive(modifiedIso: string): boolean {
  if (!modifiedIso) return false;
  return Date.now() - new Date(modifiedIso).getTime() < 60000;
}

/* strip Claude Code's XML wrappers from a session preview so it reads as plain text */
function cleanPreview(raw: string): string {
  let t = (raw || "").replace(/\s+/g, " ").trim();
  // drop noisy wrapper blocks entirely (caveats / system notices / command args)
  const dropBlocks = [
    /<local-command-(?:caveat|stdout|stderr)>[\s\S]*?<\/local-command-(?:caveat|stdout|stderr)>/gi,
    /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
    /<system-info[^>]*>[\s\S]*?<\/system-info>/gi,
    /<command-(?:args|message)>[\s\S]*?<\/command-(?:args|message)>/gi,
    /<command-name>[\s\S]*?<\/command-name>/gi,
  ];
  for (const re of dropBlocks) t = t.replace(re, "");
  // keep inner text of any remaining tags
  t = t.replace(/<[^>]+>/g, "");
  return t.replace(/\s+/g, " ").trim();
}

function sessionTitle(s: SessionInfo): string {
  const cleaned = cleanPreview(s.preview || s.slug || "");
  if (cleaned) return cleaned.length > 80 ? cleaned.slice(0, 77) + "…" : cleaned;
  return s.id.slice(0, 8);
}

function sessionCommand(s: SessionInfo): string | null {
  const raw = s.preview || s.slug || "";
  // explicit XML command-name wins
  const xml = raw.match(/<command-name>\s*(\/[a-z][\w:-]*)\s*<\/command-name>/i);
  if (xml) return xml[1];
  // bare slash-command at the start
  const bare = raw.trim().match(/^(\/[a-z][\w:-]+)/i);
  return bare ? bare[1] : null;
}

function SessionRow({ s, active, onSelect, onDelete }: { s: SessionInfo; active: boolean; onSelect: (id: string) => void; onDelete: (id: string) => void }) {
  const live = isLive(s.modified);
  const cmd = sessionCommand(s);
  const title = sessionTitle(s);
  // Heuristic for model — slug ends with model id? otherwise unknown
  const fam = modelFamily("");
  return (
    <button className={"sess-row " + (active ? "active" : "")} onClick={() => onSelect(s.id)}>
      <span className={"sess-dot " + (live ? "live" : "")} style={{ "--mc": `var(--${fam})` } as React.CSSProperties}>
        {live ? <span className="live-dot" /> : null}
      </span>
      <span className="sess-body">
        <span className="sess-line1">
          {cmd ? <span className="sess-cmd">{cmd}</span> : <span className="sess-title">{title}</span>}
          {live ? <span className="sess-livetag">live</span> : null}
        </span>
        {cmd ? <span className="sess-preview">{title.replace(cmd, "").trim() || s.slug}</span> : null}
        <span className="sess-meta">
          <span>{relTime(s.modified)}</span>
          <span>· {s.lineCount} msgs</span>
          <span className="sess-size">{(s.size / 1024).toFixed(0)}k</span>
        </span>
      </span>
      <span
        role="button"
        tabIndex={-1}
        className="sess-delete"
        title="Delete session"
        onClick={(e) => {
          e.stopPropagation();
          if (confirm("Delete this session?")) onDelete(s.id);
        }}
      >
        ✕
      </span>
    </button>
  );
}

function ProjectRow({
  proj,
  open,
  onToggle,
  childCount,
  hasLive,
  children,
}: {
  proj: ProjectNode;
  open: boolean;
  onToggle: () => void;
  childCount: number;
  hasLive: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="proj-block">
      <button className={"proj-row " + (open ? "open" : "")} onClick={onToggle}>
        <span className="proj-caret">
          <Icons.chevron size={12} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
        </span>
        <span className="proj-folder"><Icons.folder size={13} /></span>
        <span className="proj-name">
          {proj.group ? <span className="proj-group">{proj.group}</span> : null}
          <span className="proj-leaf">{proj.leaf}</span>
        </span>
        {hasLive ? <span className="proj-live-dot" /> : null}
        {childCount > 0 ? <span className="proj-count">{childCount}</span> : null}
      </button>
      {open ? <div className="proj-sessions">{children}</div> : null}
    </div>
  );
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
  onResizeStart,
}: Props) {
  const [query, setQuery] = useState("");

  const projectNodes = useMemo(
    () => projects.map(decodeProject).filter(p => p.sessionCount > 0),
    [projects]
  );
  const sessionsForSelected = sessions;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projectNodes;
    return projectNodes.filter(p =>
      (p.leaf + " " + p.group).toLowerCase().includes(q) ||
      (p.id === selectedProject &&
        sessionsForSelected.some(s => ((s.preview || "") + " " + (s.slug || "")).toLowerCase().includes(q)))
    );
  }, [projectNodes, query, sessionsForSelected, selectedProject]);

  const liveCount = sessionsForSelected.filter(s => isLive(s.modified)).length;

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark"><Icons.layers size={17} /></span>
        <span className="brand-text">
          <span className="brand-name">Trace Viewer</span>
          <span className="brand-sub mono">claude-code</span>
        </span>
      </div>

      <div className="nav-searchwrap">
        <Icons.search size={14} />
        <input
          className="nav-search"
          placeholder="filter projects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? <button className="nav-search-clear" onClick={() => setQuery("")}>×</button> : null}
      </div>

      <div className="nav-head">
        <span className="nav-head-label"><Icons.folder size={12} /> projects</span>
        <span className="nav-head-meta">~/.claude/projects</span>
      </div>

      <div className="nav-scroll">
        {filtered.length === 0 ? (
          <div className="sidebar-empty">No projects</div>
        ) : (
          filtered.map(p => {
            const isSel = p.id === selectedProject;
            const childList = isSel ? sessionsForSelected : [];
            return (
              <ProjectRow
                key={p.id}
                proj={p}
                open={isSel}
                onToggle={() => onSelectProject(isSel ? null : p.id)}
                childCount={isSel ? childList.length : p.sessionCount}
                hasLive={isSel && liveCount > 0}
              >
                {isSel && childList.length === 0 ? (
                  <div className="sidebar-empty" style={{ padding: "8px 4px" }}>no sessions</div>
                ) : null}
                {isSel && childList.map(s => (
                  <SessionRow
                    key={s.id}
                    s={s}
                    active={s.id === selectedSession}
                    onSelect={onSelectSession}
                    onDelete={onDeleteSession}
                  />
                ))}
              </ProjectRow>
            );
          })
        )}
      </div>

      <div className="side-foot">
        <div className="meta-line"><span>{projectNodes.length} projects</span><b>{sessionsForSelected.length} sessions</b></div>
        {selectedProject && sessionsForSelected.length > 0 ? (
          <div className="meta-line">
            <span>actions</span>
            <button
              onClick={() => { if (confirm(`Delete all ${sessionsForSelected.length} sessions?`)) onDeleteAllSessions(); }}
              style={{ background: "transparent", border: "none", color: "var(--tx-3)", cursor: "pointer", fontFamily: "var(--ff-mono)", fontSize: "10.5px" }}
            >
              <Icons.trash size={11} style={{ verticalAlign: "middle" }} /> clear all
            </button>
          </div>
        ) : null}
      </div>
      {onResizeStart ? <div className="sidebar-resize" onMouseDown={onResizeStart} title="Drag to resize" /> : null}
    </aside>
  );
}
