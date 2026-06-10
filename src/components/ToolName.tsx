import { mcpToolName } from "../lib/format";

/** Tool name that compacts MCP ids: "mcp__claude_ai_Google_Drive__list_recent_files"
 * renders as the tool name plus a muted server tag, with the full id on hover.
 * Regular tool names pass through untouched. */
export function ToolName({ name }: { name?: string }) {
  const mcp = mcpToolName(name);
  if (!mcp) return <>{name}</>;
  return (
    <span className="mcp-name" title={name}>
      <span className="mcp-tool">{mcp.tool}</span>
      <span className="mcp-srv">{mcp.server}</span>
    </span>
  );
}
