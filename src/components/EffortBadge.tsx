/* Reasoning effort an agent ran at. Claude Code writes it on every assistant
   record as one of low | medium | high | xhigh | max; the bars encode the
   level so the compact (bars-only) variant still reads at a glance. */
const EFFORT_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };
const BARS = [1, 2, 3, 4, 5];

export function EffortBadge({ effort, compact }: { effort?: string; compact?: boolean }) {
  if (!effort) return null;
  const key = effort.toLowerCase();
  // Unknown values still render — label only, with no bars filled — rather
  // than vanishing, so a new effort tier shows up instead of looking absent.
  const level = EFFORT_RANK[key] ?? 0;
  return (
    <span
      className={"effort-badge" + (compact ? " compact" : "")}
      data-effort={key}
      title={`reasoning effort: ${effort}`}
    >
      <span className="effort-bars" aria-hidden="true">
        {BARS.map(i => <i key={i} className={i <= level ? "on" : ""} />)}
      </span>
      {compact ? null : <span className="effort-label">{effort}</span>}
    </span>
  );
}
