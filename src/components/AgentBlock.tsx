import { useState, useEffect, useMemo } from "react";
import type { ContentBlock, TraceRecord } from "../types";
import { ToolCallBlock } from "./ToolCallBlock";
import { ThinkingBlock } from "./ThinkingBlock";

interface Props {
  agentInput: ContentBlock;
  progressRecords: TraceRecord[];
  result?: TraceRecord;
  agentId?: string;
  project: string;
  session: string;
}

interface AgentData {
  meta: { agentType?: string; description?: string } | null;
  records: TraceRecord[];
}

function mergeAssistantChunks(records: TraceRecord[]) {
  const chunks = new Map<string, { content: ContentBlock[]; model?: string; usage?: any; record: TraceRecord }>();

  for (const rec of records) {
    if (rec.type !== "assistant" || !rec.message?.id) continue;
    const msgId = rec.message.id;
    if (!chunks.has(msgId)) chunks.set(msgId, { content: [], record: rec });
    const entry = chunks.get(msgId)!;
    entry.model = rec.message.model || entry.model;
    if (rec.message.usage?.output_tokens) entry.usage = rec.message.usage;
    const content = rec.message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        const exists = entry.content.some(
          (b) =>
            b.type === block.type &&
            ((b.type === "text" && block.type === "text" && b.text === block.text) ||
              (b.type === "tool_use" && block.type === "tool_use" && b.id === block.id) ||
              (b.type === "thinking" && block.type === "thinking" && b.signature === block.signature))
        );
        if (!exists) entry.content.push(block);
      }
    }
  }
  return chunks;
}

function getToolResultContent(records: TraceRecord[], toolUseId: string): { text: string; rejected: boolean } {
  for (const rec of records) {
    if (rec.type !== "user") continue;
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
        const c = typeof block.content === "string" ? block.content : JSON.stringify(block.content, null, 2);
        return { text: c, rejected: c.includes("user doesn't want to proceed") };
      }
    }
  }
  // Check toolUseResult
  for (const rec of records) {
    if (rec.type === "user" && rec.toolUseResult && rec.sourceToolAssistantUUID) {
      return { text: JSON.stringify(rec.toolUseResult, null, 2), rejected: false };
    }
  }
  return { text: "", rejected: false };
}

