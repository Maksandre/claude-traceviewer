import { useState } from "react";
import { Icons } from "../lib/icons";
import { copyText } from "../lib/clipboard";

/* Copies an id (session uuid, agent id) to the clipboard. The id itself stays
   hidden — it's a wall of hex in a header that's otherwise scannable, and it's
   only ever useful pasted somewhere else. */
export function CopyIdButton({ id, label, title }: { id: string; label: string; title: string }) {
  const [copied, setCopied] = useState(false);
  if (!id) return null;
  const onClick = async () => {
    if (await copyText(id)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  };
  return (
    <button type="button" className={"copy-id " + (copied ? "is-copied" : "")} onClick={onClick} title={title}>
      {copied ? <Icons.check size={12} /> : <Icons.copy size={12} />}
      {copied ? "copied" : label}
    </button>
  );
}
