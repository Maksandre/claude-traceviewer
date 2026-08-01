import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icons, toolIcon } from "../../lib/icons";
import { agentColor, fmtDur, fmtTime, fmtTokens, modelColor, modelLabel } from "../../lib/format";
import { Caret, ClampBlock, CodeBlock, Markdown, MoreButton } from "../../lib/md";
import type { NormAgent, NormBlock, NormMsg, NormToolResult } from "../../lib/normalize";
import { toolColor } from "../../lib/format";
import { usePermalinks } from "../../lib/permalinkCtx";
import { copyText } from "../../lib/clipboard";
import { ToolName } from "../ToolName";

// Shared copy primitive for the id buttons: joins `key=value` pairs into a
// single self-describing line (`session=… msg=… block=…`) so a paste stays
// readable without the surrounding UI.
function copyIds(params: Record<string, string | null | undefined>, done: () => void) {
  const text = Object.entries(params)
    .filter(([, v]) => !!v)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  copyText(text).then(ok => { if (ok) done(); });
}

// Briefly add `is-target` to an element, then strip it. Used to flash
// the row/block the user just clicked or deep-linked to.
function flashTarget(el: HTMLElement | null) {
  if (!el) return;
  el.classList.add("is-target");
  window.setTimeout(() => el.classList.remove("is-target"), 2400);
}

// Small copy button in the .msg-head that copies the session + message
// ids for the current row, so it picks up the same hover row.
export function MsgPermalink({ msgKey }: { msgKey: string }) {
  const [copied, setCopied] = useState(false);
  const api = usePermalinks();
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    flashTarget((e.currentTarget as HTMLElement).closest(".msg") as HTMLElement | null);
    copyIds({ session: api?.sessionId, msg: msgKey }, () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1100);
    });
  };
  return (
    <button
      type="button"
      className={"msg-permalink " + (copied ? "is-copied" : "")}
      onClick={onClick}
      title={copied ? "Ids copied" : "Copy session & message id"}
      aria-label="Copy session & message id"
    >
      {copied ? <Icons.check size={11} /> : <Icons.copy size={11} />}
    </button>
  );
}

// Per-block copy button. Sits inside a `.blk-anchor` wrapper that hosts
// the `data-block-id` used by ConversationView's deep-link scroll. The
// button is rendered inside a sticky slot so it stays pinned at the
// block's top-right corner while the block scrolls past.
export function BlockPermalink({ msgKey, blockId, label }: { msgKey: string; blockId: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const api = usePermalinks();
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    flashTarget((e.currentTarget as HTMLElement).closest(".blk-anchor") as HTMLElement | null);
    copyIds({ session: api?.sessionId, msg: msgKey, block: blockId }, () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1100);
    });
  };
  return (
    <button
      type="button"
      className={"blk-permalink " + (copied ? "is-copied" : "")}
      onClick={onClick}
      title={copied ? "Ids copied" : `Copy ids for this ${label}`}
      aria-label={`Copy ids for this ${label}`}
    >
      {copied ? <Icons.check size={16} /> : <Icons.copy size={16} />}
    </button>
  );
}

// Wrapper for each rendered block. The `.blk-permalink-slot` is an
// absolutely positioned full-height strip to the right of the block —
// it bridges the gap so :hover survives mouse traversal, AND it gives
// the sticky button a tall containing block to slide through as the
// block scrolls past the viewport top.
export function BlockAnchor({ msgKey, blockId, entityLabel, children }: {
  msgKey: string;
  blockId: string;
  entityLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="blk-anchor" data-block-id={blockId}>
      {children}
      <div className="blk-permalink-slot">
        <BlockPermalink msgKey={msgKey} blockId={blockId} label={entityLabel} />
      </div>
    </div>
  );
}

export function toolSummary(name: string | undefined, input: any): string {
  if (!input || typeof input !== "object") return "";
  const i = input;
  if (name === "Bash") return i.command || i.description || "";
  if (name === "Read" || name === "Write" || name === "Edit" || name === "MultiEdit")
    return (i.file_path || "").replace(/^.*\/(?=[^/]+\/[^/]+$)/, "…/");
  if (name === "Grep") return i.pattern + (i.path ? "  ·  " + i.path : "");
  if (name === "Glob") return i.pattern || "";
  if (name === "WebFetch" || name === "WebSearch") return i.url || i.query || "";
  if (name === "Agent" || name === "Task") return i.description || i.subagent_type || "";
  if (name === "ToolSearch") return i.query || "";
  const first = Object.values(i)[0];
  return typeof first === "string" ? first : JSON.stringify(i).slice(0, 80);
}

