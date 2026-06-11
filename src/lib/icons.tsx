import { toolCat } from "./format";

interface IconProps { size?: number; fill?: boolean; stroke?: boolean; style?: React.CSSProperties; children?: React.ReactNode; }

function Svg({ size = 16, fill = false, stroke = true, style, children }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? "currentColor" : "none"}
      stroke={stroke ? "currentColor" : "none"}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
    >
      {children}
    </svg>
  );
}

export const Icons = {
  chat: (p: IconProps = {}) => <Svg {...p}><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 9 9 0 0 1-3.6-.7L3 21l1.7-5a8.4 8.4 0 0 1-.7-3.5A8.38 8.38 0 0 1 12.5 4 8.38 8.38 0 0 1 21 11.5z" /></Svg>,
  tree: (p: IconProps = {}) => <Svg {...p}><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v3M12 11H6v5M12 11h6v5" /></Svg>,
  chart: (p: IconProps = {}) => <Svg {...p}><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="7" rx=".5" /><rect x="13" y="7" width="3" height="11" rx=".5" /></Svg>,
  sun: (p: IconProps = {}) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>,
  moon: (p: IconProps = {}) => <Svg {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></Svg>,
  search: (p: IconProps = {}) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Svg>,
  chevron: (p: IconProps = {}) => <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>,
  refresh: (p: IconProps = {}) => <Svg {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" /></Svg>,
  brain: (p: IconProps = {}) => <Svg {...p}><path d="M9.5 4a2.5 2.5 0 0 0-2.5 2.5c-1.2.3-2 1.4-2 2.6 0 .5.1 1 .4 1.4-.5.5-.9 1.2-.9 2 0 1 .6 1.9 1.4 2.4 0 1.4 1.1 2.6 2.6 2.6 1 0 1.5-.5 1.5-.5V4.6S10.5 4 9.5 4zM14.5 4a2.5 2.5 0 0 1 2.5 2.5c1.2.3 2 1.4 2 2.6 0 .5-.1 1-.4 1.4.5.5.9 1.2.9 2 0 1-.6 1.9-1.4 2.4 0 1.4-1.1 2.6-2.6 2.6-1 0-1.5-.5-1.5-.5V4.6S13.5 4 14.5 4z" /></Svg>,
  terminal: (p: IconProps = {}) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></Svg>,
  file: (p: IconProps = {}) => <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Svg>,
  pencil: (p: IconProps = {}) => <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>,
  agent: (p: IconProps = {}) => <Svg {...p}><circle cx="12" cy="3.2" r="1.1" /><path d="M12 4.3V7" /><rect x="4.5" y="7" width="15" height="11" rx="3.2" /><path d="M2.6 11.2v3M21.4 11.2v3" /><circle cx="9.6" cy="12.4" r="1.15" fill="currentColor" stroke="none" /><circle cx="14.4" cy="12.4" r="1.15" fill="currentColor" stroke="none" /><path d="M9.7 15.4h4.6" /></Svg>,
  globe: (p: IconProps = {}) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Svg>,
  user: (p: IconProps = {}) => <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Svg>,
  spark: (p: IconProps = {}) => <Svg {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></Svg>,
  dot: (p: IconProps = {}) => <Svg {...p} fill stroke={false}><circle cx="12" cy="12" r="5" /></Svg>,
  arrowRight: (p: IconProps = {}) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>,
  clock: (p: IconProps = {}) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>,
  coins: (p: IconProps = {}) => <Svg {...p}><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></Svg>,
  layers: (p: IconProps = {}) => <Svg {...p}><path d="M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5" /></Svg>,
  check: (p: IconProps = {}) => <Svg {...p}><path d="M20 6L9 17l-5-5" /></Svg>,
  alert: (p: IconProps = {}) => <Svg {...p}><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></Svg>,
  hash: (p: IconProps = {}) => <Svg {...p}><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" /></Svg>,
  branch: (p: IconProps = {}) => <Svg {...p}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="8" r="2.5" /><path d="M6 8.5v7M18 10.5c0 4-6 2-6 6" /></Svg>,
  folder: (p: IconProps = {}) => <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>,
  cmd: (p: IconProps = {}) => <Svg {...p}><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" /></Svg>,
  close: (p: IconProps = {}) => <Svg {...p}><path d="M18 6L6 18M6 6l12 12" /></Svg>,
  trash: (p: IconProps = {}) => <Svg {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></Svg>,
  caretDown: (p: IconProps = {}) => <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>,
  caretUp: (p: IconProps = {}) => <Svg {...p}><path d="M6 15l6-6 6 6" /></Svg>,
  tasks: (p: IconProps = {}) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M8 12l2.5 2.5L16 9" /></Svg>,
  question: (p: IconProps = {}) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.3c-.7.3-1.1.9-1.1 1.7v.5" /><path d="M12 17h.01" /></Svg>,
  plus: (p: IconProps = {}) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>,
  image: (p: IconProps = {}) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="M3 17l5-5 4 4 3-3 6 6" /></Svg>,
  zoomIn: (p: IconProps = {}) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" /></Svg>,
  link: (p: IconProps = {}) => <Svg {...p}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" /></Svg>,
};

export function toolIcon(name?: string | null) {
  const c = toolCat(name);
  return ({ read: Icons.file, write: Icons.pencil, exec: Icons.terminal,
    agent: Icons.agent, web: Icons.globe, mcp: Icons.layers, other: Icons.dot } as const)[c];
}
