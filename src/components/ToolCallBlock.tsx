import { useState } from "react";
import type { ContentBlock, TraceRecord } from "../types";

interface Props {
  toolUse: ContentBlock;
  toolResult?: TraceRecord;
}

function getToolSummary(toolUse: ContentBlock): string {
  const input = toolUse.input || {};
  switch (toolUse.name) {
    case "Read":
      return input.file_path || "";
    case "Write":
      return input.file_path || "";
    case "Edit":
      return input.file_path || "";
    case "Bash":
      return input.command?.slice(0, 80) || "";
    case "Grep":
      return `/${input.pattern}/ ${input.path || ""}`;
    case "Glob":
      return `${input.pattern} ${input.path || ""}`;
    case "Skill":
      return input.skill || "";
    case "ToolSearch":
      return input.query || "";
    default:
      return "";
  }
}

function getResultContent(toolResult?: TraceRecord): { text: string; rejected: boolean } {
  if (!toolResult) return { text: "(no result captured)", rejected: false };

  const content = toolResult.message?.content;
  if (typeof content === "string") {
    return { text: content, rejected: content.includes("user doesn't want to proceed") };
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "tool_result") {
        const c = typeof block.content === "string" ? block.content : JSON.stringify(block.content, null, 2);
        return { text: c, rejected: c.includes("user doesn't want to proceed") };
      }
    }
  }

  if (toolResult.toolUseResult) {
    return { text: JSON.stringify(toolResult.toolUseResult, null, 2), rejected: false };
  }

  return { text: "(empty result)", rejected: false };
}

function CollapsiblePre({ text, maxLines = 5 }: { text: string; maxLines?: number }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const needsTruncation = lines.length > maxLines;

  if (!needsTruncation || expanded) {
    return (
      <>
        <pre>{text}</pre>
        {needsTruncation && (
          <button className="expand-btn" onClick={() => setExpanded(false)}>Show less</button>
        )}
      </>
    );
  }

  return (
    <>
      <pre>{lines.slice(0, maxLines).join("\n")}</pre>
      <button className="expand-btn" onClick={() => setExpanded(true)}>
        +{lines.length - maxLines} more lines
      </button>
    </>
  );
}

export function ToolCallBlock({ toolUse, toolResult }: Props) {
  const [open, setOpen] = useState(false);
  const summary = getToolSummary(toolUse);
  const result = getResultContent(toolResult);

  return (
    <div className="tool-call">
      <div className="tool-call-header" onClick={() => setOpen(!open)}>
        <span className={`tool-chevron ${open ? "open" : ""}`}>&#9654;</span>
        <span className={`tool-name ${toolUse.name || ""}`}>{toolUse.name}</span>
        <span className="tool-summary">{summary}</span>
        {result.rejected && (
          <span style={{ color: "var(--red)", fontSize: 11, fontWeight: 600 }}>
            REJECTED
          </span>
        )}
      </div>
      {open && (
        <div className="tool-body">
          <div className="tool-input">
            <div className="tool-input-label">Input</div>
            <CollapsiblePre text={JSON.stringify(toolUse.input, null, 2)} />
          </div>
          <div className={`tool-result ${result.rejected ? "tool-result-rejected" : ""}`}>
            <div className="tool-result-label">
              {result.rejected ? "Rejected" : "Result"}
            </div>
            <CollapsiblePre text={result.text} />
          </div>
        </div>
      )}
    </div>
  );
}
