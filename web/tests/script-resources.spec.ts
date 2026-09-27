import { test, expect } from "@playwright/test";
import { applyEdits, edits, scriptResource, valueAt } from "../src/lib/workspace-document";
import { readFileSync } from "node:fs";
import type { Game } from "../src/lib/games";

function document(): Game {
  const game: Game = JSON.parse(readFileSync("../example.json", "utf8"));
  const template = game.project.entities[0];
  game.project.entities.push({ ...template, id: "a" }, { ...template, id: "b" });
  return game;
}

test("version upgrades and independent scripts round trip resource edits", () => {
  const before = document();
  const after: Game = { ...structuredClone(before), version: 2, objectScripts: { a: { language: "python", source: "hello" }, b: { language: "python", source: "second" } } };
  expect(applyEdits(before, edits(before, after))).toEqual(after);
  expect(applyEdits(after, [{ op: "set", resource: "version", before: 1, value: 2 }])).toEqual(after);
  const remote = structuredClone(after);
  remote.objectScripts!.a = { language: "python", source: "remote hello" };
  const local = structuredClone(after);
  local.objectScripts!.a = { language: "python", source: "hello local" };
  expect(applyEdits(remote, edits(after, local), false, true).objectScripts!.a).toEqual({ language: "python", source: "remote hello local" });
  expect(applyEdits(remote, edits(after, local), false, true).objectScripts!.b).toEqual(after.objectScripts!.b);
});

test("same block IDs in different objects stay independent and deletion removes only its owner", () => {
  const game: Game = { ...document(), version: 2, objectScripts: {} };
  for (const id of ["a", "b"]) game.objectScripts![id] = { language: "blocks", workspace: { blocks: { blocks: [{ id: "same", type: "bark_start" }] } } };
  const next = structuredClone(game);
  const resource = scriptResource("a", "block:same");
  const changed = { ...valueAt(game, resource) as object, x: 20 };
  const result = applyEdits(game, [{ op: "set", resource, before: valueAt(game, resource), value: changed }]);
  expect(valueAt(result, resource)).toEqual(changed);
  expect(valueAt(result, scriptResource("b", "block:same"))).toEqual(valueAt(game, resource));
  next.project.entities = next.project.entities.filter((e) => e.id !== "a");
  delete next.objectScripts!.a;
  expect(applyEdits(game, edits(game, next))).toEqual(next);
});
