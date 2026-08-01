import express from "express";
import cors from "cors";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const app = express();
app.use(cors());

const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

// === File backup store ===
// Claude Code prunes its image-cache aggressively, so transcripts outlive
// the files they reference. Every image path seen in a served transcript is
// copied into a local backup store and served from there once the original
// disappears. Retention: DEBRIEF_BACKUP_TTL_DAYS (default 3) after the
// original was last seen; 0 disables the store. Location: DEBRIEF_BACKUP_DIR.
const BACKUP_TTL_DAYS = (() => {
  const n = Number(process.env.DEBRIEF_BACKUP_TTL_DAYS ?? 3);
  return Number.isFinite(n) && n >= 0 ? n : 3;
})();
const BACKUP_DIR = process.env.DEBRIEF_BACKUP_DIR || path.join(os.homedir(), ".debrief", "file-backup");
const BACKUP_ENABLED = BACKUP_TTL_DAYS > 0;
// Throttle per-path re-checks so the 2s session poll doesn't hammer the disk.
const BACKUP_RECHECK_MS = 10 * 60_000;
const backupCheckedAt = new Map<string, number>();

// Keyed by the raw path string as it appears in the transcript — the client
// requests /api/image with that exact string, so lookups always agree.
function backupKey(raw: string): string {
  return crypto.createHash("sha1").update(raw).digest("hex") + path.extname(raw).toLowerCase();
}

// Copy `src` into the store under `raw`'s key, or refresh the retention
// clock when the copy is already current. Fire-and-forget.
function backupFile(raw: string, src: string): void {
  if (!BACKUP_ENABLED) return;
  const now = Date.now();
  const last = backupCheckedAt.get(raw);
  if (last && now - last < BACKUP_RECHECK_MS) return;
  backupCheckedAt.set(raw, now);
  fs.stat(src, (err, stat) => {
    if (err || !stat.isFile()) return;
    const dest = path.join(BACKUP_DIR, backupKey(raw));
    fs.stat(dest, (derr, dstat) => {
      if (!derr && dstat.mtimeMs >= stat.mtimeMs) {
        // original unchanged and still present — refresh the retention clock
        fs.utimes(dest, new Date(), new Date(), () => {});
        return;
      }
      fs.mkdir(BACKUP_DIR, { recursive: true }, (merr) => {
        if (merr) return;
        fs.copyFile(src, dest, () => {});
      });
    });
  });
}

// Transcripts store the host's absolute path (e.g. /Users/<u>/.claude/...);
// inside a container CLAUDE_DIR points at a mounted copy, so paths under
// .claude are remapped. Anything else is read as-is (backup only — the live
// /api/image endpoint still refuses to serve outside CLAUDE_DIR).
function resolveImageSource(raw: string): string {
  const marker = "/.claude/";
  const ix = raw.indexOf(marker);
  return ix >= 0 ? path.resolve(CLAUDE_DIR, raw.slice(ix + marker.length)) : raw;
}

const IMG_MARKER_RE = /\[Image:\s*source:\s*(\/[^\]\n]+?\.(?:png|jpe?g|gif|webp|bmp|svg))\s*\]/gi;

// Scan raw transcript content for image references and back each one up
// while the original still exists.
function backupReferencedImages(content: string): void {
  if (!BACKUP_ENABLED) return;
  const seen = new Set<string>();
  const re = new RegExp(IMG_MARKER_RE.source, IMG_MARKER_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const raw = m[1];
    if (seen.has(raw)) continue;
    seen.add(raw);
    backupFile(raw, resolveImageSource(raw));
  }
}

function cleanupBackups(): void {
  if (!BACKUP_ENABLED) return;
  const cutoff = Date.now() - BACKUP_TTL_DAYS * 86_400_000;
  fs.readdir(BACKUP_DIR, (err, files) => {
    if (err) return;
    for (const f of files) {
      const p = path.join(BACKUP_DIR, f);
      fs.stat(p, (serr, st) => {
        if (!serr && st.isFile() && st.mtimeMs < cutoff) fs.unlink(p, () => {});
      });
    }
  });
}
cleanupBackups();
setInterval(cleanupBackups, 6 * 3_600_000).unref();