export function AgentBlock({ agentInput, result, agentId, project, session }: Props) {
  const [open, setOpen] = useState(false);
  const [agentData, setAgentData] = useState<AgentData | null>(null);
  const [loading, setLoading] = useState(false);
  const input = agentInput.input || {};
  const resultData = result?.toolUseResult;

  useEffect(() => {
    if (!open || !agentId || agentData) return;
    setLoading(true);
    fetch(
      `/api/projects/${encodeURIComponent(project)}/sessions/${encodeURIComponent(session)}/agents/${encodeURIComponent(agentId)}`
    )
      .then((r) => r.json())
      .then((data) => {
        setAgentData(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [open, agentId, project, session, agentData]);

  const processedMessages = useMemo(() => {
    if (!agentData?.records) return [];
    const records = agentData.records;
    const merged = mergeAssistantChunks(records);
    const messages: Array<{
      type: "user" | "assistant-text" | "assistant-thinking" | "tool-call";
      content?: string;
      blocks?: ContentBlock[];
      model?: string;
      usage?: any;
      toolUse?: ContentBlock;
      toolResultText?: string;
      toolResultRejected?: boolean;
      timestamp?: string;
    }> = [];

    const processedMsgIds = new Set<string>();
    let isFirstUserMsg = true;

    for (const rec of records) {
      // User messages (not tool results)
      if (rec.type === "user") {
        const content = rec.message?.content;
        const isToolResult = Array.isArray(content) && content[0]?.type === "tool_result";
        if (isToolResult) continue;
        // Skip first user message — it's the same as the agent prompt shown above
        if (isFirstUserMsg) { isFirstUserMsg = false; continue; }
        const text = typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.filter((b: ContentBlock) => b.type === "text").map((b: ContentBlock) => b.text).join("\n")
            : "";
        if (text) {
          messages.push({ type: "user", content: text, timestamp: rec.timestamp });
        }
        continue;
      }

      // Assistant chunks (merged)
      if (rec.type === "assistant" && rec.message?.id) {
        if (processedMsgIds.has(rec.message.id)) continue;
        processedMsgIds.add(rec.message.id);
        const entry = merged.get(rec.message.id);
        if (!entry) continue;

        for (const block of entry.content) {
          if (block.type === "thinking") {
            messages.push({ type: "assistant-thinking", content: block.thinking || "", timestamp: rec.timestamp });
          } else if (block.type === "text" && block.text) {
            messages.push({ type: "assistant-text", content: block.text, model: entry.model, usage: entry.usage, timestamp: rec.timestamp });
          } else if (block.type === "tool_use" && block.id) {
            const result = getToolResultContent(records, block.id);
            messages.push({
              type: "tool-call",
              toolUse: block,
              toolResultText: result.text,
              toolResultRejected: result.rejected,
              timestamp: rec.timestamp,
            });
          }
        }
      }
    }
    return messages;
  }, [agentData]);

  return (
    <div className="agent-block">
      <div className="agent-header" onClick={() => setOpen(!open)}>
        <span className={`tool-chevron ${open ? "open" : ""}`}>&#9654;</span>
        <span className={`agent-badge ${input.run_in_background ? "background" : ""}`}>
          {input.run_in_background ? "BG Agent" : "Agent"}
        </span>
        <span className="agent-desc">{input.description || "Agent"}</span>
        {input.subagent_type && (
          <span className="agent-type">{input.subagent_type}</span>
        )}
        <span className="agent-stats">
          {resultData?.totalTokens ? `${resultData.totalTokens} tok` : ""}
          {resultData?.totalToolUseCount ? ` / ${resultData.totalToolUseCount} tools` : ""}
          {resultData?.totalDurationMs ? ` / ${(resultData.totalDurationMs / 1000).toFixed(1)}s` : ""}
        </span>
      </div>
      {open && (
        <div className="agent-body">
          {input.prompt && <div className="agent-prompt">{input.prompt}</div>}

          {loading && <div style={{ color: "var(--text-dim)", fontSize: 13, padding: 8 }}>Loading agent trace...</div>}

          {processedMessages.length > 0 && (
            <div className="agent-messages">
              {processedMessages.map((msg, i) => {
                if (msg.type === "user") {
                  return (
                    <div key={i} className="message user-message" style={{ padding: "10px 14px", fontSize: 13 }}>
                      <div className="message-header" style={{ marginBottom: 6 }}>
                        <span className="message-role user">Agent Input</span>
                      </div>
                      <div className="message-text" style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
                    </div>
                  );
                }
                if (msg.type === "assistant-thinking") {
                  return <ThinkingBlock key={i} content={msg.content || ""} />;
                }
                if (msg.type === "assistant-text") {
                  return (
                    <div key={i} className="message assistant-message" style={{ padding: "10px 14px", fontSize: 13 }}>
                      <div className="message-header" style={{ marginBottom: 6 }}>
                        <span className="message-role assistant">Agent</span>
                        {msg.model && <span className="message-model">{msg.model}</span>}
                        {msg.usage && (
                          <span className="message-tokens">
                            {msg.usage.input_tokens}in / {msg.usage.output_tokens}out
                          </span>
                        )}
                      </div>
                      <div className="message-text" style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
                    </div>
                  );
                }
                if (msg.type === "tool-call" && msg.toolUse) {
                  // Build a fake toolResult Record for ToolCallBlock
                  const fakeResult: TraceRecord | undefined = msg.toolResultText
                    ? {
                        type: "user",
                        message: {
                          role: "user",
                          content: [{
                            type: "tool_result" as const,
                            tool_use_id: msg.toolUse.id,
                            content: msg.toolResultText,
                          }],
                        },
                      }
                    : undefined;
                  return (
                    <ToolCallBlock
                      key={i}
                      toolUse={msg.toolUse}
                      toolResult={fakeResult}
                    />
                  );
                }
                return null;
              })}
            </div>
          )}

          {!loading && !agentId && processedMessages.length === 0 && (
            <div style={{ color: "var(--text-dim)", fontSize: 12, padding: 8 }}>
              No subagent trace data available
            </div>
          )}

          {resultData && (
            <div style={{
              marginTop: 12,
              padding: "12px 14px",
              background: "var(--code-bg, var(--bg-card))",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
            }}>
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--green)",
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}>
                Agent Result
              </div>
              <pre style={{
                fontSize: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 300,
                overflow: "auto",
                fontFamily: "var(--font-mono)",
                lineHeight: 1.5,
              }}>
                {typeof resultData.content === "string"
                  ? resultData.content.slice(0, 5000)
                  : JSON.stringify(resultData, null, 2).slice(0, 5000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
