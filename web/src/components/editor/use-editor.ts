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
import { choicesFor, starterGame } from "./catalog";

export type Game = GameDocument<ProjectDocument>;
export function useEditor(initialGame?: Game) {
  const [game, setGame] = useState<Game>(() => initialGame ? structuredClone(initialGame) : starterGame());
  const [savedLabel, setSavedLabel] = useState(initialGame ? "Loaded from collection" : "Ready to create");
  const current = useRef(game);
  const importedAtStart = useRef(!!initialGame);
  const canvas = useRef<HTMLCanvasElement>(null);
  const runtime = useRef<GameRuntime | null>(null);
  const session = useRef<ScriptingSession | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [dirty, setDirty] = useState(!initialGame);
  const dirtyRef = useRef(!initialGame);
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
    !ready || busy || ["running", "paused", "preparing"].includes(status);

  const report = useCallback((error: unknown) => {
    if (alive.current)
      setDiagnostic({
        message: error instanceof Error ? error.message : String(error),
      });
  }, []);
  const commit = useCallback((next: Game, changed = true) => {
    current.current = next;
    setBlockChoices(choicesFor(next.project));
    setGame(next);
    if (changed) {
      dirtyRef.current = true;
      setDirty(true);
    }
  }, []);

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
              commit({ ...current.current, project: engine!.exportProject() });
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
    return () => {
      alive.current = false;
      abort.abort();
      cancelled.current?.abort();
      node.removeEventListener("blur", blur);
      window.removeEventListener("beforeunload", unload);
      observer?.disconnect();
      off.forEach((fn) => fn());
      scripting?.dispose();
      engine?.dispose();
      runtime.current = null;
      session.current = null;
    };
  }, [report, commit, recordTransform]);

  useEffect(() => {
    if (ready) runtime.current?.editorTools.configure({ ...tools, selected, enabled: viewportActive && !lock });
  }, [ready, tools, selected, viewportActive, lock, revision]);

  function snapshot() {
    return {
      ...current.current,
      project: {
        ...runtime.current!.exportProject(),
        name: current.current.project.name,
      },
    };
  }
  function edit(action: (engine: GameRuntime) => void) {
    if (lock || operation.current) return;
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
  function update(id: string, changes: EntityChanges) {
    if (lock || operation.current) return;
    try {
      const engine = runtime.current!; engine.editorTools.cancel();
      const before = engine.world.get(id).transform;
      engine.world.update(id, changes);
      if (changes.transform && Object.keys(changes).length === 1) recordTransform(id, before, engine.world.get(id).transform);
      else clearHistory();
      commit(snapshot()); setDiagnostic(undefined);
    } catch (error) { report(error); }
  }
  function undoTransform(redo = false) {
    if (lock || operation.current) return;
    const source = redo ? history.current.redo : history.current.undo;
    const target = redo ? history.current.undo : history.current.redo;
    const entry = source.at(-1); if (!entry) return;
    try {
      runtime.current!.editorTools.cancel();
      runtime.current!.transforms.set(entry.id, redo ? entry.after : entry.before);
      source.pop(); target.push(entry); setSelected(entry.id);
      setHistorySize({ undo: history.current.undo.length, redo: history.current.redo.length });
      commit(snapshot()); setDiagnostic(undefined);
    } catch (error) { report(error); }
  }
  function script(next: ScriptDocument) {
    if (
      lock ||
      operation.current ||
      JSON.stringify(next) === JSON.stringify(current.current.script)
    )
      return;
    commit({ ...current.current, script: next });
    setDiagnostic(undefined);
  }
  function rename(name: string) {
    if (!lock)
      commit({
        ...current.current,
        project: { ...current.current.project, name },
      });
  }
  async function load(next: Game, imported = false) {
    if (operation.current || lock) return false;
    operation.current = true;
    setBusy(true);
    setDiagnostic(undefined);
    const abort = new AbortController();
    cancelled.current = abort;
    try {
      const validated = await parseGame(JSON.stringify(next), {
        baseUrl: location.href,
        signal: abort.signal,
      });
      await runtime.current!.load(validated.project, { signal: abort.signal });
      clearHistory();
      runtime.current!.cameras.frame(undefined, 1.05);
      if (abort.signal.aborted) return false;
      commit(validated, !imported);
      if (imported) {
        setSavedLabel("Imported from file");
        dirtyRef.current = false;
        setDirty(false);
      }
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
        dirtyRef.current &&
        !window.confirm(
          "Replace this world? Export JSON first to keep your unsaved changes.",
        )
      )
        return;
      operation.current = false;
      await load(parsed, true);
    } catch (error) {
      if (!abort.signal.aborted) report(error);
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function save() {
    if (lock || operation.current) return;
    operation.current = true;
    setBusy(true);
    setDiagnostic(undefined);
    const abort = new AbortController();
    cancelled.current = abort;
    try {
      const json = await serializeGame(snapshot(), {
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
      setSavedLabel("File saved locally");
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      dirtyRef.current = false;
      setDirty(false);
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
  function convert() {
    if (lock) return;
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
    tools, setTools, setViewportActive, transformPreview, historySize, undoTransform,
    cancelTransform: () => runtime.current?.editorTools.cancel(),
    game,
    canvas,
    session,
    ready,
    busy,
    status,
    dirty,
    savedLabel,
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
    save,
    play,
    convert,
    remove,
    frame: (id?: string) => {
      if (!lock) runtime.current?.cameras.frame(id, id ? 1.3 : 1.05);
    },
  };
}
