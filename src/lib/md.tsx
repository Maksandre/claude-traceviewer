import { useEffect, useMemo, useRef, useState } from "react";
import { Icons } from "./icons";
import { fmtTokens } from "./format";

export function Caret({ open }: { open: boolean }) {
  return (
    <span style={{ display: "inline-flex", transition: "transform .18s ease", transform: open ? "rotate(90deg)" : "none", color: "var(--tx-3)" }}>
      <Icons.chevron size={13} />
    </span>
  );
}

export interface Usage { input: number; output: number; cw: number; cr: number; cost?: number; }

export function UsageChips({ u, compact = false }: { u?: Usage; compact?: boolean }) {
  if (!u) return null;
  const items: Array<{ k: string; v: number; cls: string }> = [
    { k: "in",     v: u.input,  cls: "in" },
    { k: "out",    v: u.output, cls: "out" },
    { k: "cache+", v: u.cw,     cls: "cw" },
    { k: "cache→", v: u.cr,     cls: "cr" },
  ];
  const filtered = items.filter(it => it.v > 0);
  return (
    <span className={"usage-chips " + (compact ? "is-compact" : "")}>
      {filtered.map(it => (
        <span key={it.k} className={"uc " + it.cls}>
          <span className="uc-k">{it.k}</span>
          <span className="uc-v tnum">{fmtTokens(it.v)}</span>
        </span>
      ))}
    </span>
  );
}

export function Bar({ pct, color, h = 6, track = true }: { pct: number; color: string; h?: number; track?: boolean }) {
  return (
    <div className="bar" style={{ height: h, background: track ? "var(--bg-3)" : "transparent" }}>
      <div style={{ width: Math.max(2, pct * 100) + "%", background: color }} />
    </div>
  );
}

export function MoreButton({ open, onClick, moreLabel = "Show more", lessLabel = "Show less" }: { open: boolean; onClick: () => void; moreLabel?: string; lessLabel?: string }) {
  return (
    <button className="morebtn mono" onClick={onClick}>
      <span className="morebtn-chev" style={{ transform: open ? "rotate(180deg)" : "none" }}>
        <Icons.chevron size={12} style={{ transform: "rotate(90deg)" }} />
      </span>
      {open ? lessLabel : moreLabel}
    </button>
  );
}

export function CodeBlock({ code, lang, max = 420, mono = true }: { code: unknown; lang?: string; max?: number; mono?: boolean }) {
  const [open, setOpen] = useState(false);
  const text = typeof code === "string" ? code : JSON.stringify(code, null, 2);
  const lines = text.split("\n");
  const long = lines.length > 12 || text.length > 1100;
  const shown = !open && long ? lines.slice(0, 10).join("\n") : text;
  return (
    <div className="codeblock">
      {lang ? <div className="codeblock-lang mono">{lang}</div> : null}
      <pre className={"codeblock-pre " + (mono ? "mono" : "")} style={{ maxHeight: open ? "none" : max }}>{shown}{!open && long ? "\n…" : ""}</pre>
      {long ? <div className="codeblock-morewrap"><MoreButton open={open} onClick={() => setOpen(o => !o)} moreLabel={`Show all ${lines.length} lines`} /></div> : null}
    </div>
  );
}

export function ClampBlock({ children, max = 232, moreLabel = "Show full message", lessLabel = "Show less" }: { children: React.ReactNode; max?: number; moreLabel?: string; lessLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [tall, setTall] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el) setTall(el.scrollHeight > max + 28);
  }, [children, max]);
  return (
    <div className="clamp">
      <div ref={ref} className="clamp-inner" style={{ maxHeight: open || !tall ? "none" : max }}>
        {children}
      </div>
      {tall && !open ? <div className="clamp-fade" /> : null}
      {tall ? <MoreButton open={open} onClick={() => setOpen(o => !o)} moreLabel={moreLabel} lessLabel={lessLabel} /> : null}
    </div>
  );
}

