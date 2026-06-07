import { createContext, useContext } from "react";

// Lets per-block / per-message permalink buttons reach App's state
// without prop-drilling through Virtuoso + Transcript + Blocks. App
// provides this; nothing else does. A click on a permalink updates the
// target, which makes App's URL effect rewrite the search string.
export interface PermalinkApi {
  selectTarget: (msg: string, block: string | null) => void;
}

export const PermalinkContext = createContext<PermalinkApi | null>(null);
export const usePermalinks = () => useContext(PermalinkContext);
