import { Icon, type IconName } from "@/components/ui/icon";

export function CategoryIcon({
  name,
  fallback,
}: {
  name: string;
  fallback: IconName;
}) {
  const paths: Record<string, React.ReactNode> = {
    Events: (
      <>
        <path
          d="M5 28V4"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path d="M6 5C12 1 18 8 27 5V21C19 24 13 17 6 21Z" />
      </>
    ),
    World: (
      <>
        <circle cx="16" cy="16" r="15" />
        <path
          d="m10 3 2 5-4 3-3-1-1 6 5 2 2 6 5 5 2-6-2-4 6-3 1-5 5 2-2-5-5-4-3 3-4-3Z"
          fill="white"
        />
        <path d="m15 11 5-2 2 3-4 3Z" fill="white" />
      </>
    ),
    Control: (
      <path d="M5 8H12V5a4 4 0 0 1 8 0v3h7v7h-3a4 4 0 0 0 0 8h3v7h-8v-3a4 4 0 0 0-8 0v3H3v-8h3a4 4 0 0 0 0-8H3V8Z" />
    ),
    Variables: (
      <>
        <circle cx="16" cy="16" r="15" />
        <ellipse cx="12" cy="9" rx="7" ry="4" fill="white" opacity=".15" />
      </>
    ),
    "Characters & motion": (
      <>
        <circle cx="12" cy="9" r="7" />
        <circle cx="25" cy="10" r="5" />
        <path d="M0 31v-5c0-11 23-11 23 0v5Zm25 0v-5c0-4-1-7-4-9 9-3 11 5 11 9v5Z" />
      </>
    ),
  };
  return paths[name] ? (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      width="32"
      height="32"
      fill="currentColor"
    >
      {paths[name]}
    </svg>
  ) : (
    <Icon name={fallback} size={29} />
  );
}
