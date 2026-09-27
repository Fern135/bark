import type { Game } from "./games";
import { mergeText } from "./shared-text";
export type Edit = { op: "set"; resource: string; before: unknown; value: unknown };
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export function scriptResource(scriptId: string | null, resource: string): string {
  return scriptId === null ? resource : `object:${encodeURIComponent(scriptId)}:${resource}`;
}
export function splitScriptResource(resource: string): [string | null, string] {
  if (!resource.startsWith("object:")) return [null, resource];
  const end = resource.indexOf(":", 7);
  return [decodeURIComponent(resource.slice(7, end)), resource.slice(end + 1)];
}
type Root = { id: string; [key: string]: unknown };
function roots(game: Game): Root[] {
  return game.script.language === "blocks" ? ((game.script.workspace.blocks as { blocks?: Root[] })?.blocks ?? []) : [];
}
export function valueAt(game: Game, resource: string): unknown {
  const [owner, local] = splitScriptResource(resource);
  if (owner !== null) {
    const script = game.objectScripts?.[owner];
    if (local === "script") return script ?? null;
    return script ? valueAt({ ...game, script }, local) : null;
  }
  if (resource === "version") return game.version;
  if (resource === "*") return game;
  if (resource === "script") return game.script;
  if (resource === "source") return game.script.language === "python" ? game.script.source : null;
  if (resource === "variables") return game.script.language === "blocks" ? game.script.workspace.variables ?? [] : [];
  const [kind, ...parts] = resource.split(":"); const key = parts.join(":");
  if (kind === "entity") return game.project.entities.find((e) => e.id === key) ?? null;
  if (kind === "block") return roots(game).find((e) => e.id === key) ?? null;
  return (game.project as unknown as Record<string, unknown>)[key] ?? null;
}
export function edits(before: Game, after: Game): Edit[] {
  const result: Edit[] = [];
  const add = (resource: string) => { const a = valueAt(before, resource), b = valueAt(after, resource); if (!equal(a, b)) result.push({ op: "set", resource, before: a, value: b }); };
  add("version");
  for (const id of new Set([...before.project.entities, ...after.project.entities].map((e) => e.id))) add(`entity:${id}`);
  for (const key of ["name", "settings", "cameras", "input", "properties", "assets", "materials", "prefabs"]) add(`section:${key}`);
  for (const owner of [null, ...new Set([...Object.keys(before.objectScripts ?? {}), ...Object.keys(after.objectScripts ?? {})])]) {
    const a = owner === null ? before.script : before.objectScripts?.[owner];
    const b = owner === null ? after.script : after.objectScripts?.[owner];
    const scoped = (resource: string) => add(scriptResource(owner, resource));
    if (!a || !b) scoped("script");
    else if (a.language === "python" && b.language === "python" && equal(a.blocksBackup, b.blocksBackup)) scoped("source");
    else if (a.language !== "blocks" || b.language !== "blocks") scoped("script");
    else {
      for (const id of new Set([...roots({ ...before, script: a }), ...roots({ ...after, script: b })].map((block) => block.id))) scoped(`block:${id}`);
      scoped("variables");
    }
  }
  return result;
}
export function applyEdits(document: Game, ops: Edit[], check = true, merge = false): Game {
  let game = structuredClone(document);
  for (const op of ops) {
    if (op.resource === "version" && op.value === 2 && game.version === 2) continue;
    const [owner, local] = splitScriptResource(op.resource);
    if (owner !== null) {
      if (check && !(merge && local === "source") && !equal(valueAt(game, op.resource), op.before)) throw new Error("This script changed while you were editing.");
      game.objectScripts ??= {};
      if (local === "script") {
        if (op.value === null) delete game.objectScripts[owner];
        else game.objectScripts[owner] = structuredClone(op.value) as Game["script"];
      } else {
        const script = game.objectScripts[owner];
        if (!script) throw new Error("This object's script was removed.");
        game.objectScripts[owner] = applyEdits({ ...game, script }, [{ ...op, resource: local }], check, merge).script;
      }
      continue;
    }
    if (merge && op.resource === "source" && game.script.language === "python" && typeof op.before === "string" && typeof op.value === "string") {
      game.script.source = mergeText(op.before, op.value, game.script.source);
      continue;
    }
    if (check && !equal(valueAt(game, op.resource), op.before)) throw new Error("This item changed while you were editing. Reload or save your work as a copy.");
    const value = structuredClone(op.value);
    if (op.resource === "version") { game.version = value as 2; game.objectScripts ??= {}; }
    else if (op.resource === "*") game = value as Game;
    else if (op.resource === "script") game.script = value as Game["script"];
    else if (op.resource === "source" && game.script.language === "python") game.script.source = value as string;
    else if (op.resource === "variables" && game.script.language === "blocks") game.script.workspace.variables = value;
    else if (op.resource.startsWith("section:")) (game.project as unknown as Record<string, unknown>)[op.resource.slice(8)] = value;
    else {
      const items = op.resource.startsWith("entity:") ? game.project.entities : roots(game);
      const key = op.resource.slice(op.resource.indexOf(":") + 1);
      const index = items.findIndex((i) => i.id === key);
      if (index >= 0) { if (value === null) items.splice(index, 1); else items.splice(index, 1, value as never); }
      else if (value !== null) items.push(value as never);
    }
  }
  return game;
}

export function assignBlockIds(game: Game): Game {
  for (const script of [game.script, ...Object.values(game.objectScripts ?? {})]) for (const workspace of [script.language === "blocks" ? script.workspace : script.blocksBackup]) {
    if (!workspace) continue;
    const seen = new Set<string>();
    const block = (node: Record<string, unknown>) => {
      if (typeof node.id !== "string" || !node.id || seen.has(node.id)) node.id = crypto.randomUUID();
      seen.add(node.id as string);
      const connections = [...Object.values((node.inputs ?? {}) as Record<string, Record<string, unknown>>), (node.next ?? {}) as Record<string, unknown>];
      for (const connection of connections) for (const key of ["block", "shadow"]) if (connection[key]) block(connection[key] as Record<string, unknown>);
    };
    for (const root of ((workspace.blocks as { blocks?: Record<string, unknown>[] })?.blocks ?? [])) block(root);
  }
  return game;
}

