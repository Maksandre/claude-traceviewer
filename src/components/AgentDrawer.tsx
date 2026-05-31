import { useEffect } from "react";
import { agentColor } from "../lib/format";
import { Icons } from "../lib/icons";
import type { NormAgent } from "../lib/normalize";
import { AgentDetail } from "./AgentsView";
import type { ViewSettings } from "./conversation/Transcript";

interface Props {
  agent: NormAgent | null;
  settings: ViewSettings;
  onOpenAgent: (id: string) => void;
  onClose: () => void;
}

export function AgentDrawer({ agent, settings, onOpenAgent, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!agent) return null;
  const col = agentColor(agent.agentType);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-bar">
          <span className="drawer-bar-ic" style={{ color: col, background: `color-mix(in oklch, ${col} 16%, transparent)` }}>
            <Icons.agent size={14} />
          </span>
          <span className="drawer-bar-title">subagent trace</span>
          <span className="drawer-bar-type" style={{ color: col }}>{agent.agentType}</span>
          <button className="icon-btn drawer-close" onClick={onClose} title="Close (Esc)">
            <Icons.close size={16} />
          </button>
        </div>
        <div className="drawer-scroll">
          <AgentDetail agent={agent} onOpenAgent={onOpenAgent} settings={settings} />
        </div>
      </div>
    </div>
  );
}
