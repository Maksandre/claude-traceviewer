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
  /** session_meta.id — the raw thread uuid. Distinct from `id`, which is the
   * filename (that uuid prefixed with the start timestamp). This is what
   * `parentThreadId` on a spawned child points back at. */
  rawId: string;
  /** session_meta.{parent_thread_id,source.subagent.thread_spawn.parent_thread_id}
   * — the immediate parent's rawId, or "" for a top-level session. */
  parentThreadId: string;
  /** true when thread_source === "subagent": a session created by another
   * session's spawn_agent call, not started directly by the user. */
  isSubagent: boolean;
  /** Full hierarchical path Codex assigns a spawned thread, e.g.
   * "/root/explorer_scope/qa_explorer" — matched against a spawn_agent
   * call's `task_name` output to recover which tool_use spawned this. */
  agentPath: string;
  agentNickname: string;
  startedAt: string;
}

export function projectKeyForCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

// session_meta is always the first line; a bounded read keeps the scan cheap.
const FIRST_LINE_BYTES = 65536;

interface CodexSessionHeader {
  cwd: string;
  rawId: string;
  parentThreadId: string;
  isSubagent: boolean;
  agentPath: string;
  agentNickname: string;
  startedAt: string;
}

const EMPTY_HEADER: CodexSessionHeader = { cwd: "", rawId: "", parentThreadId: "", isSubagent: false, agentPath: "", agentNickname: "", startedAt: "" };

// Re-reading the first line of every rollout on each poll would defeat the
// point of the bounded read, so parsed headers are cached by (mtime, size).
const headerCache = new Map<string, { mtimeMs: number; size: number; header: CodexSessionHeader }>();