app.get("/api/image", (req, res) => {
  try {
    const raw = String(req.query.path || "");
    if (!raw) { res.status(400).end(); return; }
    const mime = IMAGE_MIME[path.extname(raw).toLowerCase()];
    if (!mime) { res.status(415).end(); return; }

    const serveBackup = () => {
      if (!BACKUP_ENABLED) { res.status(404).end(); return; }
      const dest = path.join(BACKUP_DIR, backupKey(raw));
      fs.stat(dest, (err, stat) => {
        if (err || !stat.isFile()) { res.status(404).end(); return; }
        res.setHeader("Content-Type", mime);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("X-Debrief-Backup", "1");
        fs.createReadStream(dest).pipe(res);
      });
    };

    // Live serving stays restricted to CLAUDE_DIR; anything else can only
    // come out of the backup store (i.e. it was referenced by a transcript).
    const abs = resolveImageSource(raw);
    const within = path.relative(CLAUDE_DIR, abs);
    if (within.startsWith("..") || path.isAbsolute(within)) { serveBackup(); return; }
    fs.stat(abs, (err, stat) => {
      if (err || !stat.isFile()) { serveBackup(); return; }
      backupFile(raw, abs);
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      fs.createReadStream(abs).pipe(res);
    });
  } catch {
    res.status(500).end();
  }
});

// Read the real working directory recorded in a session file. Claude Code's
// project-dir name encodes the path by replacing every "/" with "-", which is
// ambiguous for directories that legitimately contain dashes (e.g.
// "2026-05-subtensor" vs "2026/05/subtensor"). The `cwd` field on the records
// is the unambiguous source of truth. We only read a bounded prefix because
// cwd appears on the very first record, keeping the projects list cheap.
const CWD_SCAN_BYTES = 65536;
function readProjectCwd(projectPath: string, jsonlFiles: string[]): string {
  for (const f of jsonlFiles) {
    let fd: number | null = null;
    try {
      fd = fs.openSync(path.join(projectPath, f), "r");
      const buf = Buffer.alloc(CWD_SCAN_BYTES);
      const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
      for (const line of buf.toString("utf-8", 0, bytes).split("\n")) {
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (typeof obj.cwd === "string" && obj.cwd) return obj.cwd;
        } catch {
          // truncated trailing line in the bounded read — ignore and move on
        }
      }
    } catch {
      // unreadable file — try the next one
    } finally {
      if (fd !== null) try { fs.closeSync(fd); } catch {}
    }
  }
  return "";
}

app.get("/api/projects", (_req, res) => {
  try {
    const projects = fs.readdirSync(PROJECTS_DIR)
      .filter((d) => fs.statSync(path.join(PROJECTS_DIR, d)).isDirectory())
      .map((d) => {
        const projectPath = path.join(PROJECTS_DIR, d);
        let latestMtime = 0;
        const jsonlFiles: string[] = [];
        try {
          for (const f of fs.readdirSync(projectPath)) {
            if (f.endsWith(".jsonl")) {
              jsonlFiles.push(f);
              const mt = fs.statSync(path.join(projectPath, f)).mtimeMs;
              if (mt > latestMtime) latestMtime = mt;
            }
          }
        } catch {}
        const cwd = readProjectCwd(projectPath, jsonlFiles);
        return { name: d, sessionCount: jsonlFiles.length, mtime: latestMtime, cwd };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json(projects);
  } catch {
    res.json([]);
  }
});

app.get("/api/projects/:project/sessions", (req, res) => {
  try {
    const projectDir = path.join(PROJECTS_DIR, req.params.project);
    const files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const stat = fs.statSync(path.join(projectDir, f));
        const lines = fs
          .readFileSync(path.join(projectDir, f), "utf-8")
          .split("\n")
          .filter(Boolean);

        let slug = "";
        let firstUserMsg = "";
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.slug && !slug) slug = obj.slug;
            if (
              obj.type === "user" &&
              !firstUserMsg &&
              obj.message?.content
            ) {
              const content =
                typeof obj.message.content === "string"
                  ? obj.message.content
                  : obj.message.content
                      .filter((b: any) => b.type === "text")
                      .map((b: any) => b.text)
                      .join(" ");
              firstUserMsg = content.slice(0, 120);
            }
            if (slug && firstUserMsg) break;
          } catch {}
        }

        return {
          id: f.replace(".jsonl", ""),
          file: f,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          lineCount: lines.length,
          slug,
          preview: firstUserMsg,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.modified).getTime() - new Date(a.modified).getTime()
      );
    res.json(files);
  } catch {
    res.json([]);
  }
});

