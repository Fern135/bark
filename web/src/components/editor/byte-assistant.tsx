"use client";

import { useId, useRef, useState } from "react";
import Image from "next/image";
import { useByteAnimation } from "./use-byte-animation";
import { useByteSpeech } from "./use-byte-speech";
import { Icon } from "@/components/ui/icon";
import type { ByteTip } from "./byte-tips";
import type { useByteHints } from "./use-byte-hints";
import s from "./byte-assistant.module.css";

export function ByteAssistant({
  tips,
  className,
  ai,
}: {
  tips: ByteTip[];
  className?: string;
  ai: ReturnType<typeof useByteHints>;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const bubbleId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const needsAttention = tips.some((tip) => tip.kind !== "idea");
  const state = needsAttention ? "thinking" : hovered || focused ? "hover" : "idle";
  const tip = tips[tipIndex % (tips.length || 1)];
  const message = tip?.message ?? "Open Code and try adding an event. I’ll check your code as you build!";
  const speech = useByteSpeech(message, open, ai.status === "reviewing");

  const { canvas, ready } = useByteAnimation(state);

  function askByte() {
    speech.activate();
    ai.request(needsAttention ? "review" : "idea");
    if (open) setTipIndex((index) => index + 1);
    else { setTipIndex(0); setOpen(true); }
  }

  return (
    <div
      className={`${s.assistant} ${className ?? ""}`}
      data-byte-assistant=""
      data-state={state}
      data-ready={ready}
      data-speech={speech.status}
    >
      {open && (
        <div id={bubbleId} className={s.bubble} role="status" aria-live="polite">
          <button className={s.close} aria-label="Dismiss Byte’s tip" onClick={() => { speech.stop(); setOpen(false); button.current?.focus(); }}>×</button>
          <strong>{tip?.kind === "error" ? "Let’s fix this!" : tip?.kind === "improvement" ? "A little improvement" : "Here’s an idea!"}</strong>
          <p>{message}</p>
          <small className={s.source}>{!ai.signedIn ? "Local tip · Sign in for AI tips" : !ai.enabled ? "Local tip · AI tips are off" : ai.status === "reviewing" ? "Byte is checking your project…" : ai.status === "unavailable" ? "AI is unavailable · Showing a local tip" : ai.status === "waiting" ? "Showing a tip while AI waits to check again" : tip?.source === "ai" ? "AI suggestion · Try it and test your world" : "Local project tip"}</small>
          {tips.length > 1 && <button className={s.next} onClick={askByte}>Another tip →</button>}
          <div className={s.audioControls}>
            <button type="button" className={s.audioToggle} aria-label="Byte audio" aria-pressed={speech.enabled} onClick={speech.toggle}>
              <Icon name={speech.enabled ? "volume" : "volumeOff"} size={16} />
              Sound {speech.enabled ? "on" : "off"}
            </button>
            {speech.enabled && ai.signedIn && <button type="button" className={s.replay} onClick={() => speech.activate()} disabled={ai.status === "reviewing" || speech.status === "loading"}>
              {speech.status === "loading" ? "Loading voice…" : "Hear tip"}
            </button>}
          </div>
          {speech.enabled && !ai.signedIn && <small className={s.source}>Sign in to hear Byte’s tips.</small>}
          {speech.enabled && ai.signedIn && speech.status === "unavailable" && <small className={s.source}>Voice is unavailable right now. You can still read the tip.</small>}
          {ai.signedIn && <button className={s.preference} onClick={() => ai.toggle(!ai.enabled)}>{ai.enabled ? "Turn off AI tips" : "Turn on AI tips"}</button>}
        </div>
      )}
      <button
        ref={button}
        type="button"
        className={s.character}
        aria-label={needsAttention ? "Byte assistant: help with code" : "Byte assistant: get an idea"}
        aria-expanded={open}
        aria-controls={open ? bubbleId : undefined}
        onClick={askByte}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerCancel={() => setHovered(false)}
        onFocus={(event) => setFocused(event.currentTarget.matches(":focus-visible"))}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => { if (event.key === "Escape") { speech.stop(); setOpen(false); event.stopPropagation(); } }}
      >
        {!ready && <Image src="/images/editor/byte-peek.png" alt="" fill sizes="145px" className={s.fallback} />}
        <canvas ref={canvas} className={s.canvas} aria-hidden="true" />
      </button>
    </div>
  );
}