function mdInline(s: string): string {
  let h = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  h = h.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-a">$1</a>');
  return h;
}

type Align = "left" | "center" | "right";
type MdBlock =
  | { t: "code"; lang: string; body: string; key: number }
  | { t: "h"; lvl: number; body: string; key: number }
  | { t: "list"; items: { ordered: boolean; body: string }[]; key: number }
  | { t: "hr"; key: number }
  | { t: "table"; head: string[]; rows: string[][]; align: Align[]; key: number }
  | { t: "p"; body: string; key: number };

function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\||\|$/g, "");
  return t.split("|").map(c => c.trim());
}

function parseAlign(sep: string[]): Align[] {
  return sep.map(c => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

export function Markdown({ text }: { text?: string }) {
  const blocks = useMemo<MdBlock[]>(() => {
    const lines = (text || "").split("\n");
    const out: MdBlock[] = [];
    let i = 0;
    let key = 0;
    while (i < lines.length) {
      const ln = lines[i];
      if (/^```/.test(ln)) {
        const lang = ln.slice(3).trim();
        const buf: string[] = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push({ t: "code", lang, body: buf.join("\n"), key: key++ });
        continue;
      }
      const h = ln.match(/^(#{1,4})\s+(.*)/);
      if (h) { out.push({ t: "h", lvl: h[1].length, body: h[2], key: key++ }); i++; continue; }
      if (/^\s*([-*]|\d+\.)\s+/.test(ln)) {
        const buf: { ordered: boolean; body: string }[] = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          const ordered = /^\s*\d+\./.test(lines[i]);
          buf.push({ ordered, body: lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "") });
          i++;
        }
        out.push({ t: "list", items: buf, key: key++ });
        continue;
      }
      if (/^\s*(---|___|\*\*\*)\s*$/.test(ln)) { out.push({ t: "hr", key: key++ }); i++; continue; }
      if (
        /^\s*\|.*\|\s*$/.test(ln) &&
        i + 1 < lines.length &&
        /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1]) &&
        /-/.test(lines[i + 1])
      ) {
        const head = splitRow(ln);
        const align = parseAlign(splitRow(lines[i + 1]));
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        out.push({ t: "table", head, rows, align, key: key++ });
        continue;
      }
      if (ln.trim() === "") { i++; continue; }
      const buf = [ln];
      i++;
      while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s|\s*\|)/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      out.push({ t: "p", body: buf.join(" "), key: key++ });
    }
    return out;
  }, [text]);

  return (
    <div className="md">
      {blocks.map(b => {
        if (b.t === "code") return <CodeBlock key={b.key} code={b.body} lang={b.lang} />;
        if (b.t === "h") {
          const tag = `h${Math.min(b.lvl + 2, 6)}` as keyof React.JSX.IntrinsicElements;
          return React.createElement(tag, { key: b.key, className: `md-h md-h${b.lvl}`, dangerouslySetInnerHTML: { __html: mdInline(b.body) } });
        }
        if (b.t === "hr") return <hr key={b.key} className="md-hr" />;
        if (b.t === "list") return (
          <ul key={b.key} className="md-list">
            {b.items.map((it, j) => <li key={j} dangerouslySetInnerHTML={{ __html: mdInline(it.body) }} />)}
          </ul>
        );
        if (b.t === "table") return (
          <div key={b.key} className="md-table-wrap">
            <table className="md-table">
              <thead>
                <tr>
                  {b.head.map((h, j) => (
                    <th key={j} style={{ textAlign: b.align[j] || "left" }} dangerouslySetInnerHTML={{ __html: mdInline(h) }} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k} style={{ textAlign: b.align[k] || "left" }} dangerouslySetInnerHTML={{ __html: mdInline(c) }} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        return <p key={b.key} className="md-p" dangerouslySetInnerHTML={{ __html: mdInline(b.body) }} />;
      })}
    </div>
  );
}

import React from "react";
