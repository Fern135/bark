import { useEffect, useMemo, useRef, useState } from "react";
import { createRuntime, validateProject } from "@bark/engine";
import type { GameRuntime, ProjectDocument } from "@bark/engine";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import {
  createScriptingSession,
  compilePython,
  convertToPython,
  restoreBlocks,
  validateDocument,
} from "../src/index";
import { compileBlocks, setBlockChoices } from "../src/blocks";
import { createEngineAdapter } from "../src/engine";
import type {
  Diagnostic,
  GameDocument,
  ScriptDocument,
  ScriptingSession,
  SessionStatus,
} from "../src/types";
import { BlocksEditor, PythonEditor } from "./Editors";
import { sampleDocument, samplePython } from "./sample";

export function App() {
  const [document, setDocument] = useState(sampleDocument);
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
  const locked = ["running", "paused", "preparing"].includes(status) || loading;
  setBlockChoices({
    entities: document.project.entities.map((e) => [e.name, e.id]),
    prefabs: document.project.prefabs.map((p) => [p.id, p.id]),
    actions: Object.keys(document.project.input).map((a) => [a, a]),
  });
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
      const scripting = createScriptingSession(createEngineAdapter(engine));
      session.current = scripting;
      scripting.onStatus(setStatus);
      scripting.onOutput(({ text, stream }) =>
        setOutput((previous) =>
          [...previous, ...(stream === "stderr" ? "! " + text : text).trimEnd().split("\n")].slice(
            -250,
          ),
        ),
      );
      scripting.onDiagnostic(setDiagnostic);
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
      observer?.disconnect();
      session.current?.dispose();
      runtime.current?.dispose();
      if (import.meta.env.DEV) delete (window as any).__barkTest;
    };
  }, []);

  function changeScript(script: ScriptDocument) {
    if (["running", "paused", "preparing"].includes(session.current?.status ?? "")) return;
    if (JSON.stringify(script) === JSON.stringify(documentRef.current.script)) return;
    const active = session.current;
    if (active?.status === "ready") active.stop();
    setPrepared(undefined);
    setDiagnostic(undefined);
    setDocument((previous) => ({ ...previous, script }));
  }
  async function loadDocument(input: unknown) {
    const parsed = validateDocument(input);
    const project = validateProject(parsed.project);
    // Validate blocks before replacing the live world; unknown block types must not silently vanish.
    if (parsed.script.language === "blocks") {
      const check = compileBlocks(parsed.script);
      if (check.diagnostics.some((d) => d.message.startsWith("Cannot load blocks")))
        throw new Error(check.diagnostics[0].message);
    }
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
    } finally {
      setLoading(false);
    }
  }
  function run(action: () => void | Promise<void>) {
    Promise.resolve()
      .then(action)
      .catch((error) =>
        setDiagnostic({ message: error instanceof Error ? error.message : String(error) }),
      );
  }
  async function prepare() {
    setDiagnostic(undefined);
    setOutput([]);
    if (session.current?.status === "error") session.current.stop();
    await session.current!.prepare(compiled);
    setPrepared(compiled.python);
  }
  function save() {
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob),
      link = window.document.createElement("a");
    link.href = url;
    link.download = "bark-game.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const problem = diagnostic ?? compiled.diagnostics[0];
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
          <button disabled={!engineReady || locked} onClick={() => fileInput.current?.click()}>
            Import game
          </button>
          <button disabled={locked} onClick={save}>
            Export game ↗
          </button>
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept=".json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) run(async () => loadDocument(JSON.parse(await file.text())));
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
                status === "paused" ? session.current!.resume() : session.current!.pause(),
              )
            }
          >
            {status === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            disabled={!engineReady || status === "idle" || status === "disposed"}
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
              <button className={!preview ? "selected" : ""} onClick={() => setPreview(false)}>
                {document.script.language === "blocks" ? "Blocks" : "Python"}
              </button>
              {document.script.language === "blocks" && (
                <button className={preview ? "selected" : ""} onClick={() => setPreview(true)}>
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
                    onClick={() => {
                      changeScript(restoreBlocks(document.script));
                      setRevision((n) => n + 1);
                    }}
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
                onChange={(workspace) => changeScript({ language: "blocks", workspace })}
              />
            ) : (
              <PythonEditor
                source={compiled.python}
                readOnly={locked || document.script.language === "blocks"}
                diagnostic={problem}
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
            <canvas ref={canvas} tabIndex={0} aria-label="Game viewport" />
            <div className="viewport-label">
              COLLECT & CREATE<span>Find all three gems. Make something new.</span>
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
            <small>Click the world to control your player.</small>
          </div>
          <div className="console-heading">
            <strong>OUTPUT</strong>
            <button onClick={() => setOutput([])}>Clear</button>
          </div>
          <pre className="console" data-testid="console">
            {output.length ? output.join("\n") : "Your script’s messages will appear here."}
          </pre>
        </section>
      </main>
      <footer>
        <span>
          LOCAL PYTHON RUNTIME <span className="dot">●</span> No server execution
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