app.get("/api/projects/:project/sessions/:session", (req, res) => {
  try {
    const filePath = path.join(
      PROJECTS_DIR,
      req.params.project,
      req.params.session + ".jsonl"
    );
    // Conditional GET: poll fires every few seconds; when the .jsonl file
    // hasn't been touched we return 304 so the browser tab loader barely
    // flickers and the client skips its re-normalize pass entirely.
    const stat = fs.statSync(filePath);
    const lastModified = stat.mtime.toUTCString();
    const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
    res.set("Cache-Control", "no-cache");
    res.set("Last-Modified", lastModified);
    res.set("ETag", etag);
    const inm = req.header("if-none-match");
    const ims = req.header("if-modified-since");
    if ((inm && inm === etag) || (ims && new Date(ims).getTime() >= Math.floor(stat.mtimeMs))) {
      res.status(304).end();
      return;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    backupReferencedImages(content);
    const lines = content.split("\n").filter(Boolean);
    const records = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
    res.json(records);
  } catch {
    res.status(404).json({ error: "Session not found" });
  }
});

// Resolve a subagent's persona (the .md file the model reads as its system prompt).
// Covers the standard Claude Code agent layouts. Note that paths under <cwd>
// (project-local agents) only resolve if the server has filesystem access to
// the project directory — true when running via `npm start`, but not in the
// default Docker setup which only mounts ~/.claude. Custom --plugin-dir
// sources are not covered.
// Returns the first match plus its resolved path, or null.
function resolvePersona(cwd: string, agentType: string): { content: string; resolvedPath: string } | null {
  const tryRead = (p: string) => {
    try {
      const stat = fs.statSync(p);
      if (stat.isFile()) return { content: fs.readFileSync(p, "utf-8"), resolvedPath: p };
    } catch {}
    return null;
  };

  const candidates: string[] = [];

  // 1. Project-local standard agents (cwd-reachable only).
  if (cwd) candidates.push(path.join(cwd, ".claude/agents", `${agentType}.md`));

  // 2. User-level standard agents.
  candidates.push(path.join(CLAUDE_DIR, "agents", `${agentType}.md`));

  // 3. Namespaced types like "qa:poc-writer" → ns="qa", name="poc-writer".
  const m = agentType.match(/^([^:]+):(.+)$/);
  if (m) {
    const ns = m[1];
    const name = m[2];

    // 3a. Project-local plugins (cwd-reachable only).
    if (cwd) {
      candidates.push(path.join(cwd, ".claude/plugins", ns, "agents", `${name}.md`));
      candidates.push(path.join(cwd, ".claude/skills", ns, "agents", `${name}.md`));
    }

    // 3b. Marketplace-installed plugin agents.
    const cacheRoot = path.join(CLAUDE_DIR, "plugins/cache");
    try {
      for (const market of fs.readdirSync(cacheRoot)) {
        const pluginDir = path.join(cacheRoot, market, ns);
        try {
          for (const ver of fs.readdirSync(pluginDir)) {
            candidates.push(path.join(pluginDir, ver, "agents", `${name}.md`));
          }
        } catch {}
      }
    } catch {}
  }

  for (const c of candidates) {
    const hit = tryRead(c);
    if (hit) return hit;
  }
  return null;
}

// Locate a subagent's files. Standard subagents live flat under
// `subagents/agent-<id>.{jsonl,meta.json}`. Workflow agents (spawned by the
// Workflow tool) live one level deeper under
// `subagents/workflows/<runId>/agent-<id>.{jsonl,meta.json}` alongside a
// shared `journal.jsonl`. Resolve either layout from just the agentId.
function locateAgent(subagentsDir: string, agentId: string):
  { jsonlPath: string; metaPath: string; workflowDir?: string; workflowId?: string } | null {
  const flatJsonl = path.join(subagentsDir, `agent-${agentId}.jsonl`);
  if (fs.existsSync(flatJsonl)) {
    return { jsonlPath: flatJsonl, metaPath: path.join(subagentsDir, `agent-${agentId}.meta.json`) };
  }
  const wfRoot = path.join(subagentsDir, "workflows");
  try {
    for (const wf of fs.readdirSync(wfRoot)) {
      const workflowDir = path.join(wfRoot, wf);
      const j = path.join(workflowDir, `agent-${agentId}.jsonl`);
      if (fs.existsSync(j)) {
        return { jsonlPath: j, metaPath: path.join(workflowDir, `agent-${agentId}.meta.json`), workflowDir, workflowId: wf };
      }
    }
  } catch { /* no workflows dir — fall through */ }
  return null;
}

// A workflow's journal.jsonl records the structured `result` each agent
// returned to the orchestrator (the authoritative output for agents that
// emit a StructuredOutput rather than a final text block). Returns the last
// result recorded for the agent, or null.
function readWorkflowResult(workflowDir: string, agentId: string): unknown {
  try {
    const lines = fs.readFileSync(path.join(workflowDir, "journal.jsonl"), "utf-8").split("\n").filter(Boolean);
    let result: unknown = null;
    for (const line of lines) {
      try {
        const o = JSON.parse(line);
        if (o?.type === "result" && o.agentId === agentId) result = o.result;
      } catch { /* skip malformed journal line */ }
    }
    return result;
  } catch {
    return null;
  }
}

// Get subagent conversation
app.get("/api/projects/:project/sessions/:session/agents/:agentId", (req, res) => {
  try {
    const subagentsDir = path.join(
      PROJECTS_DIR,
      req.params.project,
      req.params.session,
      "subagents"
    );
    const located = locateAgent(subagentsDir, req.params.agentId);
    if (!located) { res.status(404).json({ error: "Agent not found" }); return; }
    const agentFile = located.jsonlPath;
    const metaFile = located.metaPath;

    // Conditional GET: the client polls this endpoint every few seconds while
    // the subagent is running. The validator combines both files so that meta
    // arriving after the first records still busts the cache.
    const agentStat = fs.statSync(agentFile);
    let metaMtimeMs = 0;
    let metaSize = 0;
    try {
      const ms = fs.statSync(metaFile);
      metaMtimeMs = ms.mtimeMs;
      metaSize = ms.size;
    } catch {}
    const lastMtimeMs = Math.max(agentStat.mtimeMs, metaMtimeMs);
    const lastModified = new Date(lastMtimeMs).toUTCString();
    const etag = `"${agentStat.mtimeMs.toString(36)}-${agentStat.size.toString(36)}-${metaMtimeMs.toString(36)}-${metaSize.toString(36)}"`;
    res.set("Cache-Control", "no-cache");
    res.set("Last-Modified", lastModified);
    res.set("ETag", etag);
    const inm = req.header("if-none-match");
    const ims = req.header("if-modified-since");
    if ((inm && inm === etag) || (ims && new Date(ims).getTime() >= Math.floor(lastMtimeMs))) {
      res.status(304).end();
      return;
    }

    const agentContent = fs.readFileSync(agentFile, "utf-8");
    backupReferencedImages(agentContent);
    const lines = agentContent.split("\n").filter(Boolean);
    const records = lines.map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(metaFile, "utf-8")); } catch {}

    let cwd = "";
    for (const r of records) {
      if (r?.cwd) { cwd = r.cwd; break; }
    }
    const persona = meta?.agentType ? resolvePersona(cwd, meta.agentType) : null;

    // For workflow agents, the journal holds the structured result the agent
    // returned to the orchestrator — more authoritative than the last assistant
    // text (which may be empty when the agent ends on a StructuredOutput call).
    const workflowResult = located.workflowDir ? readWorkflowResult(located.workflowDir, req.params.agentId) : null;

    res.json({ meta, records, persona, workflowId: located.workflowId, workflowResult });
  } catch {
    res.status(404).json({ error: "Agent not found" });
  }
});

