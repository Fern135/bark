"use client";
import { useEffect, useRef, useState } from "react";
import type { PublicGameDetail } from "@/lib/marketplace";
import s from "./community.module.css";

export function IsolatedPlayer({ game }: { game: PublicGameDetail }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const node = frame.current!;
    const origin = location.origin;
    let loaded = false;
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => setError("The player could not start. Please try again."), 30_000);
    const ready = (event: MessageEvent) => {
      if (event.source !== node.contentWindow || event.data?.type !== "bark-player-ready" || loaded) return;
      loaded = true; clearTimeout(timeout);
      node.contentWindow!.postMessage({ type: "bark-player-connect" }, "*", [channel.port2]);
      channel.port1.postMessage({ type: "load", game, origin });
    };
    window.addEventListener("message", ready);
    // No same-origin, navigation, popup, form, or storage privileges. Blob workers inherit this CSP.
    const policy = `default-src 'none'; script-src ${origin}/community-runtime/ ${origin}/runtime/ blob: 'unsafe-eval' 'wasm-unsafe-eval'; connect-src ${origin}/runtime/ data: blob:; img-src ${origin}/images/ data: blob:; style-src 'unsafe-inline'; worker-src blob:; base-uri 'none'; form-action 'none';`;
    node.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;background:#fff;font-family:system-ui,sans-serif}*{box-sizing:border-box}button{font:inherit}</style></head><body><div id="player"></div><script type="module" crossorigin="anonymous" src="${origin}/community-runtime/player.js"></script></body></html>`;
    return () => { clearTimeout(timeout); window.removeEventListener("message", ready); channel.port1.close(); channel.port2.close(); node.srcdoc = ""; };
  }, [game, attempt]);
  return <div className={s.playerContainer}>{error && <p role="alert">{error} <button onClick={() => { setError(""); setAttempt((n) => n + 1); }}>Retry player</button></p>}<iframe ref={frame} title={`${game.name} game player`} className={s.player} sandbox="allow-scripts" allow="fullscreen" /></div>;
}
