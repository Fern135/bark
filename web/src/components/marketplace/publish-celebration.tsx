"use client";

import { useEffect, useRef } from "react";
import { Alignment, Fit, Layout, Rive } from "@/lib/rive";
import s from "./publishing.module.css";

export function PublishCelebration() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    let disposed = false;
    const animation = new Rive({
      canvas: canvas.current,
      src: "/animations/confetti.riv",
      artboard: "Artboard 1",
      animations: "Timeline 2",
      autoplay: true,
      shouldDisableRiveListeners: true,
      layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
      onLoad: () => {
        if (disposed) return;
        animation.resizeDrawingSurfaceToCanvas();
        if (canvas.current) canvas.current.dataset.ready = "true";
      },
    });
    const resize = () => animation.resizeDrawingSurfaceToCanvas();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.current);
    return () => { disposed = true; observer.disconnect(); animation.cleanup(); };
  }, []);
  return <canvas ref={canvas} className={s.celebration} role="img" aria-label="Byte celebrating with confetti" data-ready="false" />;
}
