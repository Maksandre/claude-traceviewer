import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import os from "os";

const app = express();
app.use(cors());

const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

app.get("/api/projects", (_req, res) => {
  try {
    const dirs = fs.readdirSync(PROJECTS_DIR)
      .filter((d) => fs.statSync(path.join(PROJECTS_DIR, d)).isDirectory())
      .map((d) => {
        // Find the most recent .jsonl file modification time
        const projectPath = path.join(PROJECTS_DIR, d);
        let latestMtime = 0;
        try {
          for (const f of fs.readdirSync(projectPath)) {
            if (f.endsWith(".jsonl")) {
              const mt = fs.statSync(path.join(projectPath, f)).mtimeMs;
              if (mt > latestMtime) latestMtime = mt;
            }
          }
        } catch {}
        return { name: d, mtime: latestMtime };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .map((d) => d.name);
    res.json(dirs);
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
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
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

// Get subagent conversation
app.get("/api/projects/:project/sessions/:session/agents/:agentId", (req, res) => {
  try {
    const subagentsDir = path.join(
      PROJECTS_DIR,
      req.params.project,
      req.params.session,
      "subagents"
    );
    const agentFile = path.join(subagentsDir, `agent-${req.params.agentId}.jsonl`);
    const metaFile = path.join(subagentsDir, `agent-${req.params.agentId}.meta.json`);

    const lines = fs.readFileSync(agentFile, "utf-8").split("\n").filter(Boolean);
    const records = lines.map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(metaFile, "utf-8")); } catch {}

    res.json({ meta, records });
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

    const agents = fs.readdirSync(subagentsDir)
      .filter((f) => f.endsWith(".meta.json"))
      .map((f) => {
        const id = f.replace("agent-", "").replace(".meta.json", "");
        let meta = null;
        try { meta = JSON.parse(fs.readFileSync(path.join(subagentsDir, f), "utf-8")); } catch {}
        const jsonlFile = path.join(subagentsDir, `agent-${id}.jsonl`);
        let lineCount = 0;
        try {
          lineCount = fs.readFileSync(jsonlFile, "utf-8").split("\n").filter(Boolean).length;
        } catch {}
        return { id, ...meta, lineCount };
      });
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
