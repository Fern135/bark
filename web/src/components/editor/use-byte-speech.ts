import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useSession } from "@/components/auth/session";
import { api } from "@/lib/api";

const PREFERENCE = "bark:byte-audio";
type SpeechStatus = "idle" | "loading" | "speaking" | "unavailable";

/** One cancellable voice for the currently visible tip. Never speaks on page load. */
export function useByteSpeech(message: string, open: boolean, waiting: boolean) {
  const { user } = useSession();
  const userId = user?.user_id;
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [attempt, setAttempt] = useState(0);
  const context = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const pending = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, ArrayBuffer>());
  const retryAt = useRef(0);

  const stopSpeech = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    if (source.current) {
      source.current.onended = null;
      source.current.stop();
      source.current.disconnect();
      source.current = null;
    }
  }, []);

  useEffect(() => {
    const read = () => {
      try {
        const next = localStorage.getItem(PREFERENCE) !== "off";
        if (!next) stopSpeech();
        setEnabled(next);
      } catch { /* Session preference still works. */ }
    };
    queueMicrotask(read);
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, [stopSpeech]);

  // A browser gesture unlocks audio before the asynchronous TTS request.
  function activate() {
    stopSpeech();
    if (!enabled) return;
    try {
      const audio = context.current ??= new AudioContext();
      void audio.resume().catch(() => setStatus("unavailable"));
      setAttempt((value) => value + 1);
    } catch { setStatus("unavailable"); }
  }

  function toggle() {
    const next = !enabled;
    stopSpeech();
    setEnabled(next);
    setStatus("idle");
    try { localStorage.setItem(PREFERENCE, next ? "on" : "off"); } catch { /* Session preference still works. */ }
    if (next) {
      try {
        const audio = context.current ??= new AudioContext();
        void audio.resume().catch(() => setStatus("unavailable"));
        setAttempt((value) => value + 1);
      } catch { setStatus("unavailable"); }
    }
  }

  useEffect(() => {
    if (!enabled || !open || !userId || waiting || !attempt) return;
    const controller = new AbortController();
    pending.current = controller;
    const current = () => !controller.signal.aborted;
    // Coalesce a tip changing as AI finishes its review.
    const timer = window.setTimeout(async () => {
      if (!current() || document.hidden) return;
      setStatus("loading");
      try {
        const key = `${userId}:${message}`;
        let bytes = cache.current.get(key);
        if (!bytes) {
          if (Date.now() < retryAt.current) throw new Error("voice_cooldown");
          const response = await api.post<ArrayBuffer>("/coach/speech/", { text: message }, {
            signal: controller.signal, responseType: "arraybuffer", timeout: 25_000,
            headers: { Accept: "audio/mpeg" },
          });
          if (!current()) return;
          bytes = response.data;
          if (!bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024) throw new Error("invalid_audio");
        }
        const audio = context.current;
        if (!audio || audio.state !== "running") throw new Error("audio_blocked");
        const buffer = await audio.decodeAudioData(bytes.slice(0));
        if (!current()) return;
        cache.current.set(key, bytes);
        if (cache.current.size > 8) cache.current.delete(cache.current.keys().next().value!);
        const voice = audio.createBufferSource();
        voice.buffer = buffer;
        voice.connect(audio.destination);
        voice.onended = () => {
          voice.disconnect();
          if (source.current === voice) source.current = null;
          if (current()) setStatus("idle");
        };
        source.current = voice;
        voice.start();
        setStatus("speaking");
      } catch (error) {
        if (!current()) return;
        if (axios.isAxiosError(error)) {
          if (error.response?.status === 401) window.dispatchEvent(new Event("bark:session-expired"));
          const retry = Number(error.response?.headers["retry-after"]);
          if (Number.isFinite(retry) && retry > 0) retryAt.current = Date.now() + Math.min(retry, 3600) * 1000;
        }
        setStatus("unavailable");
      }
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); stopSpeech(); };
  }, [enabled, open, userId, waiting, attempt, message, stopSpeech]);

  useEffect(() => {
    const hide = () => {
      if (document.hidden) { stopSpeech(); setStatus("idle"); }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      stopSpeech();
      const audio = context.current;
      context.current = null;
      if (audio) void audio.close().catch(() => {});
    };
  }, [stopSpeech]);

  return { enabled, status: waiting ? "idle" : status, activate, toggle, stop: () => { stopSpeech(); setStatus("idle"); } };
}
