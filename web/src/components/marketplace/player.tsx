"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import type { GamePlayer, PlayerStatus } from "@bark/scripting/player";
import type { FeedbackSnapshot } from "@bark/engine";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { gameCover, gameFile, type MarketplaceGame } from "./catalog";
import type { Game } from "@/lib/games";
import s from "./marketplace.module.css";

const emptyFeedback: FeedbackSnapshot = {
  hud: {},
  notifications: [],
  prompt: null,
};
export function GameCanvas({ game, document: savedDocument, runtimeBase = "", isolated = false, coverUrl }: { game: Pick<MarketplaceGame, "slug" | "title">; document?: Game; runtimeBase?: string; isolated?: boolean; coverUrl?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const player = useRef<GamePlayer | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [feedback, setFeedback] = useState<FeedbackSnapshot>(emptyFeedback);
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const busy = status === "loading" || status === "preparing";

  useEffect(() => {
    const abort = new AbortController();
    let instance: GamePlayer | undefined;
    let resize: ResizeObserver | undefined;
    const off: (() => void)[] = [];
    const node = canvas.current!;
    async function open() {
      const { createGamePlayer } = await import("@bark/scripting/player");
      if (abort.signal.aborted) return;
      let json: string;
      if (savedDocument) json = JSON.stringify(savedDocument);
      else {
        const response = await fetch(gameFile(game.slug), { signal: abort.signal });
        if (!response.ok) throw new Error("This world could not be downloaded. Please try again.");
        json = await response.text();
      }
      if (abort.signal.aborted) return;
      instance = await createGamePlayer({
        canvas: node,
        havokWasmUrl: `${runtimeBase}/runtime/HavokPhysics.wasm`,
        pythonRuntimeUrl: `${runtimeBase}/runtime/pyodide/`,
        workerFactory: () => {
          if (!isolated) return new Worker("/runtime/worker.js", { type: "module" });
          // Chrome cannot start module blob workers from an opaque origin. A classic
          // bootstrap can import the module; queue prepare until its handler exists.
          const source = `const waiting=[];onmessage=e=>waiting.push(e);import(${JSON.stringify(`${runtimeBase}/runtime/worker.js`)}).then(()=>{for(const e of waiting)onmessage(e)}).catch(e=>postMessage({type:"error",session:waiting[0]?.data.session,diagnostic:{message:String(e)}}));`;
          const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
          const worker = new Worker(url, { credentials: "omit" });
          const terminate = worker.terminate.bind(worker);
          worker.terminate = () => { terminate(); URL.revokeObjectURL(url); };
          return worker;
        },
        signal: abort.signal,
      });
      if (abort.signal.aborted) {
        instance.dispose();
        return;
      }
      player.current = instance;
      off.push(
        instance.onStatus(({ status: next }) => setStatus(next)),
        instance.onFeedback(setFeedback),
        instance.onDiagnostic((value) => setError(value.message)),
      );
      resize = new ResizeObserver(() => instance?.resize());
      resize.observe(node);
      await instance.load(json, {
        baseUrl: runtimeBase ? `${runtimeBase}/` : location.href,
        signal: abort.signal,
      });
    }
    const visibility = () => {
      if (document.hidden && instance?.status === "running") instance.pause();
    };
    const full = () =>
      setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("fullscreenchange", full);
    void open().catch((value: unknown) => {
      if (!abort.signal.aborted) {
        setError(value instanceof Error ? value.message : String(value));
        setStatus("error");
      }
    });
    return () => {
      abort.abort();
      off.forEach((unsubscribe) => unsubscribe());
      resize?.disconnect();
      instance?.dispose();
      player.current = null;
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("fullscreenchange", full);
    };
  }, [game.slug, savedDocument, attempt, runtimeBase, isolated]);

  async function action(
    kind: "play" | "pause" | "resume" | "stop" | "restart",
  ) {
    const active = player.current;
    if (!active) return;
    setError("");
    try {
      await active[kind]();
      if (
        player.current === active &&
        active.status !== "disposed" &&
        ["play", "resume", "restart"].includes(kind)
      )
        canvas.current?.focus();
    } catch (value) {
      if (player.current === active && !["ready", "disposed"].includes(active.status))
        setError(value instanceof Error ? value.message : String(value));
    }
  }
  function retry() {
    setError("");
    setStatus("loading");
    setFeedback(emptyFeedback);
    setAttempt((value) => value + 1);
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shell.current?.requestFullscreen();
    } catch {
      setError(
        "Fullscreen is unavailable in this browser. You can keep playing here.",
      );
    }
  }
  const covered = ["loading", "ready", "preparing", "empty", "error"].includes(
    status,
  );
  return (
    <div ref={shell} className={s.playerShell} data-status={status}>
      <div className={s.stage}>
        <canvas
          ref={canvas}
          tabIndex={0}
          aria-label={`${game.title} game canvas`}
        />
        <AnimatePresence>
          {covered && (
            <motion.div
              className={s.stageCover}
              key="cover"
              initial={false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <Image
                src={coverUrl ?? (savedDocument ? `${runtimeBase}/images/games/hero.webp` : gameCover(game.slug))}
                unoptimized={isolated}
                alt=""
                fill
                sizes="(max-width: 1000px) 95vw, 65vw"
                preload
              />
              {busy ? (
                <div className={s.loading} role="status">
                  <span className={s.spinner} />
                  <p>
                    {status === "preparing"
                      ? "Waking up your world…"
                      : "Getting your world ready…"}
                  </p>
                </div>
              ) : status === "error" ? (
                <Button variant="positive" onClick={retry}>
                  Try again
                </Button>
              ) : (
                <Button
                  variant="positive"
                  onClick={() => void action("play")}
                  leadingIcon={<Icon name="play" size={23} />}
                >
                  Play game
                </Button>
              )}
              {!busy && status !== "error" && <p>A little adventure awaits.</p>}
            </motion.div>
          )}
        </AnimatePresence>
        {!covered && (
          <>
            <div className={s.hud} aria-label="Game progress">
              {Object.entries(feedback.hud).map(([key, value]) => (
                <span key={key}>
                  {value.label}
                  <b>{String(value.value)}</b>
                </span>
              ))}
            </div>
            <div className={s.notifications} aria-live="polite">
              <AnimatePresence>
                {feedback.notifications.map((notice) => (
                  <motion.p
                    key={notice.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    {notice.text}
                  </motion.p>
                ))}
              </AnimatePresence>
              {feedback.prompt && <p>{feedback.prompt.text}</p>}
            </div>
          </>
        )}
      </div>
      <div className={s.playerControls}>
        <Button
          size="small"
          variant="positive"
          disabled={!["running", "paused"].includes(status)}
          onClick={() => void action(status === "paused" ? "resume" : "pause")}
        >
          {status === "paused" ? "Resume" : "Pause"}
        </Button>
        <Button
          size="small"
          variant="outline"
          disabled={!["ready", "running", "paused"].includes(status)}
          onClick={() => void action("restart")}
        >
          Restart
        </Button>
        <Button
          size="small"
          variant="subtle"
          disabled={!["running", "paused", "preparing"].includes(status)}
          onClick={() => void action("stop")}
        >
          Stop
        </Button>
        <span className={s.playerStatus} role="status">
          {status}
        </span>
        <button
          className={s.fullscreen}
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => void toggleFullscreen()}
        >
          {fullscreen ? "Exit fullscreen" : "Fullscreen"}{" "}
          <span aria-hidden="true">⛶</span>
        </button>
      </div>
      {error && (
        <div className={s.playerError} role="alert">
          {error}
          <Button size="small" variant="outline" onClick={retry}>
            Reload game
          </Button>
        </div>
      )}
    </div>
  );
}
