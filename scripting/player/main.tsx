import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import { createGamePlayer } from "../src/player";
import type { GamePlayer, PlayerSnapshot } from "../src/player";
import type { FeedbackSnapshot } from "@bark/engine";
import "./style.css";

function PlayerPage() {
  const canvas = useRef<HTMLCanvasElement>(null), player = useRef<GamePlayer | null>(null);
  const [snapshot, setSnapshot] = useState<PlayerSnapshot>({ status: "empty", name: null });
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<FeedbackSnapshot>({ hud: {}, notifications: [], prompt: null });
  const request = useRef(0), mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    let owned: GamePlayer | undefined, observer: ResizeObserver | undefined;
    void createGamePlayer({ canvas: canvas.current!, havokWasmUrl, pythonRuntimeUrl: "/pyodide/", signal: abort.signal }).then((instance) => {
      if (abort.signal.aborted) { instance.dispose(); return; }
      owned = instance; player.current = instance;
      instance.onStatus(setSnapshot); instance.onFeedback(setFeedback);
      instance.onDiagnostic((d) => setError(`${d.blockId ? `Block ${d.blockId}: ` : d.line ? `Line ${d.line}: ` : ""}${d.message}`));
      instance.onOutput((o) => setOutput((previous) => [...previous, o.text].slice(-100)));
      observer = new ResizeObserver(() => instance.resize()); observer.observe(canvas.current!);
      setReady(true);
    }).catch((e) => { if (!abort.signal.aborted) setError(String(e)); });
    return () => { mounted.current = false; request.current++; abort.abort(); observer?.disconnect(); owned?.dispose(); if (player.current === owned) player.current = null; };
  }, []);
  async function act(action: () => void | Promise<void>) {
    const id = ++request.current; setError("");
    try { await action(); } catch (e) { if (mounted.current && id === request.current) setError((previous) => previous || (e instanceof Error ? e.message : String(e))); }
  }
  const { status } = snapshot;
  return <main>
    <header><div><span className="brand">bark / player</span><h1>{snapshot.name ?? "Open a game"}</h1></div><a href="/">Script Lab ↗</a></header>
    <section className="toolbar" aria-label="Playback controls">
      <label className="file">Load game JSON<input aria-label="Load game JSON" type="file" accept=".json,application/json" disabled={!ready} onChange={(e) => {
        const file = e.target.files?.[0]; e.target.value = "";
        if (file) void act(async () => {
          const id = request.current, json = await file.text();
          if (!mounted.current || id !== request.current) return;
          await player.current!.load(json); setOutput([]);
        });
      }} /></label>
      <button disabled={status !== "ready"} onClick={() => void act(() => player.current!.play())}>Play</button>
      <button disabled={status !== "running" && status !== "paused"} onClick={() => void act(() => status === "paused" ? player.current!.resume() : player.current!.pause())}>{status === "paused" ? "Resume" : "Pause"}</button>
      <button disabled={!ready || status === "empty" || status === "ready"} onClick={() => void act(() => player.current!.stop())}>Stop</button>
      <button disabled={!snapshot.name || status === "loading" || status === "preparing"} onClick={() => void act(() => { setOutput([]); return player.current!.restart(); })}>Restart</button>
      <span role="status" data-testid="player-status">{ready ? status : "Initializing…"}</span>
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="viewport">
      <canvas ref={canvas} tabIndex={0} aria-label="Game viewport" />
      <div className="feedback" aria-live="polite">
        {Object.entries(feedback.hud).map(([key, item]) => <div key={key} data-testid={`hud-${key}`}>{item.label}: {typeof item.value === "object" ? JSON.stringify(item.value) : String(item.value)}</div>)}
        {feedback.notifications.map((n) => <p key={n.id}>{n.text}</p>)}
        {feedback.prompt && <p>{feedback.prompt.text}</p>}
      </div>
      {!snapshot.name && status === "empty" && <p className="empty">Choose a .bark.json file exported from Script Lab.</p>}
    </section>
    <p className="hint">Click the viewport to control the game. Loading displays the scene; Play starts its script.</p>
    <details><summary>Script output</summary><pre data-testid="player-output">{output.join("") || "No script output yet."}</pre></details>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><PlayerPage /></StrictMode>);
