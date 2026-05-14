import { useState } from "react";

interface Props {
  text: string;
  maxLines?: number;
  renderContent?: (text: string) => React.ReactNode;
}

export function CollapsibleText({ text, maxLines = 5, renderContent }: Props) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const needsTruncation = lines.length > maxLines;

  if (!needsTruncation || expanded) {
    return (
      <div className="message-text">
        {renderContent ? renderContent(text) : text}
        {needsTruncation && (
          <button className="expand-btn" onClick={() => setExpanded(false)}>
            Show less
          </button>
        )}
      </div>
    );
  }

  const truncated = lines.slice(0, maxLines).join("\n");
  return (
    <div className="message-text">
      {renderContent ? renderContent(truncated) : truncated}
      <button className="expand-btn" onClick={() => setExpanded(true)}>
        +{lines.length - maxLines} more lines
      </button>
    </div>
  );
}
