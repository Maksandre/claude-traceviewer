import { useState } from "react";

interface Props {
  content: string;
}

export function ThinkingBlock({ content }: Props) {
  const [open, setOpen] = useState(false);

  if (!content) {
    return null;
  }

  return (
    <div className="thinking-block">
      <div className="thinking-header" onClick={() => setOpen(!open)}>
        <span className={`tool-chevron ${open ? "open" : ""}`}>&#9654;</span>
        <span>Thinking ({content.length} chars)</span>
      </div>
      {open && <div className="thinking-content">{content}</div>}
    </div>
  );
}