function readSessionHeader(filePath: string): CodexSessionHeader {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(FIRST_LINE_BYTES);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.toString("utf-8", 0, bytes);
    const nl = text.indexOf("\n");
    const rec = JSON.parse(nl >= 0 ? text.slice(0, nl) : text);
    const p = rec?.payload || {};
    const spawn = p?.source?.subagent?.thread_spawn;
    return {
      cwd: typeof p.cwd === "string" ? p.cwd : "",
      rawId: typeof p.id === "string" ? p.id : "",
      parentThreadId: typeof p.parent_thread_id === "string" ? p.parent_thread_id
        : (typeof spawn?.parent_thread_id === "string" ? spawn.parent_thread_id : ""),
      isSubagent: p.thread_source === "subagent",
      agentPath: typeof p.agent_path === "string" ? p.agent_path
        : (typeof spawn?.agent_path === "string" ? spawn.agent_path : ""),
      agentNickname: typeof p.agent_nickname === "string" ? p.agent_nickname
        : (typeof spawn?.agent_nickname === "string" ? spawn.agent_nickname : ""),
      startedAt: typeof rec?.timestamp === "string" ? rec.timestamp : "",
    };
  } catch {
    return EMPTY_HEADER;
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
      const cached = headerCache.get(p);
      let header: CodexSessionHeader;
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        header = cached.header;
      } else {
        header = readSessionHeader(p);
        headerCache.set(p, { mtimeMs: stat.mtimeMs, size: stat.size, header });
      }
      if (!header.cwd) continue;
      out.push({
        id: e.name.replace(/\.jsonl$/, ""),
        path: p,
        cwd: header.cwd,
        projectKey: projectKeyForCwd(header.cwd),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        rawId: header.rawId,
        parentThreadId: header.parentThreadId,
        isSubagent: header.isSubagent,
        agentPath: header.agentPath,
        agentNickname: header.agentNickname,
        startedAt: header.startedAt,
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
      // Subagent sessions (spawn_agent children) don't get their own row in
      // the sidebar — see codexSessionsForProject — so they're excluded from
      // the count too, or the badge would promise more rows than are shown.
      if (!s.isSubagent) cur.sessionCount += 1;
      // The most recent session's cwd represents the group — deterministic,
      // and it's what destructive operations compare against.
      if (s.mtimeMs > cur.mtime) { cur.mtime = s.mtimeMs; cur.cwd = s.cwd; }
    } else {
      map.set(s.projectKey, { cwd: s.cwd, sessionCount: s.isSubagent ? 0 : 1, mtime: s.mtimeMs });
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
  // Subagent sessions (spawn_agent children) don't get their own sidebar row
  // — they're only reachable nested under the parent that spawned them, via
  // codexAgentsForSession, same as Claude Code's Task subagents never
  // appearing as top-level sessions.
  for (const s of codexEntriesForProject(sessionsDir, projectKey)) {
    if (s.isSubagent) continue;
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

// === Codex multi-agent nesting (spawn_agent) ===
// Codex's spawn_agent tool creates a genuinely separate rollout file for the
// child thread, unlike Claude Code's Task tool which nests a subagent's
// transcript under the parent session's own directory. The child's
// session_meta records exactly which thread spawned it (parentThreadId) — no
// heuristics needed — so the pieces below walk that link to recover the same
// parent/child tree Claude Code gets for free, and resolve each child back to
// the spawn_agent tool_use call that created it.

export interface CodexAgentListing {
  id: string;
  toolUseId: string;
  /** Another entry's `id` in this same listing, or "" for a direct child of
   * the requested session — mirrors Claude Code's NormAgent.parentId. */
  parentId: string;
  agentType: string;
  description: string;
  startedAt: string;
}

function readJsonlRecords(filePath: string): any[] {
  let text: string;
  try { text = fs.readFileSync(filePath, "utf-8"); } catch { return []; }
  const out: any[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed line */ }
  }
  return out;
}

// A spawn_agent call's function_call_output echoes back `task_name` as the
// full resolved agent_path of the thread it just created — an exact,
// unambiguous key back to whichever child session carries that agent_path.
function spawnedPathToCallId(records: any[]): Map<string, string> {
  const spawnCallIds = new Set<string>();
  for (const rec of records) {
    const p = rec?.payload;
    if (p?.type === "function_call" && p.name === "spawn_agent" && typeof p.call_id === "string") {
      spawnCallIds.add(p.call_id);
    }
  }
  const out = new Map<string, string>();
  for (const rec of records) {
    const p = rec?.payload;
    if (p?.type !== "function_call_output" || typeof p.call_id !== "string") continue;
    if (!spawnCallIds.has(p.call_id)) continue;
    if (typeof p.output !== "string") continue;
    try {
      const parsed = JSON.parse(p.output);
      if (parsed && typeof parsed.task_name === "string") out.set(parsed.task_name, p.call_id);
    } catch { /* spawn_agent output wasn't JSON — nothing to correlate */ }
  }
  return out;
}

/** The full descendant subtree (direct + nested spawn_agent children) of
 * `root`, scoped to sessions sharing its project — spawned children always
 * inherit the parent's cwd in practice. */
export function codexAgentsForSession(sessionsDir: string, root: CodexSessionEntry): CodexAgentListing[] {
  const all = codexEntriesForProject(sessionsDir, root.projectKey);
  const byRawId = new Map(all.map((e) => [e.rawId, e]));
  const childrenOf = new Map<string, CodexSessionEntry[]>();
  for (const e of all) {
    if (!e.isSubagent || !e.parentThreadId) continue;
    const list = childrenOf.get(e.parentThreadId) || [];
    list.push(e);
    childrenOf.set(e.parentThreadId, list);
  }

  const out: CodexAgentListing[] = [];
  const spawnMapCache = new Map<string, Map<string, string>>();
  const spawnMapFor = (rawId: string, filePath: string): Map<string, string> => {
    const cached = spawnMapCache.get(rawId);
    if (cached) return cached;
    const map = spawnedPathToCallId(readJsonlRecords(filePath));
    spawnMapCache.set(rawId, map);
    return map;
  };

  const queue: { entry: CodexSessionEntry; parentRawId: string; parentSessionId: string }[] =
    (childrenOf.get(root.rawId) || []).map((entry) => ({ entry, parentRawId: root.rawId, parentSessionId: "" }));

  while (queue.length) {
    const { entry, parentRawId, parentSessionId } = queue.shift()!;
    const parentPath = parentRawId === root.rawId ? root.path : byRawId.get(parentRawId)?.path;
    const spawnMap = parentPath ? spawnMapFor(parentRawId, parentPath) : new Map<string, string>();
    out.push({
      id: entry.id,
      toolUseId: spawnMap.get(entry.agentPath) || "",
      parentId: parentSessionId,
      agentType: entry.agentPath.split("/").filter(Boolean).pop() || "agent",
      description: entry.agentNickname,
      startedAt: entry.startedAt,
    });
    for (const child of childrenOf.get(entry.rawId) || []) {
      queue.push({ entry: child, parentRawId: entry.rawId, parentSessionId: entry.id });
    }
  }
  return out;
}
