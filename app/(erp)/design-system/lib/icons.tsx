import type { CSSProperties } from "react";

// Lucide-derived icon paths (stroke 1.8, round caps/joins) used by the design system.
export const ICONS: Record<string, string> = {
  grid: "M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7z",
  layers: "M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  palette:
    "M12 22a10 10 0 1 1 0-20 7 7 0 0 1 7 7 4 4 0 0 1-4 4h-2a2 2 0 0 0-1 4 2 2 0 0 1-2 2zM7 10h.01M10 7h.01M14 6h.01M17 9h.01",
  type: "M4 7V4h16v3M9 20h6M12 4v16",
  shoppingBag: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0",
  package:
    "m16.5 9.4-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12",
  truck:
    "M10 17h4V5H2v12h3m5 0a2 2 0 1 0 4 0m-4 0a2 2 0 1 1-4 0m11 0h2v-5h-4m0-3h4l2 3m-4 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0",
  users:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  chart: "M3 3v18h18",
  sparkles:
    "m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3zM5 3v4M19 17v4M3 5h4M17 19h4",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18M6 6l12 12",
  plus: "M12 5v14M5 12h14",
  arrowRight: "m12 5 7 7-7 7M5 12h14",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  sun: "M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
  monitor: "M2 4h20v13H2zM8 21h8M12 17v4",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9zM13.73 21a2 2 0 0 1-3.46 0",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  trendUp: "m22 7-8.5 8.5-5-5L2 17M16 7h6v6",
  trendDown: "m22 17-8.5-8.5-5 5L2 7M16 17h6v-6",
  zap: "m13 2-11 13h9l-1 7 11-13h-9z",
  eye: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  home: "m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10",
  megaphone: "m3 11 18-5v12L3 14zM11.6 16.8a3 3 0 1 1-5.8-1.6",
  creditCard: "M2 5h20v14H2zM2 10h20",
  bangla: "M12 3v18M5 7c3-2 11-2 14 0M5 17c3 2 11 2 14 0",
  box: "M21 8V16a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z",
};

export type IconName = keyof typeof ICONS;

export const Icon = ({
  name,
  size = 16,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
    aria-hidden
  >
    <path d={ICONS[name] || ICONS.grid} />
  </svg>
);
