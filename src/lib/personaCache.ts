// Client-side persona cache. The trace-viewer server only sees ~/.claude (and
// optionally the project tree when running without Docker). For everything
// else — custom --plugin-dir sources, project-local agents not reachable from
// the container — the user can pick a directory in the browser and we cache
// the file contents in localStorage. Pick once, reuse across sessions.

const STORAGE_KEY = "ctv:persona-cache:v1";

export interface CachedPersona {
  content: string;
  // Path of the .md file relative to the directory the user picked. Browsers
  // do not expose absolute host paths for picked directories, so this is the
  // most precise origin we can record.
  sourceRelPath: string;
  pickedAt: string;
}

type Cache = Record<string, CachedPersona>;

function read(): Cache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function write(cache: Cache) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn("persona cache: could not write to localStorage", e);
  }
}

export function getCachedPersona(agentType: string): CachedPersona | null {
  return read()[agentType] ?? null;
}

export function clearCachedPersona(agentType: string) {
  const cache = read();
  delete cache[agentType];
  write(cache);
}

// Map a picked-directory-relative file path to an agentType. Returns null if
// the path doesn't look like an agent definition.
//
// Layouts we recognise (the segment before `agents/` is the plugin namespace
// when present, otherwise the file is a plain non-namespaced agent):
//   <root>/agents/<name>.md                            -> <name>
//   <root>/<ns>/agents/<name>.md                       -> <ns>:<name>
//   <root>/plugins/<ns>/agents/<name>.md               -> <ns>:<name>
//   <root>/skills/plugins/<ns>/agents/<name>.md        -> <ns>:<name>
//   <root>/.claude/agents/<name>.md                    -> <name>
//   <root>/.claude/plugins/<ns>/agents/<name>.md       -> <ns>:<name>
//
// "Noise" segments that we never treat as a namespace: plugins, skills,
// claude, .claude, agents itself. They're the structural layout of how
// Claude Code organises files.
const NOISE_DIRS = new Set(["", ".", "..", "plugins", "skills", "claude", ".claude", "agents"]);

export function inferAgentType(relPath: string): string | null {
  if (!relPath.endsWith(".md")) return null;
  const parts = relPath.split("/").filter(Boolean);
  // Find the deepest `agents` segment; the file must sit directly inside it.
  let agentsIx = -1;
  for (let i = parts.length - 2; i >= 0; i--) {
    if (parts[i] === "agents") { agentsIx = i; break; }
  }
  if (agentsIx < 0) return null;
  if (agentsIx !== parts.length - 2) return null;
  const name = parts[parts.length - 1].slice(0, -3);
  if (!name) return null;

  // The candidate namespace is the segment immediately before `agents/`.
  const ns = parts[agentsIx - 1];
  if (!ns || NOISE_DIRS.has(ns)) return name;
  return `${ns}:${name}`;
}

export interface PickResult {
  cancelled: boolean;
  added: { agentType: string; sourceRelPath: string }[];
  skipped: number;
  collisions: number;
}

// Open a native directory picker, walk it, cache every agent definition found.
// Returns a summary of what was loaded so the UI can show a notice. If the
// user cancels the picker, resolves with an empty result.
export function pickPluginDirectory(): Promise<PickResult> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.multiple = true;
    input.style.display = "none";

    let settled = false;
    const finish = (result: PickResult) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(result);
    };

    input.addEventListener("change", async () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) { finish({ cancelled: true, added: [], skipped: 0, collisions: 0 }); return; }
      const ingested = await ingestFiles(files);
      finish({ cancelled: false, ...ingested });
    });
    // Modern browsers (Chrome 113+, Firefox 91+, Safari 16.4+) fire `cancel`
    // when the user dismisses the picker without selecting.
    input.addEventListener("cancel", () => finish({ cancelled: true, added: [], skipped: 0, collisions: 0 }));

    document.body.appendChild(input);
    input.click();
  });
}

async function ingestFiles(files: File[]): Promise<Omit<PickResult, "cancelled">> {
  const cache = read();
  const added: PickResult["added"] = [];
  let skipped = 0;
  let collisions = 0;
  const now = new Date().toISOString();

  for (const file of files) {
    const relPath = (file as File & { webkitRelativePath: string }).webkitRelativePath || file.name;
    const agentType = inferAgentType(relPath);
    if (!agentType) { skipped++; continue; }
    let content: string;
    try { content = await file.text(); } catch { skipped++; continue; }
    if (cache[agentType]) collisions++;
    cache[agentType] = { content, sourceRelPath: relPath, pickedAt: now };
    added.push({ agentType, sourceRelPath: relPath });
  }

  write(cache);
  return { added, skipped, collisions };
}
