import fs from "fs";
import path from "path";

// === Codex CLI session discovery ===
// Codex CLI writes one rollout file per session under
// <CODEX_DIR>/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl. Unlike Claude
// Code there is no per-project directory: the working directory only lives in
// the session_meta record on the file's first line. Sessions are merged into
// the project list by re-encoding that cwd with Claude Code's own scheme
// (every "/" → "-"), so a Codex session lands in the same project entry as
// Claude sessions from the same directory.

export interface CodexSessionEntry {
  /** Session id used in URLs — the rollout file's basename without .jsonl.
   * Unique per file (the name embeds the start timestamp), unlike the
   * session_meta id which a resumed session can carry into a second file. */
  id: string;
  path: string;
  cwd: string;
  projectKey: string;
  mtimeMs: number;
  size: number;
}

export function projectKeyForCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

// session_meta is always the first line; a bounded read keeps the scan cheap.
const FIRST_LINE_BYTES = 65536;

// Re-reading the first line of every rollout on each poll would defeat the
// point of the bounded read, so parsed cwds are cached by (mtime, size).
const cwdCache = new Map<string, { mtimeMs: number; size: number; cwd: string }>();

function readSessionCwd(filePath: string): string {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(FIRST_LINE_BYTES);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.toString("utf-8", 0, bytes);
    const nl = text.indexOf("\n");
    const obj = JSON.parse(nl >= 0 ? text.slice(0, nl) : text);
    const cwd = obj?.payload?.cwd;
    return typeof cwd === "string" ? cwd : "";
  } catch {
    return "";
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

/** Walk the YYYY/MM/DD tree and return every session that has a usable cwd.
 * Sessions whose first line is missing or unparsable have no project to land
 * in and are dropped. */
export function scanCodexSessions(sessionsDir: string): CodexSessionEntry[] {
  const out: CodexSessionEntry[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        // sessions/YYYY/MM/DD — don't recurse past the expected layout
        if (depth < 3) walk(p, depth + 1);
        continue;
      }
      if (!e.name.endsWith(".jsonl")) continue;
      let stat: fs.Stats;
      try { stat = fs.statSync(p); } catch { continue; }
      const cached = cwdCache.get(p);
      let cwd: string;
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        cwd = cached.cwd;
      } else {
        cwd = readSessionCwd(p);
        cwdCache.set(p, { mtimeMs: stat.mtimeMs, size: stat.size, cwd });
      }
      if (!cwd) continue;
      out.push({
        id: e.name.replace(/\.jsonl$/, ""),
        path: p,
        cwd,
        projectKey: projectKeyForCwd(cwd),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  };
  walk(sessionsDir, 0);
  return out;
}

export interface CodexProjectInfo { cwd: string; sessionCount: number; mtime: number }

export function codexProjects(sessionsDir: string): Map<string, CodexProjectInfo> {
  const map = new Map<string, CodexProjectInfo>();
  for (const s of scanCodexSessions(sessionsDir)) {
    const cur = map.get(s.projectKey);
    if (cur) {
      cur.sessionCount += 1;
      // The most recent session's cwd represents the group — deterministic,
      // and it's what destructive operations compare against.
      if (s.mtimeMs > cur.mtime) { cur.mtime = s.mtimeMs; cur.cwd = s.cwd; }
    } else {
      map.set(s.projectKey, { cwd: s.cwd, sessionCount: 1, mtime: s.mtimeMs });
    }
  }
  return map;
}

export function findCodexSession(sessionsDir: string, sessionId: string): CodexSessionEntry | null {
  return scanCodexSessions(sessionsDir).find((s) => s.id === sessionId) || null;
}

/** All discovered sessions whose cwd encodes to this project key — one scan,
 * entries carry the real path and cwd so callers can act without re-walking. */
export function codexEntriesForProject(sessionsDir: string, projectKey: string): CodexSessionEntry[] {
  return scanCodexSessions(sessionsDir).filter((s) => s.projectKey === projectKey);
}

/** First real user prompt for the sidebar preview. event_msg/user_message is
 * the clean text; the response_item copy also carries harness-injected XML. */
function firstUserMessage(lines: string[]): string {
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj?.type === "event_msg" && obj.payload?.type === "user_message") {
        const msg = obj.payload.message;
        if (typeof msg === "string" && msg.trim()) return msg.slice(0, 120);
      }
    } catch { /* skip malformed line */ }
  }
  return "";
}

export interface CodexSessionListing {
  id: string;
  file: string;
  size: number;
  modified: string;
  lineCount: number;
  slug: string;
  preview: string;
  provider: "codex";
}

export function codexSessionsForProject(sessionsDir: string, projectKey: string): CodexSessionListing[] {
  const out: CodexSessionListing[] = [];
  for (const s of codexEntriesForProject(sessionsDir, projectKey)) {
    let lines: string[] = [];
    try {
      lines = fs.readFileSync(s.path, "utf-8").split("\n").filter(Boolean);
    } catch { continue; }
    out.push({
      id: s.id,
      file: path.basename(s.path),
      size: s.size,
      modified: new Date(s.mtimeMs).toISOString(),
      lineCount: lines.length,
      slug: "",
      preview: firstUserMessage(lines),
      provider: "codex",
    });
  }
  return out;
}
