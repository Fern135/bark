import { ChangeSet, Text, type ChangeSpec } from "@codemirror/state";
import { diffChars } from "diff";

/** Preserve unchanged ranges so cursors and local undo survive remote edits. */
export function textChanges(before: string, after: string): ChangeSet {
  const changes: ChangeSpec[] = [];
  let position = 0;
  const parts = diffChars(before, after, { timeout: 100 });
  if (!parts) throw new Error("This text edit is too large to merge. Save a copy before reloading.");
  for (const part of parts) {
    if (part.added) changes.push({ from: position, insert: part.value });
    else if (part.removed) {
      changes.push({ from: position, to: position + part.value.length });
      position += part.value.length;
    } else position += part.value.length;
  }
  return ChangeSet.of(changes, before.length);
}

/** The accepted server revision comes first; unsent intent is mapped over it. */
export function mergeText(before: string, local: string, remote: string): string {
  return textChanges(before, local).map(textChanges(before, remote))
    .apply(Text.of(remote.split("\n"))).toString();
}
