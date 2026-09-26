import { useCallback, useEffect, useRef, useState } from "react";
import { createRuntime } from "@bark/engine";
import type {
  EntityChanges,
  FeedbackSnapshot,
  GameRuntime,
  EditorToolOptions,
  Transform,
  ProjectDocument,
} from "@bark/engine";
import {
  compilePython,
  convertToPython,
  createScriptingSession,
  restoreBlocks,
} from "@bark/scripting";
import type {
  Diagnostic,
  GameDocument,
  ScriptDocument,
  ScriptingSession,
  SessionStatus,
} from "@bark/scripting";
import {
  compileBlocks,
  setBlockChoices,
  validateBlockReferences,
} from "@bark/scripting/blocks";
import { createEngineAdapter } from "@bark/scripting/engine";
import { parseGame, serializeGame } from "@bark/scripting/player";
import { choicesFor } from "./catalog";
import type { SaveSeed } from "@/lib/autosave";
import { useAutosave } from "./use-autosave";
import { useCollaboration } from "./use-collaboration";
import { assignBlockIds, canonical } from "@/lib/collaboration";

export type Game = GameDocument<ProjectDocument>;
export function useEditor(initialGame: Game, saveSeed: SaveSeed, frameStarter = false) {
  const [game, setGame] = useState<Game>(() => structuredClone(initialGame));
  const current = useRef(game);
  const importedAtStart = useRef(!frameStarter);
  const canvas = useRef<HTMLCanvasElement>(null);
  const runtime = useRef<GameRuntime | null>(null);
  const session = useRef<ScriptingSession | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const dirtyRef = useRef(saveSeed.dirty);
  const remoteGame = useRef<Game | null>(null);
  const [remoteVersion, setRemoteVersion] = useState(0);
  const receiveRemote = useCallback((next: Game) => { remoteGame.current = next; setRemoteVersion((n) => n + 1); }, []);
  const live = useCollaboration(saveSeed, initialGame, receiveRemote);
  const privateCloud = useAutosave(game, saveSeed, !saveSeed.collaboration);
  const cloud = saveSeed.collaboration ? live : privateCloud;
  const liveClient = live.client;
  const dirty = cloud.dirty;
  useEffect(() => { dirtyRef.current = cloud.dirty; }, [cloud.dirty]);
  const [diagnostic, setDiagnostic] = useState<Diagnostic>();
  const [output, setOutput] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<FeedbackSnapshot>({
    hud: {},
    notifications: [],
    prompt: null,
  });
  const [selected, setSelected] = useState<string | null>("player");
  const [tools, setTools] = useState<Omit<EditorToolOptions, "selected" | "enabled">>({ tool: "move", space: "world", snapping: true, moveSnap: 0.5, resizeSnap: 0.25, rotateSnap: 15 });
  const [viewportActive, setViewportActive] = useState(true);
  const [transformPreview, setTransformPreview] = useState<{ id: string; transform: Transform; label: string } | null>(null);
  const history = useRef<{ undo: { id: string; before: Transform; after: Transform }[]; redo: { id: string; before: Transform; after: Transform }[] }>({ undo: [], redo: [] });
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });
  const recordTransform = useCallback((id: string, before: Transform, after: Transform) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    history.current.undo.push({ id, before: structuredClone(before), after: structuredClone(after) });
    history.current.undo = history.current.undo.slice(-100); history.current.redo = [];
    setHistorySize({ undo: history.current.undo.length, redo: 0 });
  }, []);
  const clearHistory = useCallback(() => { history.current = { undo: [], redo: [] }; setHistorySize({ undo: 0, redo: 0 }); }, []);
  const [revision, setRevision] = useState(0);
  const cancelled = useRef<AbortController | null>(null);
  const alive = useRef(false);
  const lock =
    !ready || busy || ["running", "paused", "preparing"].includes(status) || (!!saveSeed.collaboration && (!live.connected || ["conflict", "error", "session"].includes(live.status)));

  const report = useCallback((error: unknown) => {
    if (alive.current)
      setDiagnostic({
        message: error instanceof Error ? error.message : String(error),
      });
  }, []);
  const commit = useCallback((next: Game, changed = true, replacement = false, authoredBefore?: Game) => {
    const previous = authoredBefore ?? current.current;
    current.current = next;
    setBlockChoices(choicesFor(next.project));
    setGame(next);
    if (changed) {
      dirtyRef.current = true;
      liveClient?.update(next, replacement, previous);
    }
  }, [liveClient]);

  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    let engine: GameRuntime | undefined;
    let scripting: ScriptingSession | undefined;
    let observer: ResizeObserver | undefined;
    const off: (() => void)[] = [];
    const node = canvas.current!;
    void (async () => {
      engine = await createRuntime({
        canvas: node,
        havokWasmUrl: "/runtime/HavokPhysics.wasm",
        signal: abort.signal,
      });
      if (abort.signal.aborted) {
        engine.dispose();
        return;
      }
      await engine.load(current.current.project, { signal: abort.signal });
      if (abort.signal.aborted) return;
      runtime.current = engine;
      // Start the sample at character height; imported games keep an overview.
      engine.cameras.frame(importedAtStart.current ? undefined : "player", importedAtStart.current ? 1.05 : 5.5);
      setBlockChoices(choicesFor(current.current.project));
      scripting = createScriptingSession(
        createEngineAdapter(engine, {
          hasFocus: () =>
            document.activeElement === node && document.hasFocus(),
        }),
        {
          runtimeUrl: "/runtime/pyodide/",
          workerFactory: () =>
            new Worker("/runtime/worker.js", { type: "module" }),
        },
      );
      session.current = scripting;
      off.push(
        engine.on("editorSelection", ({ entityId }) => setSelected(entityId)),
        engine.on("editorTransform", (event) => {
          if (event.phase === "preview") setTransformPreview({ id: event.entityId, transform: event.transform, label: event.label });
          else {
            setTransformPreview(null);
            if (event.phase === "commit") {
              recordTransform(event.entityId, event.before, event.transform);
              commit({ ...current.current, project: { ...engine!.exportProject(), name: current.current.project.name, cameras: current.current.project.cameras } });
              liveClient?.endInteraction();
            }
          }
        }),
        scripting.onStatus(setStatus),
        scripting.onDiagnostic((value) => {
          setDiagnostic(value);
          if (engine?.state === "paused") scripting?.stop();
        }),
        scripting.onOutput(({ text }) =>
          setOutput((old) => [...old, text].slice(-100)),
        ),
        engine.on("feedback", setFeedback),
        engine.on("error", (value) => report(new Error(value.message))),
      );
      observer = new ResizeObserver(() => engine?.resize());
      observer.observe(node);
      setReady(true);
    })().catch((error) => {
      if (!abort.signal.aborted) report(error);
    });
    const blur = () => scripting?.clearMovement();
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    node.addEventListener("blur", blur);
    window.addEventListener("beforeunload", unload);
    const leave = () => { dirtyRef.current = false; };
    window.addEventListener("bark:leave-editor", leave);
    return () => {
      alive.current = false;
      abort.abort();
      cancelled.current?.abort();
      node.removeEventListener("blur", blur);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("bark:leave-editor", leave);
      observer?.disconnect();
      off.forEach((fn) => fn());
      scripting?.dispose();
      engine?.dispose();
      runtime.current = null;
      session.current = null;
    };
  }, [report, commit, recordTransform, liveClient]);

  useEffect(() => {
    if (ready) runtime.current?.editorTools.configure({ ...tools, selected, enabled: viewportActive && !lock && (!saveSeed.collaboration || !selected || liveClient?.owns(`entity:${selected}`) === true) });
  }, [ready, tools, selected, viewportActive, lock, revision, live.locks, liveClient, saveSeed.collaboration]);

  useEffect(() => {
    if (!ready || !remoteGame.current || ["running", "paused", "preparing"].includes(status) || transformPreview || operation.current) return;
    const next = remoteGame.current;
    remoteGame.current = null;
    const engine = runtime.current!;
    const old = current.current;
    void (async () => {
      const needsLoad = ["assets", "materials", "prefabs", "input"].some((key) => canonical(old.project[key as keyof ProjectDocument]) !== canonical(next.project[key as keyof ProjectDocument]));
      if (needsLoad) {
        const camera = engine.cameras.get();
        operation.current = true; setBusy(true);
        try { await engine.load(next.project); engine.cameras.set(camera); }
        finally { operation.current = false; if (alive.current) setBusy(false); }
      } else {
        const ids = new Set(next.project.entities.map((e) => e.id));
        for (const entity of old.project.entities) if (!ids.has(entity.id)) engine.world.destroy(entity.id);
        for (const entity of next.project.entities) {
          const previous = old.project.entities.find((e) => e.id === entity.id);
          if (!previous) engine.world.spawn(entity);
          else if (canonical(previous) !== canonical(entity)) engine.world.update(entity.id, entity);
        }
        if (canonical(old.project.settings) !== canonical(next.project.settings)) engine.configure(next.project.settings);
        for (const key of Object.keys(old.project.properties ?? {})) if (!(key in (next.project.properties ?? {}))) engine.properties.remove(null, key);
        for (const [key, value] of Object.entries(next.project.properties ?? {})) if (canonical(old.project.properties?.[key]) !== canonical(value)) engine.properties.set(null, key, value);
      }
      // Remote changes invalidate only local transform history for the touched objects.
      const changed = new Set([...old.project.entities, ...next.project.entities].filter((e) => canonical(old.project.entities.find((x) => x.id === e.id)) !== canonical(next.project.entities.find((x) => x.id === e.id))).map((e) => e.id));
      history.current.undo = history.current.undo.filter((e) => !changed.has(e.id));
      history.current.redo = history.current.redo.filter((e) => !changed.has(e.id));
      setHistorySize({ undo: history.current.undo.length, redo: history.current.redo.length });
      commit(next, false);
    })().catch(report);
  }, [remoteVersion, ready, status, transformPreview, busy, commit, report]);

  const lastSelection = useRef(selected);
  useEffect(() => {
    if (selected !== lastSelection.current && saveSeed.collaboration && selected && live.connected) void liveClient?.acquire([`entity:${selected}`]);
    lastSelection.current = selected;
  }, [selected, live.connected, saveSeed.collaboration, liveClient]);

  async function acquire(resources: string[]) {
    return !saveSeed.collaboration || await liveClient?.acquire(resources) === true;
  }

  function snapshot() {
    return {
      ...current.current,
      project: {
        ...runtime.current!.exportProject(),
        name: current.current.project.name,
        cameras: current.current.project.cameras,
      },
    };
  }
  async function edit(action: (engine: GameRuntime) => void) {
    if (lock || operation.current || !(await acquire(["*"]))) return;
    try {
      runtime.current!.editorTools.cancel();
      action(runtime.current!);
      clearHistory();
      commit(snapshot());
      setDiagnostic(undefined);
    } catch (error) {
      report(error);
    }
  }
  async function update(id: string, changes: EntityChanges) {
    if (lock || operation.current || !(await acquire([`entity:${id}`]))) return;
    try {
      const engine = runtime.current!; engine.editorTools.cancel();
      const before = engine.world.get(id).transform;
      engine.world.update(id, changes);
      if (changes.transform && Object.keys(changes).length === 1) recordTransform(id, before, engine.world.get(id).transform);
      else clearHistory();
      commit(snapshot()); setDiagnostic(undefined);
    } catch (error) { report(error); }
  }
  async function undoTransform(redo = false) {
    if (lock || operation.current) return;
    const source = redo ? history.current.redo : history.current.undo;
    const target = redo ? history.current.undo : history.current.redo;
    const entry = source.at(-1); if (!entry || !(await acquire([`entity:${entry.id}`]))) return;
    try {
      runtime.current!.editorTools.cancel();
      runtime.current!.transforms.set(entry.id, redo ? entry.after : entry.before);
      source.pop(); target.push(entry); setSelected(entry.id);
      setHistorySize({ undo: history.current.undo.length, redo: history.current.redo.length });
      commit(snapshot()); setDiagnostic(undefined);
    } catch (error) { report(error); }
  }
  function script(next: ScriptDocument, before?: ScriptDocument) {
    if (
      lock ||
      operation.current ||
      JSON.stringify(next) === JSON.stringify(current.current.script)
    )
      return;
    commit({ ...current.current, script: next }, true, false, before ? { ...current.current, script: before } : undefined);
    setDiagnostic(undefined);
  }
  async function rename(name: string) {
    if (!lock && saveSeed.role !== "editor" && await acquire(["section:name"]))
      commit({
        ...current.current,
        project: { ...current.current.project, name },
      });
  }
  async function load(next: Game) {
    if (operation.current || lock || !(await acquire(["*"]))) return false;
    operation.current = true;
    setBusy(true);
    setDiagnostic(undefined);
    const abort = new AbortController();
    cancelled.current = abort;
    try {
      if (saveSeed.role === "editor") next = { ...next, project: { ...next.project, name: current.current.project.name } };
      const validated = await parseGame(JSON.stringify(next), {
        baseUrl: location.href,
        signal: abort.signal,
      });
      if (saveSeed.collaboration) assignBlockIds(validated);
      await runtime.current!.load(validated.project, { signal: abort.signal });
      clearHistory();
      runtime.current!.cameras.frame(undefined, 1.05);
      if (abort.signal.aborted) return false;
      commit(validated, true, true);
      setSelected(
        validated.project.entities.find(
          (e) => !e.parentId && !e.tags.includes("ground"),
        )?.id ?? null,
      );
      setRevision((n) => n + 1);
      setOutput([]);
      return true;
    } catch (error) {
      if (!abort.signal.aborted) {
        runtime.current?.stop();
        report(error);
      }
      return false;
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function importFile(file: File) {
    if (lock || operation.current) return;
    operation.current = true;
    setBusy(true);
    const abort = new AbortController();
    cancelled.current = abort;
    try {
      const parsed = await parseGame(await file.text(), {
        baseUrl: location.href,
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      if (
        !window.confirm(
          "Replace this world? Export JSON first to keep your unsaved changes.",
        )
      )
        return;
      operation.current = false;
      await load(parsed);
    } catch (error) {
      if (!abort.signal.aborted) report(error);
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function exportFile() {
    if (!ready || operation.current) return;
    operation.current = true;
    setBusy(true);
    setDiagnostic(undefined);
    const abort = new AbortController();
    cancelled.current = abort;
    try {
      const json = await serializeGame(current.current, {
        baseUrl: location.href,
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      const url = URL.createObjectURL(
        new Blob([json], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${current.current.project.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "world"}.bark.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!abort.signal.aborted) report(error);
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function play() {
    if (!ready || operation.current) return;
    operation.current = true;
    try {
      const s = session.current!;
      s.stop();
      setDiagnostic(undefined);
      setOutput([]);
      const doc = current.current;
      const choices = choicesFor(doc.project);
      setBlockChoices(choices);
      const workspace =
        doc.script.language === "blocks"
          ? doc.script.workspace
          : doc.script.blocksBackup;
      if (workspace) {
        const errors = validateBlockReferences(workspace, choices);
        if (errors.length) {
          setDiagnostic(errors[0]);
          return;
        }
      }
      const compilation =
        doc.script.language === "blocks"
          ? compileBlocks(doc.script, choices)
          : compilePython(doc.script);
      if (compilation.diagnostics.length) {
        setDiagnostic(compilation.diagnostics[0]);
        return;
      }
      await s.prepare(compilation);
      if (!alive.current) return;
      s.play();
      canvas.current?.focus();
    } catch (error) {
      if (alive.current) {
        session.current?.stop();
        report(error);
      }
    } finally {
      operation.current = false;
    }
  }
  async function convert() {
    if (lock || !(await acquire(["*"]))) return;
    try {
      const old = current.current.script;
      if (old.language === "blocks")
        script(
          convertToPython(
            old,
            compileBlocks(old, choicesFor(current.current.project)),
          ),
        );
      else if (
        old.blocksBackup &&
        window.confirm(
          "Restore the saved blocks? Python edits made since conversion will be replaced.",
        )
      )
        script(restoreBlocks(old));
      setRevision((n) => n + 1);
    } catch (error) {
      report(error);
    }
  }
  function remove() {
    if (!selected || lock) return;
    if (
      !window.confirm(
        `Delete ${current.current.project.entities.find((e) => e.id === selected)?.name}? Scripts referencing it will need updating.`,
      )
    )
      return;
    edit((engine) => engine.world.destroy(selected));
    setSelected(null);
  }
  return {
    cloud, live, shared: !!saveSeed.collaboration, role: saveSeed.role ?? "owner", acquire,
    tools, setTools, setViewportActive, transformPreview, historySize, undoTransform,
    cancelTransform: () => runtime.current?.editorTools.cancel(),
    game,
    canvas,
    session,
    ready,
    busy,
    status,
    dirty,
    diagnostic,
    output,
    feedback,
    selected,
    setSelected,
    revision,
    lock,
    report,
    edit,
    update,
    script,
    rename,
    load,
    importFile,
    exportFile,
    play,
    convert,
    remove,
    frame: (id?: string) => {
      if (!lock) runtime.current?.cameras.frame(id, id ? 1.3 : 1.05);
    },
  };
}
