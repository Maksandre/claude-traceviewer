import { useState } from "react";
import { Icons, toolIcon } from "../../lib/icons";
import { agentColor, agentMeta, fmtCost, fmtDur, fmtTime, fmtTokens, modelColor, modelLabel } from "../../lib/format";
import { Caret, ClampBlock, CodeBlock, Markdown, MoreButton } from "../../lib/md";
import type { NormAgent, NormBlock, NormMsg, NormToolResult } from "../../lib/normalize";
import { toolColor } from "../../lib/format";

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
        <span className="tool-name">{block.name}</span>
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

export function AgentSpawnCard({ block, agent, onOpen }: { block: NormBlock; agent?: NormAgent; onOpen: (id: string) => void }) {
  const type = (block.input?.subagent_type as string) || (agent?.agentType || "agent");
  const hue = agent ? agentMeta(agent.agentType).hue : agentMeta(type).hue;
  const col = `oklch(0.70 0.12 ${hue})`;
  const modelStr = agent ? agent.model : (block.input?.model as string | undefined);
  return (
    <button
      className="agent-spawn fade-in"
      style={{ "--ac": col } as React.CSSProperties}
      onClick={() => agent && onOpen(agent.id)}
      disabled={!agent}
    >
      <span className="agent-spawn-ic" style={{ color: col, background: `color-mix(in oklch, ${col} 16%, transparent)` }}>
        <Icons.agent size={16} />
      </span>
      <span className="agent-spawn-main">
        <span className="agent-spawn-top">
          <span className="agent-spawn-type" style={{ color: col }}>{type}</span>
          {modelStr ? (
            <span className="model-badge sm" style={{ "--mc": modelColor(modelStr) } as React.CSSProperties}>
              <span className="model-dot" />{modelLabel(modelStr)}
            </span>
          ) : null}
          <span className="agent-spawn-arrow">Subagent</span>
        </span>
        <span className="agent-spawn-desc">{block.input?.description || ""}</span>
        {agent ? (
          <span className="agent-spawn-stats">
            <span><Icons.layers size={11} /> {agent.msgCount} msgs</span>
            <span><Icons.terminal size={11} /> {Object.values(agent.toolCounts).reduce((a, b) => a + b, 0)} tools</span>
            <span><Icons.clock size={11} /> {fmtDur(agent.durationMs)}</span>
            <span style={{ color: "var(--accent)" }}>{fmtCost(agent.usage.cost)}</span>
          </span>
        ) : null}
      </span>
      {agent ? <span className="agent-spawn-go"><Icons.arrowRight size={15} /></span> : null}
    </button>
  );
}

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

export function isUserTaskNotification(msg: NormMsg): TaskNotificationData | null {
  const txt = msg.blocks.map(b => b.type === "text" ? (b.text || "") : "").join("\n");
  return parseTaskNotification(txt);
}

function UserBody({ msg }: { msg: NormMsg }) {
  const txt = msg.blocks.map(b => b.type === "text" ? (b.text || "") : "").join("\n");
  const cmd = txt.match(/<command-name>([^<]+)<\/command-name>/);
  const args = txt.match(/<command-args>([\s\S]*?)<\/command-args>/);
  const rootXml = !cmd && txt.trim().match(/^<([a-z0-9-]+)>([\s\S]*)<\/\1>\s*$/i);
  const imgs = msg.blocks.filter(b => b.type === "image");
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
            {msg.blocks.map((b, i) => b.type === "text" ? <Markdown key={i} text={b.text} /> :
              b.type === "image" ? <div key={i} className="img-ph mono"><Icons.file size={14} /> image attachment</div> : null)}
          </div>
        </ClampBlock>
      )}
      {imgs.length && cmd ? <div className="img-ph mono"><Icons.file size={14} /> {imgs.length} image attachment(s)</div> : null}
    </>
  );
}

export function UserGroup({ msgs, extraClass = "" }: { msgs: NormMsg[]; extraClass?: string }) {
  if (msgs.length === 0) return null;
  const first = msgs[0];
  return (
    <div className={"msg user " + (extraClass || "fade-in")}>
      <div className="msg-gutter">
        <span className="role-dot user-dot"><Icons.user size={13} /></span>
        {msgs.length > 1 ? <span className="gutter-line" /> : null}
      </div>
      <div className="msg-main">
        <div className="msg-head">
          <span className="role-name">You</span>
          <span className="msg-time">{fmtTime(first.ts)}</span>
          {msgs.length > 1 ? <span className="user-group-tag">{msgs.length} parts</span> : null}
        </div>
        <div className="msg-blocks">
          {msgs.map((m, i) => <UserBody key={m.uuid || i} msg={m} />)}
        </div>
      </div>
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

