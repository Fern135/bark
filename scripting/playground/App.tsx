import { useEffect, useMemo, useRef, useState } from "react";
import { createRuntime } from "@bark/engine";
import type { GameRuntime } from "@bark/engine";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import {
  createScriptingSession,
  compilePython,
  convertToPython,
  restoreBlocks,
} from "../src/index";
import {
  compileBlocks,
  setBlockChoices,
  validateBlockReferences,
} from "../src/blocks";
import { createEngineAdapter } from "../src/engine";
import { choicesFor, parseGame, serializeGame } from "../src/game-file";
import type {
  Diagnostic,
  GameDocument,
  ScriptDocument,
  ScriptingSession,
  SessionStatus,
  Inspection,
} from "../src/types";
import { BlocksEditor, PythonEditor } from "./Editors";
import { sampleDocument, samplePython } from "./sample";
import { Feedback, PropertyInspector, LiveInspection } from "./Panels";

export function App() {
  const [document, setDocument] = useState(sampleDocument);
  const [inspecting, setInspecting] = useState(false),
    [inspection, setInspection] = useState<Inspection>();
  const documentRef = useRef(document);
  documentRef.current = document;
  const [revision, setRevision] = useState(0),
    [status, setStatus] = useState<SessionStatus>("idle");
  const [engineReady, setEngineReady] = useState(false),
    [preview, setPreview] = useState(false);
  const [diagnostic, setDiagnostic] = useState<Diagnostic>(),
    [output, setOutput] = useState<string[]>([]);
  const [prepared, setPrepared] = useState<string>(),
    [loading, setLoading] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const runtime = useRef<GameRuntime | null>(null),
    session = useRef<ScriptingSession | null>(null);
  const exporting = useRef<AbortController | null>(null);
  const [saving, setSaving] = useState(false);
  const locked = ["running", "paused", "preparing"].includes(status) || loading || saving;
  setBlockChoices(choicesFor(document.project));
  const compiled = useMemo(
    () =>
      document.script.language === "blocks"
        ? compileBlocks(document.script)
        : compilePython(document.script),
    [document.script],
  );

  useEffect(() => {
    const abort = new AbortController();
    let observer: ResizeObserver | undefined;
    let disposed = false;
    void (async () => {
      const engine = await createRuntime({
        canvas: canvas.current!,
        havokWasmUrl,
        signal: abort.signal,
      });
      if (disposed) {
        engine.dispose();
        return;
      }
      runtime.current = engine;
      await engine.load(documentRef.current.project, { signal: abort.signal });
      if (disposed) return;
      const scripting = createScriptingSession(
        createEngineAdapter(engine, {
          hasFocus: () =>
            window.document.activeElement === canvas.current &&
            window.document.hasFocus(),
        }),
      );
      session.current = scripting;
      scripting.onStatus(setStatus);
      scripting.onOutput(({ text, stream }) =>
        setOutput((previous) =>
          [
            ...previous,
            ...(stream === "stderr" ? "! " + text : text).trimEnd().split("\n"),
          ].slice(-250),
        ),
      );
      scripting.onDiagnostic(setDiagnostic);
      scripting.onInspection(setInspection);
      observer = new ResizeObserver(() => engine.resize());
      observer.observe(canvas.current!);
      setEngineReady(true);
      if (import.meta.env.DEV)
        (window as any).__barkTest = {
          runtime: engine,
          session: scripting,
          load: loadDocument,
          getDocument: () => documentRef.current,
        };
    })().catch((error) => {
      if (!disposed) setDiagnostic({ message: String(error) });
    });
    return () => {
      disposed = true;
      abort.abort();
      exporting.current?.abort();
      observer?.disconnect();
      session.current?.dispose();
      runtime.current?.dispose();
      if (import.meta.env.DEV) delete (window as any).__barkTest;
    };
  }, []);

  function changeScript(script: ScriptDocument) {
    if (
      ["running", "paused", "preparing"].includes(session.current?.status ?? "")
    )
      return;
    if (JSON.stringify(script) === JSON.stringify(documentRef.current.script))
      return;
    const active = session.current;
    if (active?.status === "ready") active.stop();
    setPrepared(undefined);
    setDiagnostic(undefined);
    setDocument((previous) => ({ ...previous, script }));
  }
  async function loadDocument(input: unknown) {
    const parsed = await parseGame(JSON.stringify(input), { baseUrl: window.location.href });
    const project = parsed.project;
    setLoading(true);
    try {
      session.current?.stop();
      setPrepared(undefined);
      await runtime.current!.load(project);
      setDocument({ ...parsed, project });
      setDiagnostic(undefined);
      setOutput([]);
      setPreview(false);
      setRevision((n) => n + 1);
    } catch (error) {
      session.current?.stop();
      throw error;
    } finally {
      setLoading(false);
    }
  }
  function run(action: () => void | Promise<void>) {
    Promise.resolve()
      .then(action)
      .catch((error) =>
        setDiagnostic({
          message: error instanceof Error ? error.message : String(error),
        }),
      );
  }
  async function prepare() {
    setInspection(undefined);
    setDiagnostic(undefined);
    setOutput([]);
    if (session.current?.status === "error") session.current.stop();
    await session.current!.prepare(compiled);
    setPrepared(compiled.python);
  }
  async function save() {
    if (!runtime.current || locked || exporting.current) return;
    const abort = new AbortController();
    exporting.current = abort;
    setSaving(true);
    try {
      const project = runtime.current.exportProject();
      const captured: GameDocument = {
        version: 1,
        project,
        script: structuredClone(documentRef.current.script),
      };
      const json = await serializeGame(captured, {
        baseUrl: window.location.href,
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob),
        link = window.document.createElement("a");
      link.href = url;
      const name = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bark-game";
      link.download = `${name}.bark.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      if (exporting.current === abort) exporting.current = null;
      if (!abort.signal.aborted) setSaving(false);
    }
  }
  const problem = diagnostic ?? compiled.diagnostics[0];
  function saveProperty(
    target: string | null,
    key: string,
    value: unknown,
    remove: boolean,
  ) {
    if (
      !runtime.current ||
      !["idle", "ready"].includes(session.current?.status ?? "")
    )
      return;
    if (session.current?.status === "ready") session.current.stop();
    if (remove) runtime.current.properties.remove(target, key);
    else
      runtime.current.properties.set(
        target,
        key,
        value as import("@bark/engine").JsonValue,
      );
    setDocument((previous) => ({
      ...previous,
      project: runtime.current!.exportProject(),
    }));
    setPrepared(undefined);
  }
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">b.</span>
          <div>
            <strong>bark</strong>
            <span className="brand-sub">SCRIPT LAB</span>
          </div>
        </div>
        <div className="project-title">
          {document.project.name}
          <span>One world. Your rules.</span>
        </div>
        <div className="file-actions">
          <button
            disabled={!engineReady || locked}
            onClick={() => fileInput.current?.click()}
          >
            Import game
          </button>
          <button disabled={!engineReady || locked} onClick={() => run(save)}>
            {saving ? "Packaging game…" : "Export game ↗"}
          </button>
          <a href="/player/">Open player</a>
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept=".json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file)
            run(async () => loadDocument(JSON.parse(await file.text())));
          event.target.value = "";
        }}
      />
      <div className="toolbar">
        <div className="run-actions">
          <button
            className="prepare"
            disabled={!engineReady || locked || status === "disposed"}
            onClick={() => run(prepare)}
          >
            {status === "preparing" ? "Loading Python…" : "Prepare Python"}
          </button>
          <button
            className="play"
            disabled={status !== "ready" || prepared !== compiled.python}
            onClick={() => run(() => session.current!.play())}
          >
            ▶ Play
          </button>
          <button
            disabled={!["running", "paused"].includes(status)}
            onClick={() =>
              run(() =>
                status === "paused"
                  ? session.current!.resume()
                  : session.current!.pause(),
              )
            }
          >
            {status === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            disabled={
              !engineReady || status === "idle" || status === "disposed"
            }
            onClick={() => session.current?.stop()}
          >
            ■ Stop
          </button>
        </div>
        <span className={`status ${status}`} data-testid="status">
          <i />
          {!engineReady ? "Loading world" : status}
        </span>
      </div>
      <main className="workspace">
        <section className="code-panel">
          <div className="panel-heading">
            <div className="tabs">
              <button
                className={!preview ? "selected" : ""}
                onClick={() => setPreview(false)}
              >
                {document.script.language === "blocks" ? "Blocks" : "Python"}
              </button>
              {document.script.language === "blocks" && (
                <button
                  className={preview ? "selected" : ""}
                  onClick={() => setPreview(true)}
                >
                  Python preview
                </button>
              )}
            </div>
            <span className="badge">1 game script</span>
          </div>
          <div className="authoring-actions">
            {document.script.language === "blocks" ? (
              <>
                <span>Build behavior with connected blocks.</span>
                <button
                  disabled={locked || compiled.diagnostics.length > 0}
                  onClick={() => {
                    changeScript(convertToPython(document.script, compiled));
                    setPreview(false);
                  }}
                >
                  Convert to Python →
                </button>
              </>
            ) : (
              <>
                <span>
                  {document.script.blocksBackup
                    ? "Python edits are independent of your saved blocks."
                    : "Write Python using the Bark API."}
                </span>
                {document.script.blocksBackup && (
                  <button
                    disabled={locked}
                    onClick={() =>
                      run(() => {
                        const restored = restoreBlocks(document.script);
                        if (restored.language === "blocks") {
                          const references = validateBlockReferences(
                            restored.workspace,
                            choicesFor(document.project),
                          );
                          if (references.length)
                            throw new Error(references[0].message);
                        }
                        changeScript(restored);
                        setRevision((n) => n + 1);
                      })
                    }
                  >
                    Restore saved blocks
                  </button>
                )}
              </>
            )}
          </div>
          <div className="editor-area">
            {document.script.language === "blocks" && !preview ? (
              <BlocksEditor
                key={revision}
                initial={document.script.workspace}
                disabled={locked}
                diagnostic={problem}
                executingBlock={
                  inspecting && ["running", "paused"].includes(status)
                    ? inspection?.blockId
                    : undefined
                }
                onChange={(workspace) =>
                  changeScript({ language: "blocks", workspace })
                }
              />
            ) : (
              <PythonEditor
                source={compiled.python}
                readOnly={locked || document.script.language === "blocks"}
                diagnostic={problem}
                executingLine={
                  inspecting && ["running", "paused"].includes(status)
                    ? inspection?.line
                    : undefined
                }
                onChange={(source) => {
                  if (document.script.language === "python")
                    changeScript({ ...document.script, source });
                }}
              />
            )}
          </div>
          {problem && (
            <div className="diagnostic" role="alert">
              {problem.line ? `Line ${problem.line}: ` : ""}
              {problem.message}
            </div>
          )}
        </section>
        <section className="world-panel">
          <div className="panel-heading">
            <strong>WORLD PREVIEW</strong>
            <span className="badge">3D playground</span>
          </div>
          <div className="viewport">
            <canvas
              ref={canvas}
              tabIndex={0}
              aria-label="Game viewport"
              onBlur={() => session.current?.clearMovement()}
            />
            <Feedback runtime={engineReady ? runtime.current : null} />
            <div className="viewport-label">
              COIN GATE
              <span>Collect six points. Open the gate. Reach the goal.</span>
            </div>
          </div>
          <div className="controls-hint">
            <span>
              <kbd>W A S D</kbd> move
            </span>
            <span>
              <kbd>Space</kbd> jump
            </span>
            <span>
              <kbd>R</kbd> spawn
            </span>
            <span>
              <kbd>E</kbd> interact
            </span>
            <small>Click the world to control your player.</small>
          </div>
          <div className="console-heading">
            <strong>OUTPUT</strong>
            <button onClick={() => setOutput([])}>Clear</button>
          </div>
          <pre className="console" data-testid="console">
            {output.length
              ? output.join("\n")
              : "Your script’s messages will appear here."}
          </pre>
          <div className="tools-panel">
            <PropertyInspector
              runtime={engineReady ? runtime.current : null}
              project={document.project}
              status={status}
              onSave={saveProperty}
            />
            <LiveInspection
              enabled={inspecting}
              snapshot={inspection}
              onToggle={(enabled) => {
                setInspecting(enabled);
                session.current?.setInspection(enabled);
              }}
            />
          </div>
        </section>
      </main>
      <footer>
        <span>
          LOCAL PYTHON RUNTIME <span className="dot">●</span> No server
          execution
        </span>
        <div>
          <button
            disabled={!engineReady || locked}
            onClick={() => run(() => loadDocument(sampleDocument()))}
          >
            Reset block example
          </button>
          <button
            disabled={!engineReady || locked}
            onClick={() =>
              run(() =>
                loadDocument({
                  ...sampleDocument(),
                  script: { language: "python", source: samplePython },
                }),
              )
            }
          >
            Load Python example
          </button>
        </div>
      </footer>
    </div>
  );
}
