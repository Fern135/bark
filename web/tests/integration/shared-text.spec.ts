import { test, expect } from "@playwright/test";
import { mergeText, textChanges } from "../../src/lib/shared-text";
import { Text } from "@codemirror/state";

test("concurrent insertions, deletion and Unicode preserve both authors' intent", () => {
  expect(mergeText("hello", "hello local", "remote hello")).toBe("remote hello local");
  expect(mergeText("ab", "aLb", "aRb")).toBe("aRLb");
  expect(mergeText("abc", "ac", "abXc")).toBe("aXc");
  expect(mergeText("a🐕b", "a🐕b!", "🐾a🐕b")).toBe("🐾a🐕b!");
  expect(mergeText("one\ntwo\nthree", "ONE\ntwo\nTHREE", "one\nTWO\nthree")).toBe("ONE\nTWO\nTHREE");
  const before = "print('original')\n", after = "# hello\nprint('original')\n# bye";
  const changes = textChanges(before, after);
  expect(changes.apply(Text.of(before.split("\n"))).toString()).toBe(after);
  expect(changes.mapPos(8)).toBe(16);
});