// List available subagents for a session
app.get("/api/projects/:project/sessions/:session/agents", (req, res) => {
  try {
    const subagentsDir = path.join(
      PROJECTS_DIR,
      req.params.project,
      req.params.session,
      "subagents"
    );
    if (!fs.existsSync(subagentsDir)) { res.json([]); return; }

    const lineCountOf = (jsonlFile: string) => {
      try { return fs.readFileSync(jsonlFile, "utf-8").split("\n").filter(Boolean).length; }
      catch { return 0; }
    };
    const readMetaFile = (p: string) => {
      try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
    };

    const agents: any[] = [];

    // Standard subagents, flat under subagents/.
    for (const f of fs.readdirSync(subagentsDir)) {
      if (!f.endsWith(".meta.json")) continue;
      const id = f.replace("agent-", "").replace(".meta.json", "");
      const meta = readMetaFile(path.join(subagentsDir, f));
      agents.push({ id, ...meta, lineCount: lineCountOf(path.join(subagentsDir, `agent-${id}.jsonl`)) });
    }

    // Workflow agents, nested under subagents/workflows/<runId>/. Each is
    // tagged with its workflowId (the run dir name) so the client can group
    // them under the Workflow tool call that launched them.
    const wfRoot = path.join(subagentsDir, "workflows");
    try {
      for (const wf of fs.readdirSync(wfRoot)) {
        const wfDir = path.join(wfRoot, wf);
        let entries: string[] = [];
        try { entries = fs.readdirSync(wfDir); } catch { continue; }
        for (const f of entries) {
          if (!f.endsWith(".meta.json")) continue;
          const id = f.replace("agent-", "").replace(".meta.json", "");
          const meta = readMetaFile(path.join(wfDir, f));
          agents.push({ id, ...meta, workflowId: wf, lineCount: lineCountOf(path.join(wfDir, `agent-${id}.jsonl`)) });
        }
      }
    } catch { /* no workflows dir */ }

    res.json(agents);
  } catch {
    res.json([]);
  }
});

