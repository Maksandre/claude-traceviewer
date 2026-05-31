# Claude Trace Viewer

A local web UI for browsing Claude Code session traces stored in `~/.claude/projects/`. Lists projects and `.jsonl` session logs, renders the conversation (user/assistant turns, thinking blocks, tool calls, subagent transcripts), and auto-refreshes every 5s so live sessions stream in.

## Stack

- **Backend**: Express 5 + `tsx` (`server.ts`) — reads `.jsonl` files directly from disk, no DB.
- **Frontend**: React 19 + Vite 8 (`src/`).
- **Port**: `3099` (override with `PORT`).
- **Source dir**: `~/.claude` (override with `CLAUDE_DIR`).

## Run

```bash
npm install
npm run dev      # vite on 5173, api on 3099 (vite proxies /api)
```

Production:

```bash
npm run build && npm start    # serves dist/ + api on 3099
```

Docker:

```bash
docker compose up             # mounts ~/.claude read-only, exposes :3099
```

## API

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/projects` | project dir names, sorted by latest session mtime |
| GET | `/api/projects/:project/sessions` | sessions with `id`, `size`, `modified`, `lineCount`, `slug`, first-user-message `preview` |
| GET | `/api/projects/:project/sessions/:session` | parsed JSONL records |
| GET | `/api/projects/:project/sessions/:session/agents` | subagents from `<session>/subagents/agent-*.meta.json` |
| GET | `/api/projects/:project/sessions/:session/agents/:agentId` | `{ meta, records }` for one subagent |
| DELETE | `/api/projects/:project/sessions` | wipes all `.jsonl` + companion dirs in project |
| DELETE | `/api/projects/:project/sessions/:session` | deletes one session + its companion dir |

## Layout

```
server.ts                 Express API
src/App.tsx               root, 5s polling, drawer + view routing
src/components/           Sidebar, Toolbar, ConversationView, AgentsView,
                          StatsView, AgentDrawer, conversation/*
src/lib/                  format, icons, md, normalize, pricing.json
src/types.ts              SessionInfo, TraceRecord
```

## Cost calculation

Per-token rates live in `src/lib/pricing.json` — a snapshot of the
[LiteLLM model price registry](https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/model_prices_and_context_window_backup.json),
filtered to entries where `litellm_provider == "anthropic"` (direct Anthropic
API rates, not Bedrock/Vertex). Covers Opus 3 → 4.8, Sonnet 3.7 → 4.6, Haiku
3 → 4.5, with `input` / `output` / `cache_creation` / `cache_read` per token.

`costFor(model, usage)` in `src/lib/format.ts` resolves a rate by:

1. **exact model id** (`claude-opus-4-7-20260416`),
2. **date-stripped id** (`claude-opus-4-7`),
3. **family fallback** (opus / sonnet / haiku) if the snapshot has no match.

To refresh, re-fetch the upstream JSON and copy the entries with
`litellm_provider == "anthropic"` into `pricing.json`; bump `_meta.fetchedAt`.
