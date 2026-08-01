import { useState } from "react";
import { Icons } from "../../lib/icons";
import { Caret, CodeBlock } from "../../lib/md";
import type { NormBlock, NormToolResult } from "../../lib/normalize";
import { patchedFiles } from "./blocks";

// Codex CLI's apply_patch custom tool. The input is a "*** Begin Patch"
// envelope; this card surfaces the touched files as add/update/delete chips
// with the raw patch body behind the expander — a diff-flavored ToolCard.
export function ApplyPatchCard({ block, result, defaultOpen }: {
  block: NormBlock;
  result?: NormToolResult;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const patch = String(block.input?.input || "");
  const files = patchedFiles(patch);
  const isErr = !!result?.is_error;
  const hasResult = !!result;
  const rtext = hasResult
    ? (typeof result.content === "string" ? result.content : JSON.stringify(result.content))
    : "";
  const col = "var(--tool-write)";
  return (
    <div className={"blk tool patch " + (open ? "is-open" : "")} style={{ "--tc": col } as React.CSSProperties}>
      <button className="blk-head tool-head" onClick={() => setOpen(o => !o)}>
        <Caret open={open} />
        <span className="blk-ic tool-ic" style={{ color: col, background: `color-mix(in oklch, ${col} 16%, transparent)` }}>
          <Icons.pencil size={13} />
        </span>
        <span className="tool-name">apply_patch</span>
        <span className="patch-files">
          {files.length === 0 ? (
            <span className="tool-summary">patch</span>
          ) : files.map((f, i) => (
            <span key={i} className={"patch-chip " + f.op} title={`${f.op}: ${f.path}`}>
              <span className="patch-op">{f.op === "add" ? "A" : f.op === "delete" ? "D" : "M"}</span>
              {f.path.replace(/^.*\/(?=[^/]+$)/, "")}
            </span>
          ))}
        </span>
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
            <div className="kv-label">patch</div>
            <CodeBlock code={patch} max={400} />
          </div>
          {hasResult ? (
            <div className={"tool-result " + (isErr ? "is-err" : "")}>
              <div className="kv-label">{isErr ? "error" : "result"}</div>
              <CodeBlock code={rtext} max={240} />
            </div>
          ) : <div className="tool-pending">awaiting result…</div>}
        </div>
      ) : null}
    </div>
  );
}
