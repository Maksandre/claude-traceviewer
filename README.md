# Debrief

A local inspector for Claude Code sessions. Reads the `.jsonl` trace files Claude Code writes under `~/.claude/` and turns them into readable conversations plus analytics — cost, prompt-cache health, context-window headroom, where the time went, and where things went wrong.

Useful when developing custom subagents and skills: the delegation tree, per-agent transcripts, prompts, tool calls, and per-agent spend are all visible side by side, and every insight links back to the exact message that produced it.

![Conversation view](docs/img/conversation.png)

## What it shows

- The full transcript of a session: user messages, assistant turns, thinking blocks, tool calls, and tool results.
- A sidebar listing every project and session found on disk.
- Live sessions, refreshed every 5 seconds.
- In-conversation search.
- Light and dark themes.

## Stats per session

![Stats](docs/img/stats.png)

Cost, token volume, wall-clock duration, peak context vs the model's window, and a per-agent breakdown. Interactive panels surface the actionable detail:

- **Prompt caching** — a context-over-time chart marking every cache rebuild, what each cost, and why (idle TTL expiry, model switch, prefix change), each clickable to the message.
- **Cost & models** — spend per model.
- **Where the time went** — a chronological strip of agent-working vs waiting-on-you vs idle/away time, with clickable spans.
- **Friction** — tool errors and interruptions, grouped and linked.

## Subagent delegation

![Agents](docs/img/agents.png)

If the session used subagents, the delegation tree is shown with each agent's prompt, model, reasoning effort, tool calls, duration, and cost. Click a row to open that agent's transcript.

## Run

```bash
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

Single-port production build:

```bash
npm run build
npm start                  # http://localhost:3099
```

Docker:

```bash
docker compose up          # http://localhost:3099 — mounts ~/.claude read-only
```

Sessions are read from `~/.claude` by default. Override with the `CLAUDE_DIR` environment variable.

## Cost numbers

Costs are **notional**: every session is priced as if the tokens were billed at the public Anthropic API rates, regardless of how you actually pay. If you're on a Claude Pro/Max subscription, no money was charged per token — the figure shown is what the same usage would have cost on the metered API, which is a useful proxy for comparing sessions, agents, and runs against each other.

Rates come from a bundled snapshot covering Opus, Sonnet, and Haiku 3 → 4.x. Bedrock and Vertex routing are not modeled.
