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
src/App.tsx               root, 5s polling
src/components/           Sidebar, ConversationView, ToolCallBlock,
                          ThinkingBlock, AgentBlock, CollapsibleText
src/types.ts              SessionInfo, TraceRecord
```
