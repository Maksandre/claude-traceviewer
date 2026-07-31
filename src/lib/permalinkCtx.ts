import { createContext, useContext } from "react";

// Lets per-block / per-message copy-id buttons reach the selected session
// id without prop-drilling through Virtuoso + Transcript + Blocks. App
// provides this; nothing else does.
export interface PermalinkApi {
  sessionId: string | null;
}

export const PermalinkContext = createContext<PermalinkApi | null>(null);
export const usePermalinks = () => useContext(PermalinkContext);