app.delete("/api/projects/:project/sessions", (req, res) => {
  try {
    const projectDir = path.join(PROJECTS_DIR, req.params.project);
    const files = fs.readdirSync(projectDir);
    for (const f of files) {
      const fp = path.join(projectDir, f);
      if (f.endsWith(".jsonl")) {
        fs.unlinkSync(fp);
        const companionDir = path.join(projectDir, f.replace(".jsonl", ""));
        if (fs.existsSync(companionDir) && fs.statSync(companionDir).isDirectory()) {
          fs.rmSync(companionDir, { recursive: true });
        }
      }
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete sessions" });
  }
});

app.delete("/api/projects/:project/sessions/:session", (req, res) => {
  try {
    const filePath = path.join(
      PROJECTS_DIR,
      req.params.project,
      req.params.session + ".jsonl"
    );
    fs.unlinkSync(filePath);
    // Also remove companion directory if exists
    const dirPath = path.join(PROJECTS_DIR, req.params.project, req.params.session);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      fs.rmSync(dirPath, { recursive: true });
    }
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Session not found" });
  }
});

// Serve static frontend in production
const distPath = path.join(import.meta.dirname, "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

const PORT = parseInt(process.env.PORT || "3099");
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Claude Trace Viewer running on http://localhost:${PORT}`);
});