function resultText(content: NormToolResult["content"] | undefined): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b: any) => b?.type === "text" ? b.text : b?.type === "image" ? "🖼 [image]" : JSON.stringify(b)).join("\n");
  }
  return JSON.stringify(content, null, 2);
}

export function ThinkingBlock({ text, defaultOpen }: { text: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const preview = (text || "").trim().replace(/\s+/g, " ").slice(0, 140);
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  return (
    <div className={"blk think " + (open ? "is-open" : "")}>
      <button className="blk-head" onClick={() => setOpen(o => !o)}>
        <Caret open={open} />
        <span className="blk-ic think-ic"><Icons.brain size={14} /></span>
        <span className="blk-title">Thinking</span>
        <span className="blk-meta">{words} words</span>
        {!open && preview ? <span className="think-preview">{preview}…</span> : null}
      </button>
      {open ? <div className="think-body"><Markdown text={text} /></div> : null}
    </div>
  );
}

function ToolInput({ input }: { input: any }) {
  if (!input) return null;
  const entries = Object.entries(input);
  return (
    <div className="kv">
      {entries.map(([k, v]) => {
        const long = typeof v === "string" && ((v as string).length > 80 || (v as string).includes("\n"));
        if (k === "prompt" || (long && (k === "command" || k === "content" || k === "old_string" || k === "new_string"))) {
          return (
            <div className="kv-row col" key={k}>
              <span className="kv-k mono">{k}</span>
              <CodeBlock code={String(v)} max={300} />
            </div>
          );
        }
        return (
          <div className="kv-row" key={k}>
            <span className="kv-k mono">{k}</span>
            <span className="kv-v mono">{typeof v === "string" ? (v as string) : JSON.stringify(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ToolCard({ block, result, defaultOpen }: { block: NormBlock; result?: NormToolResult; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const TI = toolIcon(block.name);
  const col = toolColor(block.name);
  const summary = toolSummary(block.name, block.input);
  const isErr = !!result?.is_error;
  const hasResult = !!result;
  const rtext = hasResult ? resultText(result.content) : "";
  return (
    <div className={"blk tool " + (open ? "is-open" : "")} style={{ "--tc": col } as React.CSSProperties}>
      <button className="blk-head tool-head" onClick={() => setOpen(o => !o)}>
        <Caret open={open} />
        <span className="blk-ic tool-ic" style={{ color: col, background: `color-mix(in oklch, ${col} 16%, transparent)` }}>
          <TI size={13} />
        </span>
        <span className="tool-name"><ToolName name={block.name} /></span>
        {summary ? <span className="tool-summary">{summary}</span> : null}
        <span className="tool-status">
          {hasResult ? (
            isErr
              ? <span className="st err"><Icons.alert size={12} />error</span>
              : <span className="st ok"><Icons.check size={12} /></span>
          ) : <span className="st pend">·</span>}
        </span>
      </button>
      {open ? (
        <div className="tool-body">
          <div className="tool-input">
            <div className="kv-label">input</div>
            <ToolInput input={block.input} />
          </div>
          {hasResult ? (
            <div className={"tool-result " + (isErr ? "is-err" : "")}>
              <div className="kv-label">{isErr ? "error" : "result"}</div>
              <CodeBlock code={rtext} max={360} />
            </div>
          ) : <div className="tool-pending">awaiting result…</div>}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ result }: { result?: NormToolResult }) {
  if (!result) return <span className="st pend" title="awaiting result">·</span>;
  if (result.is_error) return <span className="st err" title="error"><Icons.alert size={12} />error</span>;
  return <span className="st ok" title="ok"><Icons.check size={12} /></span>;
}

function statusTone(status: string): "ok" | "warn" | "err" | "muted" {
  if (status === "completed" || status === "done") return "ok";
  if (status === "in_progress" || status === "running" || status === "active") return "warn";
  if (status === "cancelled" || status === "failed" || status === "error") return "err";
  return "muted";
}

export interface TaskSnapshot {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: string;
}

function statusIcon(status: string) {
  if (status === "completed") return <Icons.check size={11} />;
  if (status === "in_progress" || status === "running" || status === "active") return <Icons.dot size={9} />;
  if (status === "cancelled" || status === "failed" || status === "error") return <Icons.close size={10} />;
  return null;
}

export function TaskListPanel({ tasks, highlightId, defaultOpen = false }: { tasks: TaskSnapshot[]; highlightId?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!tasks.length) return null;
  const done = tasks.filter(t => t.status === "completed").length;
  const inProg = tasks.filter(t => t.status === "in_progress" || t.status === "running").length;
  return (
    <div className={"task-list " + (open ? "is-open" : "")}>
      <button className="task-list-head" onClick={() => setOpen(o => !o)} type="button">
        <Caret open={open} />
        <span className="task-list-label">Task list</span>
        <span className="task-list-progress tnum">{done}/{tasks.length} done</span>
        {inProg > 0 ? <span className="task-list-running tnum">{inProg} running</span> : null}
      </button>
      {open ? (
        <ol className="task-list-items">
          {tasks.map(t => {
            const tone = statusTone(t.status);
            const isHi = !!highlightId && t.id === highlightId;
            return (
              <li key={t.id} className={"task-list-item tone-" + tone + (isHi ? " is-hi" : "")}>
                <span className={"task-list-mark " + tone}>{statusIcon(t.status)}</span>
                <span className="task-list-id mono">#{t.id}</span>
                <div className="task-list-body">
                  <div className="task-list-subject">{t.subject || <span className="task-list-untitled">(untitled)</span>}</div>
                  {(t.status === "in_progress" || t.status === "running") && t.activeForm ? (
                    <div className="task-list-sub">{t.activeForm}</div>
                  ) : null}
                </div>
                <span className={"task-list-statuspill " + tone}>{(t.status || "pending").replace(/_/g, " ")}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

export function TaskCreateCard({ block, result, tasks = [] }: { block: NormBlock; result?: NormToolResult; tasks?: TaskSnapshot[] }) {
  const subject = (block.input?.subject as string) || (block.input?.title as string) || "";
  const description = (block.input?.description as string) || "";
  const activeForm = (block.input?.activeForm as string) || "";
  const createdId = (() => {
    if (!result) return undefined;
    const text = typeof result.content === "string"
      ? result.content
      : Array.isArray(result.content)
        ? result.content.map((b: any) => b?.text || "").join("\n")
        : "";
    const m = text.match(/Task\s*#(\d+)/i);
    return m ? m[1] : undefined;
  })();
  return (
    <div className="task-card create">
      <div className="task-card-head">
        <span className="task-card-ic accent"><Icons.plus size={13} /></span>
        <span className="task-card-kind">Task created</span>
        {createdId ? <span className="task-card-id mono">#{createdId}</span> : null}
        <span className="task-card-status"><StatusBadge result={result} /></span>
      </div>
      {(subject || description || activeForm) ? (
        <div className="task-card-body">
          {subject ? <div className="task-card-subject">{subject}</div> : null}
          {description ? <div className="task-card-desc">{description}</div> : null}
          {activeForm ? <div className="task-card-active">{activeForm}</div> : null}
        </div>
      ) : null}
      <TaskListPanel tasks={tasks} highlightId={createdId} />
    </div>
  );
}

export function TaskUpdateCard({ block, result, tasks = [] }: { block: NormBlock; result?: NormToolResult; tasks?: TaskSnapshot[] }) {
  const raw = block.input?.taskId;
  const taskId = raw !== undefined && raw !== null ? String(raw) : "";
  const status = (block.input?.status as string) || "";
  const tone = statusTone(status);
  return (
    <div className="task-card update">
      <div className="task-card-head">
        <span className={"task-card-ic " + tone}><Icons.tasks size={13} /></span>
        <span className="task-card-kind">Task update</span>
        {taskId ? <span className="task-card-id mono">#{taskId}</span> : null}
        {status ? (
          <>
            <span className="task-arrow"><Icons.arrowRight size={11} /></span>
            <span className={"task-card-statuspill " + tone}>{status.replace(/_/g, " ")}</span>
          </>
        ) : null}
        <span className="task-card-status"><StatusBadge result={result} /></span>
      </div>
      <TaskListPanel tasks={tasks} highlightId={taskId} />
    </div>
  );
}

export function TaskGenericCard({ block, result, tasks = [], defaultOpen }: { block: NormBlock; result?: NormToolResult; tasks?: TaskSnapshot[]; defaultOpen?: boolean }) {
  return (
    <>
      <ToolCard block={block} result={result} defaultOpen={defaultOpen} />
      {tasks.length ? <TaskListPanel tasks={tasks} /> : null}
    </>
  );
}

interface AskQuestion {
  question?: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label?: string; description?: string }[];
}

export function AskUserQuestionCard({ block, result }: { block: NormBlock; result?: NormToolResult }) {
  const questions: AskQuestion[] = Array.isArray(block.input?.questions) ? (block.input!.questions as AskQuestion[]) : [];
  const hasResult = !!result;
  const isErr = !!result?.is_error;
  const answerText = hasResult ? resultText(result.content) : "";
  return (
    <div className="ask-card">
      <div className="ask-card-head">
        <span className="ask-card-ic"><Icons.question size={14} /></span>
        <span className="ask-card-label">Asked the user</span>
        <span className="ask-card-status">
          {!hasResult ? (
            <span className="ask-card-pill warn">waiting…</span>
          ) : isErr ? (
            <span className="ask-card-pill err"><Icons.alert size={11} />error</span>
          ) : (
            <span className="ask-card-pill ok"><Icons.check size={11} />answered</span>
          )}
        </span>
      </div>
      <div className="ask-card-body">
        {questions.map((q, i) => (
          <div className="ask-q" key={i}>
            <div className="ask-q-head">
              {q.header ? <span className="ask-q-chip">{q.header}</span> : null}
              <span className="ask-q-mode mono">{q.multiSelect ? "multi-select" : "single-select"}</span>
            </div>
            {q.question ? <div className="ask-q-text">{q.question}</div> : null}
            {Array.isArray(q.options) && q.options.length ? (
              <div className="ask-q-opts">
                {q.options.map((o, j) => (
                  <div className="ask-opt" key={j}>
                    <span className={"ask-opt-mark " + (q.multiSelect ? "sq" : "ci")} />
                    <div className="ask-opt-body">
                      {o.label ? <div className="ask-opt-label">{o.label}</div> : null}
                      {o.description ? <div className="ask-opt-desc">{o.description}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {hasResult && answerText ? (
          <div className="ask-card-answer">
            <div className="kv-label">user answered</div>
            <CodeBlock code={answerText} max={240} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// AgentSpawnCard now lives in Transcript.tsx so it can recursively render a
// subagent's transcript inline without a circular import through blocks.tsx.

export interface TaskNotificationData {
  taskId: string;
  toolUseId: string;
  outputFile: string;
  status: string;
  summary: string;
  result: string;
  tokens: number;
  toolUses: number;
  durationMs: number;
}

export function parseTaskNotification(text: string): TaskNotificationData | null {
  if (!text || !text.includes("<task-notification>")) return null;
  const get = (tag: string) => {
    const m = text.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
    return m ? m[1].trim() : "";
  };
  return {
    taskId: get("task-id"),
    toolUseId: get("tool-use-id"),
    outputFile: get("output-file"),
    status: get("status"),
    summary: get("summary"),
    result: get("result"),
    tokens: +get("subagent_tokens") || 0,
    toolUses: +get("tool_uses") || 0,
    durationMs: +get("duration_ms") || 0,
  };
}

export function TaskNotificationCard({ data, agent, onOpen, ts }: { data: TaskNotificationData; agent?: NormAgent; onOpen: (id: string) => void; ts: string }) {
  const [open, setOpen] = useState(false);
  const col = agent ? agentColor(agent.agentType) : `oklch(0.70 0.12 155)`;
  const done = data.status === "completed";
  const agentName = (data.summary.match(/"([^"]+)"/) || [])[1] || (agent && agent.description);
  return (
    <div className="tasknote fade-in" style={{ "--ac": col } as React.CSSProperties}>
      <div className="tasknote-head">
        <span className="tasknote-ic" style={{ color: col, background: `color-mix(in oklch, ${col} 16%, transparent)` }}>
          <Icons.agent size={15} />
        </span>
        <div className="tasknote-titles">
          <div className="tasknote-title">
            Subagent finished
            <span className={"tn-status " + (done ? "ok" : "")}>
              {done ? <Icons.check size={11} /> : <Icons.alert size={11} />}{data.status}
            </span>
          </div>
          {agentName ? <div className="tasknote-sub">{agentName}{agent ? <span className="mono"> · {agent.agentType}</span> : null}</div> : null}
        </div>
        <span className="tasknote-time">{fmtTime(ts)}</span>
      </div>

      <div className="tasknote-stats tnum">
        <span><Icons.hash size={11} />{fmtTokens(data.tokens)} tok</span>
        <span><Icons.terminal size={11} />{data.toolUses} tools</span>
        <span><Icons.clock size={11} />{fmtDur(data.durationMs)}</span>
        {agent ? (
          <span style={{ color: modelColor(agent.model) }}>
            <span className="model-dot" style={{ background: modelColor(agent.model) }} />{modelLabel(agent.model)}
          </span>
        ) : null}
      </div>

      {data.result ? (
        <div className="tasknote-result">
          <div className={"tasknote-result-body " + (open ? "open" : "")}>
            <Markdown text={data.result} />
          </div>
          {data.result.length > 240 ? <MoreButton open={open} onClick={() => setOpen(o => !o)} moreLabel="Expand full result" /> : null}
        </div>
      ) : null}

      <div className="tasknote-foot">
        {data.outputFile ? (
          <span className="tasknote-file" title={data.outputFile}>
            <Icons.file size={11} />{data.outputFile.replace(/^.*\/tasks\//, "tasks/")}
          </span>
        ) : null}
        {agent ? <button className="tasknote-open" onClick={() => onOpen(agent.id)}>inspect run<Icons.arrowRight size={13} /></button> : null}
      </div>
    </div>
  );
}

function looksLikeKey(s: string): boolean {
  return /^[a-z][a-z0-9_-]{1,40}$/i.test(s) && s.length <= 40;
}

export function SystemMetaCard({ tag, inner }: { tag: string; inner: string }) {
  const trimmed = inner.trim();
  // collect top-level child tags
  const nested: { tag: string; body: string }[] = [];
  const re = /<([a-z0-9_-]+)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  let consumed = "";
  while ((m = re.exec(trimmed))) {
    nested.push({ tag: m[1], body: m[2].trim() });
    consumed += m[0];
  }
  const allWrapped = nested.length > 0 && consumed.length >= trimmed.length - 4;
  const allShort = nested.every(n => n.body.length < 80 && looksLikeKey(n.tag) && !n.body.includes("\n"));

  return (
    <div className="sysmeta">
      <div className="sysmeta-tag">
        <Icons.file size={11} />
        {tag.replace(/-/g, " ")}
      </div>
      {nested.length && allWrapped && allShort ? (
        <div className="sysmeta-kv">
          {nested.map((n, i) => (
            <div className="sysmeta-row" key={i}>
              <span className="sysmeta-k">{n.tag.replace(/_/g, " ")}</span>
              <span className="sysmeta-v">{n.body}</span>
            </div>
          ))}
        </div>
      ) : nested.length && allWrapped ? (
        <div className="sysmeta-nested">
          {nested.map((n, i) => (
            <div className="sysmeta-nested-item" key={i}>
              <div className="sysmeta-nested-head">{n.tag.replace(/[-_]/g, " ")}</div>
              <div className="sysmeta-nested-body"><Markdown text={n.body} /></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="sysmeta-body"><Markdown text={trimmed} /></div>
      )}
    </div>
  );
}

// === Injected-context attachments ===
// Attachment records are context the harness slid into the next model call
// (skill listings, deferred-tool deltas, nested memory files, IDE state, …).
// They're background noise most of the time, so a group of consecutive
// injections renders as one collapsed row with per-item summaries.

interface AttachmentSummary { label: string; brief: string; detail: string }

const countOf = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
const joinLines = (v: unknown): string => (Array.isArray(v) ? v.join("\n") : "");
// Long paths read as noise in a one-line summary; keep the last two segments.
const shortPath = (v: unknown): string => String(v || "").replace(/^.*\/(?=[^/]+\/[^/]+$)/, "…/");
// Attachment `content` isn't always a string — nested_memory wraps the text
// in {path, type, content}. Unwrap known shapes; JSON as the last resort.
function detailText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.content === "string") return o.content;
    if (typeof o.text === "string") return o.text;
    return JSON.stringify(v, null, 2);
  }
  return String(v);
}

function attachmentSummary(a: Record<string, unknown>): AttachmentSummary {
  const type = String(a.type || "attachment");
  const label = type.replace(/_/g, " ");
  switch (type) {
    case "skill_listing": {
      const n = typeof a.skillCount === "number" ? a.skillCount : countOf(a.names);
      return { label: "skills", brief: String(n), detail: detailText(a.content) };
    }
    case "deferred_tools_delta": {
      const added = countOf(a.addedNames);
      const removed = countOf(a.removedNames);
      const brief = [added ? `+${added}` : "", removed ? `−${removed}` : ""].filter(Boolean).join(" ") || "±0";
      const detail = [
        added ? `added:\n${joinLines(a.addedNames)}` : "",
        removed ? `removed:\n${joinLines(a.removedNames)}` : "",
      ].filter(Boolean).join("\n\n");
      return { label: "deferred tools", brief, detail };
    }
    case "agent_listing_delta": {
      const added = countOf(a.addedTypes);
      const removed = countOf(a.removedTypes);
      const brief = [added ? `+${added}` : "", removed ? `−${removed}` : ""].filter(Boolean).join(" ") || "±0";
      return { label: "agent types", brief, detail: joinLines(a.addedLines) || joinLines(a.addedTypes) };
    }
    case "command_permissions":
      return { label: "permissions", brief: `${countOf(a.allowedTools)}`, detail: joinLines(a.allowedTools) };
    case "nested_memory":
      return { label: "memory", brief: shortPath(a.displayPath || a.path), detail: detailText(a.content) };
    case "file":
      return { label: "file", brief: shortPath(a.displayPath || a.filename), detail: detailText(a.content) };
    case "directory":
      return { label: "directory", brief: shortPath(a.displayPath || a.path), detail: detailText(a.content) };
    case "task_reminder":
      return { label: "task reminder", brief: typeof a.itemCount === "number" ? String(a.itemCount) : "", detail: detailText(a.content) };
    case "opened_file_in_ide":
      return { label: "opened in IDE", brief: String(a.filename || "").split("/").pop() || "", detail: "" };
    case "diagnostics":
      return { label: "diagnostics", brief: `${countOf(a.files)} files`, detail: JSON.stringify(a.files ?? a, null, 2) };
    default: {
      const rest = Object.fromEntries(Object.entries(a).filter(([k]) => k !== "type"));
      return { label, brief: "", detail: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : "" };
    }
  }
}

// One quiet mono line aligned with the content column — harness plumbing
// shouldn't compete with the conversation. Expands into a detail card.
export function AttachmentGroup({ msgs, extraClass = "" }: { msgs: NormMsg[]; extraClass?: string }) {
  const [open, setOpen] = useState(false);
  const items = msgs.flatMap(m => m.blocks
    .filter(b => b.type === "attachment" && b.attachment)
    .map(b => ({ uuid: m.uuid, ts: m.ts, sum: attachmentSummary(b.attachment!) })));
  if (!items.length) return null;
  const line = items.map(it => (it.sum.brief ? `${it.sum.label} ${it.sum.brief}` : it.sum.label)).join("  ·  ");
  return (
    <div className={"msg attach-row " + (extraClass || "fade-in")}>
      <div className="msg-gutter" />
      <div className="msg-main">
        <button
          className="attach-line"
          onClick={() => setOpen(o => !o)}
          type="button"
          title={`${fmtTime(msgs[0].ts)} — context the harness injected into the next model call`}
        >
          <Caret open={open} />
          <span className="attach-line-label">context</span>
          <span className="attach-line-sum">{line}</span>
        </button>
        {open ? (
          <div className="attach-items">
            {items.map((it, i) => (
              <div className="attach-item" key={it.uuid + i}>
                <div className="attach-item-head">
                  <span className="attach-item-label">{it.sum.label}</span>
                  {it.sum.brief ? <span className="attach-item-brief">{it.sum.brief}</span> : null}
                </div>
                {it.sum.detail ? <CodeBlock code={it.sum.detail} max={300} /> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function isUserTaskNotification(msg: NormMsg): TaskNotificationData | null {
  const txt = msg.blocks.map(b => b.type === "text" ? (b.text || "") : "").join("\n");
  return parseTaskNotification(txt);
}

interface ImgItem { key: string; src: string; alt: string; }

const IMG_SRC_RE = /\[Image:\s*source:\s*(\/[^\]\n]+?\.(?:png|jpg|jpeg|gif|webp|bmp|svg))\s*\]/gi;

function extractImagesFromText(text: string): { cleaned: string; items: ImgItem[] } {
  const items: ImgItem[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(IMG_SRC_RE.source, IMG_SRC_RE.flags);
  while ((m = re.exec(text)) !== null) {
    const p = m[1].trim();
    if (seen.has(p)) continue;
    seen.add(p);
    items.push({ key: p, src: `/api/image?path=${encodeURIComponent(p)}`, alt: p.split("/").pop() || "image" });
  }
  const cleaned = text.replace(new RegExp(IMG_SRC_RE.source, IMG_SRC_RE.flags), "").replace(/\n{3,}/g, "\n\n").trim();
  return { cleaned, items };
}

function Lightbox({ items, index, onClose, onIndex }: { items: ImgItem[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (items.length > 1 && e.key === "ArrowRight") onIndex((index + 1) % items.length);
      else if (items.length > 1 && e.key === "ArrowLeft") onIndex((index - 1 + items.length) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndex]);
  const it = items[index];
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close"><Icons.close size={18} /></button>
      {items.length > 1 ? (
        <>
          <button className="lightbox-nav left" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + items.length) % items.length); }} aria-label="Previous">‹</button>
          <button className="lightbox-nav right" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % items.length); }} aria-label="Next">›</button>
          <div className="lightbox-count mono">{index + 1} / {items.length}</div>
        </>
      ) : null}
      <LightboxImage key={it.src} src={it.src} alt={it.alt} />
      {it.alt ? <div className="lightbox-caption mono">{it.alt}</div> : null}
    </div>,
    document.body
  );
}

// A muted placeholder shown when an image can't be loaded (the source file
// was cleaned up, the path moved, etc.) — beats the browser's broken-image
// glyph. Carries the filename so it's still identifiable.
function MissingImage({ alt }: { alt: string }) {
  return (
    <div className="img-missing" title={`${alt} — image unavailable`}>
      <Icons.image size={22} />
      <span className="img-missing-name">{alt}</span>
      <span className="img-missing-hint">image unavailable</span>
    </div>
  );
}

function LightboxImage({ src, alt }: { src: string; alt: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) return <div className="lightbox-missing"><MissingImage alt={alt} /></div>;
  return <img className="lightbox-img" src={src} alt={alt} onClick={(e) => e.stopPropagation()} onError={() => setErrored(true)} />;
}

function Thumb({ it, onOpen }: { it: ImgItem; onOpen: () => void }) {
  const [errored, setErrored] = useState(false);
  if (errored) return <div className="img-thumb is-missing"><MissingImage alt={it.alt} /></div>;
  return (
    <button type="button" className="img-thumb" onClick={onOpen} title={it.alt}>
      <img src={it.src} loading="lazy" alt={it.alt} onError={() => setErrored(true)} />
      <span className="img-thumb-overlay"><Icons.zoomIn size={12} /></span>
    </button>
  );
}

function ImageGallery({ items, onOpen }: { items: ImgItem[]; onOpen: (ix: number) => void }) {
  if (!items.length) return null;
  return (
    <div className="img-gallery">
      {items.map((it, i) => <Thumb key={it.key + i} it={it} onOpen={() => onOpen(i)} />)}
    </div>
  );
}

// Claude Code writes these synthetic user-turn markers when the user hits
// Esc mid-turn; they're plumbing, not something the user typed.
const INTERRUPT_RE = /^\[Request interrupted by user( for tool use)?\]$/;

function interruptLabel(text: string): string | null {
  const m = text.trim().match(INTERRUPT_RE);
  if (!m) return null;
  return m[1] ? "interrupted during tool call" : "interrupted by user";
}

function InterruptChip({ label }: { label: string }) {
  return (
    <div className="interrupt-row">
      <Icons.close size={11} />
      <span>{label}</span>
    </div>
  );
}

function UserBody({ msg }: { msg: NormMsg }) {
  const txt = msg.blocks.map(b => b.type === "text" ? (b.text || "") : "").join("\n");
  const intr = interruptLabel(txt);
  if (intr) return <InterruptChip label={intr} />;
  const cmd = txt.match(/<command-name>([^<]+)<\/command-name>/);
  const args = txt.match(/<command-args>([\s\S]*?)<\/command-args>/);
  const rootXml = !cmd && txt.trim().match(/^<([a-z0-9-]+)>([\s\S]*)<\/\1>\s*$/i);

  const hasText = msg.blocks.some(b => b.type === "text" && b.text?.trim());
  if (!hasText && !cmd && !rootXml) return null;

  return (
    <>
      {cmd ? (
        <div className="user-cmd">
          <span className="user-cmd-slash mono"><Icons.cmd size={13} /></span>
          <span className="mono">{cmd[1]}{args && args[1].trim() ? " " + args[1].trim() : ""}</span>
          <span className="user-cmd-tag">slash command</span>
        </div>
      ) : rootXml ? (
        <SystemMetaCard tag={rootXml[1]} inner={rootXml[2]} />
      ) : (
        <ClampBlock max={232}>
          <div className="user-bubble">
            {msg.blocks.map((b, i) => b.type === "text" && b.text?.trim() ? <Markdown key={i} text={b.text} /> : null)}
          </div>
        </ClampBlock>
      )}
    </>
  );
}

export function UserGroup({ msgs, extraClass = "", permalinks = true }: { msgs: NormMsg[]; extraClass?: string; permalinks?: boolean }) {
  const [lightboxIx, setLightboxIx] = useState<number | null>(null);

  if (msgs.length === 0) return null;
  const first = msgs[0];

  // A group that is nothing but interruption markers gets a slim inline row
  // instead of a full "You" bubble — the user didn't say anything.
  const interruptLabels = msgs.map(m =>
    interruptLabel(m.blocks.map(b => b.type === "text" ? (b.text || "") : "").join("\n")));
  if (interruptLabels.every(Boolean) && !msgs.some(m => m.blocks.some(b => b.type === "image"))) {
    return (
      <div className={"msg interrupt-msg " + (extraClass || "fade-in")}>
        <div className="msg-gutter" />
        <div className="msg-main">
          {interruptLabels.map((l, i) => <InterruptChip key={msgs[i].uuid || i} label={l!} />)}
        </div>
      </div>
    );
  }

  // Pool images across all messages in the group, strip image markers, and
  // (in a second pass) turn [Image #N] references into anchors keyed to the
  // matching image by the trailing number in its filename. Two passes are
  // needed because refs in part 1 can point at sources in part 2.
  const items: ImgItem[] = [];
  const numToIx = new Map<number, number>();
  const cleanedMsgs: NormMsg[] = msgs.map((m, mi) => {
    const newBlocks: NormBlock[] = [];
    for (let i = 0; i < m.blocks.length; i++) {
      const b = m.blocks[i];
      if (b.type === "text") {
        const r = extractImagesFromText(b.text || "");
        for (const it of r.items) {
          if (!items.find(x => x.key === it.key)) {
            items.push(it);
            const nm = it.key.match(/(\d+)\.(?:png|jpg|jpeg|gif|webp|bmp|svg)$/i);
            if (nm) numToIx.set(parseInt(nm[1], 10), items.length - 1);
          }
        }
        newBlocks.push({ ...b, text: r.cleaned });
      } else if (b.type === "image" && b.source?.data) {
        const key = `inline-${mi}-${i}`;
        if (!items.find(x => x.key === key)) {
          items.push({ key, src: `data:${b.source.media_type};base64,${b.source.data}`, alt: "pasted image" });
        }
      } else {
        newBlocks.push(b);
      }
    }
    return { ...m, blocks: newBlocks };
  });
  // pass 2: linkify with the now-complete numToIx
  for (const m of cleanedMsgs) {
    for (const b of m.blocks) {
      if (b.type === "text" && b.text) {
        b.text = b.text.replace(/\[Image\s+#(\d+)\]/g, (full, n) =>
          numToIx.has(parseInt(n, 10)) ? `[Image #${n}](#image:${n})` : full
        );
      }
    }
  }

  const onBlocksClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a[href^="#image:"]') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const num = parseInt(a.getAttribute("href")!.replace("#image:", ""), 10);
    const ix = numToIx.get(num);
    if (ix !== undefined) setLightboxIx(ix);
  };

  return (
    <div className={"msg user " + (extraClass || "fade-in")}>
      <div className="msg-gutter">
        <span className="gutter-anchor">
          <span className="role-dot user-dot"><Icons.user size={13} /></span>
          <span className="gutter-label">You</span>
        </span>
        {msgs.length > 1 ? <span className="gutter-line" /> : null}
      </div>
      <div className="msg-main">
        <div className="msg-head">
          <span className="msg-time">{fmtTime(first.ts)}</span>
          {msgs.length > 1 ? <span className="user-group-tag">{msgs.length} parts</span> : null}
          {permalinks ? <MsgPermalink msgKey={first.uuid} /> : null}
        </div>
        <div className="msg-blocks" onClick={onBlocksClick}>
          {cleanedMsgs.map((m, i) => (
            permalinks
              ? <BlockAnchor key={m.uuid || i} msgKey={first.uuid} blockId={m.uuid || `part-${i}`} entityLabel="message"><UserBody msg={m} /></BlockAnchor>
              : <UserBody key={m.uuid || i} msg={m} />
          ))}
          {items.length ? <ImageGallery items={items} onOpen={setLightboxIx} /> : null}
        </div>
      </div>
      {lightboxIx !== null ? (
        <Lightbox items={items} index={lightboxIx} onClose={() => setLightboxIx(null)} onIndex={setLightboxIx} />
      ) : null}
    </div>
  );
}

export function UserMessage({ msg, agentsByToolUse, onOpenAgent, extraClass = "" }: { msg: NormMsg; agentsByToolUse: Record<string, NormAgent>; onOpenAgent: (id: string) => void; extraClass?: string }) {
  const tn = isUserTaskNotification(msg);
  if (tn) {
    const agent = agentsByToolUse[tn.toolUseId];
    return (
      <div className={"msg sysrow " + (extraClass || "fade-in")}>
        <TaskNotificationCard data={tn} agent={agent} onOpen={onOpenAgent} ts={msg.ts} />
      </div>
    );
  }
  return <UserGroup msgs={[msg]} extraClass={extraClass} />;
}

