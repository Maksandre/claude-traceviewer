// Highlights occurrences of a search query inside a DOM subtree using the
// CSS Custom Highlight API. This is a one-shot painter — no DOM mutation,
// no extra wrapper elements — so it composes cleanly with markdown,
// virtualised lists, and React-owned trees.
//
// Style the highlight via `::highlight(search-match)` in CSS.
// Browsers without CSS.highlights (older Firefox) silently get no highlights.

import { useEffect, type RefObject } from "react";

const HIGHLIGHT_NAME = "search-match";
// Painted by the Custom Highlight API. Past this point the marker layer is
// already visually saturated and each extra Range only adds cost.
const MAX_RANGES = 2000;
// Below this length the user is mid-typing; the upstream debouncer also
// suppresses these queries, but we double-gate so a stray short query never
// triggers a full DOM walk.
const MIN_QUERY_LEN = 3;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type HighlightsRegistry = {
  set: (name: string, value: unknown) => void;
  delete: (name: string) => void;
};

interface HighlightConstructor {
  new (...ranges: Range[]): unknown;
}

function getHighlights(): HighlightsRegistry | null {
  const cssAny = (CSS as unknown as { highlights?: HighlightsRegistry });
  return cssAny.highlights ?? null;
}

function getHighlightCtor(): HighlightConstructor | null {
  const w = window as unknown as { Highlight?: HighlightConstructor };
  return w.Highlight ?? null;
}

export function useSearchHighlight(containerRef: RefObject<HTMLElement | null>, query: string) {
  useEffect(() => {
    const highlights = getHighlights();
    const HighlightCtor = getHighlightCtor();
    if (!highlights || !HighlightCtor) return;

    const container = containerRef.current;
    if (!container) return;

    const q = query.trim();
    if (q.length < MIN_QUERY_LEN) {
      highlights.delete(HIGHLIGHT_NAME);
      return;
    }

    const re = new RegExp(escapeRegex(q), "gi");

    const apply = () => {
      const ranges: Range[] = [];
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.textContent) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          // Skip non-rendered text (form inputs, hidden subtrees).
          if (parent.closest("script, style")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let node: Node | null;
      outer: while ((node = walker.nextNode())) {
        const text = node.textContent || "";
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          if (m[0].length === 0) { re.lastIndex++; continue; }
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          ranges.push(range);
          if (ranges.length >= MAX_RANGES) break outer;
        }
      }
      const hl = new HighlightCtor(...ranges);
      highlights.set(HIGHLIGHT_NAME, hl);
    };

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    };

    schedule();

    // The transcript mutates as the user expands subagents, toggles tool
    // bodies, and as live messages arrive. Re-paint on any DOM change.
    const observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true, characterData: true });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      highlights.delete(HIGHLIGHT_NAME);
    };
  }, [query, containerRef]);
}
