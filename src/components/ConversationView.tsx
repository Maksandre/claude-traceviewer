import { useMemo } from "react";
import type { TraceRecord, ContentBlock } from "../types";
import { ToolCallBlock } from "./ToolCallBlock";
import { AgentBlock } from "./AgentBlock";
import { ThinkingBlock } from "./ThinkingBlock";
import { CollapsibleText } from "./CollapsibleText";

interface Props {
  records: TraceRecord[];
  project: string;
  session: string;
}

interface ProcessedMessage {
  type: "user" | "assistant" | "tool-call" | "agent" | "system" | "turn-separator" | "notification";
  record?: TraceRecord;
  // for assistant: merged content blocks from all chunks of same msg id
  mergedContent?: ContentBlock[];
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  stopReason?: string | null;
  // for tool-call: the tool_use block + its result
  toolUse?: ContentBlock;
  toolResult?: TraceRecord;
  // for agent: all agent_progress records + result
  agentInput?: ContentBlock;
  agentProgressRecords?: TraceRecord[];
  agentResult?: TraceRecord;
  agentId?: string;
  // for turn-separator
  durationMs?: number;
}

function mergeRecords(records: TraceRecord[]): ProcessedMessage[] {
  const messages: ProcessedMessage[] = [];
  const toolResultMap = new Map<string, TraceRecord>();
  const agentProgressMap = new Map<string, TraceRecord[]>();
  const agentResultMap = new Map<string, TraceRecord>();

  // First pass: index tool results and agent progress
  for (const rec of records) {
    if (rec.type === "user" && rec.message?.content) {
      const content = rec.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result" && block.tool_use_id) {
            toolResultMap.set(block.tool_use_id, rec);
          }
        }
      }
    }
    if (rec.type === "progress" && rec.data?.type === "agent_progress") {
      const key = rec.parentToolUseID || "";
      if (!agentProgressMap.has(key)) agentProgressMap.set(key, []);
      agentProgressMap.get(key)!.push(rec);
    }
    // Agent result comes as a user message with toolUseResult containing agentId
    if (rec.type === "user" && rec.toolUseResult?.agentId) {
      const sourceUUID = rec.sourceToolAssistantUUID;
      if (sourceUUID) agentResultMap.set(sourceUUID, rec);
    }
  }

  // Track which tool_use IDs and agent tool IDs we've already rendered
  const renderedToolUseIds = new Set<string>();
  const renderedAgentToolIds = new Set<string>();

  // Track assistant message chunks by message id
  const assistantChunks = new Map<string, TraceRecord[]>();

  for (const rec of records) {
    if (rec.type === "assistant" && rec.message?.id) {
      const msgId = rec.message.id;
      if (!assistantChunks.has(msgId)) assistantChunks.set(msgId, []);
      assistantChunks.get(msgId)!.push(rec);
    }
  }

  // Merge assistant chunks
  const mergedAssistants = new Map<string, { content: ContentBlock[]; model?: string; usage?: any; stopReason?: string | null; record: TraceRecord }>();
  for (const [msgId, chunks] of assistantChunks) {
    const allContent: ContentBlock[] = [];
    let model: string | undefined;
    let usage: any;
    let stopReason: string | null = null;
    let firstRecord = chunks[0];

    for (const chunk of chunks) {
      model = chunk.message?.model || model;
      if (chunk.message?.usage?.output_tokens) usage = chunk.message.usage;
      if (chunk.message?.stop_reason) stopReason = chunk.message.stop_reason;
      const content = chunk.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          // Dedupe: check if we already have this block
          const exists = allContent.some(
            (b) =>
              b.type === block.type &&
              ((b.type === "text" && block.type === "text" && b.text === block.text) ||
                (b.type === "tool_use" && block.type === "tool_use" && b.id === block.id) ||
                (b.type === "thinking" && block.type === "thinking" && b.signature === block.signature))
          );
          if (!exists) allContent.push(block);
        }
      }
    }

    mergedAssistants.set(msgId, { content: allContent, model, usage, stopReason, record: firstRecord });
  }

  // Second pass: build message list
  const processedMsgIds = new Set<string>();

  for (const rec of records) {
    // User prompt (not tool result)
    if (rec.type === "user") {
      const content = rec.message?.content;
      const isToolResult =
        Array.isArray(content) &&
        content.length > 0 &&
        content[0]?.type === "tool_result";
      const isAgentResult = !!rec.toolUseResult?.agentId;

      if (!isToolResult && !isAgentResult) {
        // Detect system notifications (task-notification, system-reminder)
        const textContent = typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.filter((b: ContentBlock) => b.type === "text").map((b: ContentBlock) => b.text).join("\n")
            : "";
        const isNotification = textContent.includes("<task-notification>")
          || textContent.includes("<system-reminder>")
          || (textContent.includes("<task-id>") && textContent.includes("<status>"));
        messages.push({ type: isNotification ? "notification" : "user", record: rec });
      }
      continue;
    }

    // Assistant - use merged version
    if (rec.type === "assistant" && rec.message?.id) {
      const msgId = rec.message.id;
      if (processedMsgIds.has(msgId)) continue;
      processedMsgIds.add(msgId);

      const merged = mergedAssistants.get(msgId);
      if (!merged) continue;

      // Split content into text/thinking vs tool_use
      for (const block of merged.content) {
        if (block.type === "thinking") {
          messages.push({
            type: "assistant",
            record: merged.record,
            mergedContent: [block],
            model: merged.model,
          });
        } else if (block.type === "text" && block.text) {
          messages.push({
            type: "assistant",
            record: merged.record,
            mergedContent: [block],
            model: merged.model,
            usage: merged.usage,
            stopReason: merged.stopReason,
          });
        } else if (block.type === "tool_use" && block.id) {
          if (block.name === "Agent") {
            // Find the corresponding tool_use_id for agent progress
            const agentProgress = agentProgressMap.get(block.id) || [];
            // Agent result is in toolResultMap (keyed by tool_use_id)
            const agentResult = toolResultMap.get(block.id);
            renderedAgentToolIds.add(block.id);
            // Extract agentId from progress records or result
            const agentId = agentProgress[0]?.data?.agentId
              || agentResult?.toolUseResult?.agentId
              || undefined;
            messages.push({
              type: "agent",
              record: merged.record,
              agentInput: block,
              agentProgressRecords: agentProgress,
              agentResult: agentResult,
              agentId,
            });
          } else {
            renderedToolUseIds.add(block.id);
            const result = toolResultMap.get(block.id);
            messages.push({
              type: "tool-call",
              record: merged.record,
              toolUse: block,
              toolResult: result,
            });
          }
        }
      }
      continue;
    }

    // System turn duration
    if (rec.type === "system" && rec.subtype === "turn_duration") {
      messages.push({
        type: "turn-separator",
        durationMs: rec.durationMs,
        record: rec,
      });
      continue;
    }
  }

  return messages;
}

