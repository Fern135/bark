import type { useEditor } from "./use-editor";
export type EditorState = Omit<
  ReturnType<typeof useEditor>,
  "canvas" | "session"
>;
