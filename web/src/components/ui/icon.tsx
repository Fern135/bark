import type { SVGProps } from "react";

const paths = {
  play: "m8 4 12 8-12 8Z",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  chevron: "m6 9 6 6 6-6",
  check: "m5 12 4 4L19 6",
  code: "m7 6-5 6 5 6m10-12 5 6-5 6m-4-15-2 18",
  cube: "m12 2 10 5v10l-10 5-10-5V7Zm0 10v10M2 7l10 5 10-5M7 4.5l10 5V15",
  palette: "M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 1-2.6h2a4 4 0 0 0 4-4A9 9 0 0 0 12 3ZM7 10h.01M10 7h.01M15 7h.01M18 10h.01",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  undo: "M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12",
  spark: "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z",
} satisfies Record<string, string>;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props} aria-hidden="true" focusable="false">
      <path d={paths[name]} fill={name === "play" ? "currentColor" : "none"} />
    </svg>
  );
}