function formatTime(ts?: string): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString();
}

function renderTextContent(text: string) {
  // Simple markdown-ish rendering
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const inner = part.slice(3, -3);
      const newlineIdx = inner.indexOf("\n");
      const code = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner;
      return <pre key={i}>{code}</pre>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function ConversationView({ records, project, session }: Props) {
  const messages = useMemo(() => mergeRecords(records), [records]);

  return (
    <div className="conversation">
      {messages.map((msg, i) => {
        if (msg.type === "turn-separator") {
          return (
            <div key={i} className="turn-separator">
              Turn completed in {((msg.durationMs || 0) / 1000).toFixed(1)}s
            </div>
          );
        }

        if (msg.type === "user") {
          const content = msg.record?.message?.content;
          const textContent =
            typeof content === "string"
              ? content
              : Array.isArray(content)
                ? content
                    .filter((b: ContentBlock) => b.type === "text")
                    .map((b: ContentBlock) => b.text)
                    .join("\n")
                : "";
          const images = Array.isArray(content)
            ? content.filter((b: ContentBlock) => b.type === "image")
            : [];

          return (
            <div key={i} className="message user-message">
              <div className="message-header">
                <span className="message-role user">User</span>
                <span className="message-time">
                  {formatTime(msg.record?.timestamp)}
                </span>
                {msg.record?.permissionMode && (
                  <span className={`permission-badge ${msg.record.permissionMode}`}>
                    {msg.record.permissionMode === "bypassPermissions"
                      ? "dangerous"
                      : msg.record.permissionMode}
                  </span>
                )}
                {msg.record?.version && (
                  <span className="message-tokens">v{msg.record.version}</span>
                )}
              </div>
              <CollapsibleText text={textContent} renderContent={renderTextContent} />
              {images.map((img: ContentBlock, j: number) => (
                <img
                  key={j}
                  className="message-image"
                  src={`data:${img.source?.media_type};base64,${img.source?.data}`}
                  alt="User attachment"
                />
              ))}
            </div>
          );
        }

        if (msg.type === "notification") {
          const content = msg.record?.message?.content;
          const textContent =
            typeof content === "string"
              ? content
              : Array.isArray(content)
                ? content
                    .filter((b: ContentBlock) => b.type === "text")
                    .map((b: ContentBlock) => b.text)
                    .join("\n")
                : "";
          // Extract summary from task-notification
          const summaryMatch = textContent.match(/<summary>(.*?)<\/summary>/);
          const statusMatch = textContent.match(/<status>(.*?)<\/status>/);
          const summary = summaryMatch?.[1] || "System notification";
          const status = statusMatch?.[1] || "";

          return (
            <div key={i} className="message system-message">
              <div className="message-header">
                <span className="message-role system">Notification</span>
                <span className="message-time">{formatTime(msg.record?.timestamp)}</span>
                {status && (
                  <span className={`permission-badge ${status === "completed" ? "default" : status === "failed" ? "bypassPermissions" : "acceptEdits"}`}>
                    {status}
                  </span>
                )}
              </div>
              <CollapsibleText text={summary} maxLines={3} />
            </div>
          );
        }

        if (msg.type === "assistant") {
          const blocks = msg.mergedContent || [];
          const thinkingBlock = blocks.find((b) => b.type === "thinking");
          const textBlock = blocks.find((b) => b.type === "text");

          if (thinkingBlock) {
            return <ThinkingBlock key={i} content={thinkingBlock.thinking || ""} />;
          }

          return (
            <div key={i} className="message assistant-message">
              <div className="message-header">
                <span className="message-role assistant">Assistant</span>
                <span className="message-time">
                  {formatTime(msg.record?.timestamp)}
                </span>
                {msg.model && <span className="message-model">{msg.model}</span>}
                {msg.usage && (
                  <span className="message-tokens">
                    {msg.usage.input_tokens}in / {msg.usage.output_tokens}out
                    {msg.usage.cache_read_input_tokens
                      ? ` / ${msg.usage.cache_read_input_tokens} cached`
                      : ""}
                  </span>
                )}
              </div>
              {textBlock?.text && (
                <CollapsibleText text={textBlock.text} renderContent={renderTextContent} />
              )}
            </div>
          );
        }

        if (msg.type === "tool-call") {
          return (
            <ToolCallBlock
              key={i}
              toolUse={msg.toolUse!}
              toolResult={msg.toolResult}
            />
          );
        }

        if (msg.type === "agent") {
          return (
            <AgentBlock
              key={i}
              agentInput={msg.agentInput!}
              progressRecords={msg.agentProgressRecords || []}
              result={msg.agentResult}
              agentId={msg.agentId}
              project={project}
              session={session}
            />
          );
        }

        return null;
      })}
    </div>
  );
}
