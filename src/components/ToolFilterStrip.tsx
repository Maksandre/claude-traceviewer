import { toolColor } from "../lib/format";
import { toolIcon } from "../lib/icons";
import { ToolName } from "./ToolName";

interface Props {
  counts: Record<string, number>;
  selected?: Set<string>;
  onToggle?: (tool: string) => void;
  onClear?: () => void;
  emptyText?: string;
}

export function ToolFilterStrip({ counts, selected, onToggle, onClear, emptyText = "no tool calls" }: Props) {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    return <span className="mono" style={{ color: "var(--tx-3)", fontSize: 12 }}>{emptyText}</span>;
  }
  const interactive = !!onToggle;
  const hasSelection = !!selected && selected.size > 0;
  return (
    <div className="toolcounts">
      {entries.map(([n, c]) => {
        const TI = toolIcon(n);
        const col = toolColor(n);
        const isSelected = !!selected?.has(n);
        const cls =
          "tcount" +
          (interactive ? " is-clickable" : "") +
          (isSelected ? " is-selected" : "") +
          (interactive && hasSelection && !isSelected ? " is-dim" : "");
        if (interactive) {
          return (
            <button
              key={n}
              type="button"
              className={cls}
              style={{ "--tc": col } as React.CSSProperties}
              onClick={() => onToggle?.(n)}
              aria-pressed={isSelected}
              title={isSelected ? `Remove ${n} from filter` : `Show only messages with ${n}`}
            >
              <TI size={12} />
              <span><ToolName name={n} /></span>
              <b className="tnum">{c}</b>
            </button>
          );
        }
        return (
          <span key={n} className={cls} style={{ "--tc": col } as React.CSSProperties}>
            <TI size={12} />
            <span><ToolName name={n} /></span>
            <b className="tnum">{c}</b>
          </span>
        );
      })}
      {interactive && hasSelection && onClear ? (
        <button type="button" className="tcount tcount-clear" onClick={onClear} title="Clear tool filter">
          clear
        </button>
      ) : null}
    </div>
  );
}
