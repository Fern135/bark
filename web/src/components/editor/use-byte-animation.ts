import { useEffect, useRef, useState } from "react";
import { RuntimeLoader } from "@/lib/rive";

export type ByteAnimation = "idle" | "hover" | "thinking";

/** One continuous render loop: idle never gets reset by hover or error updates. */
export function useByteAnimation(state: ByteAnimation) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const desired = useRef(state);
  const [ready, setReady] = useState(false);
  useEffect(() => { desired.current = state; }, [state]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const abort = new AbortController();
    let dispose = () => {};
    void (async () => {
      const [rive, response] = await Promise.all([
        RuntimeLoader.awaitInstance(),
        fetch("/animations/byte.riv", { signal: abort.signal }),
      ]);
      if (!response.ok) throw new Error("Byte animation unavailable");
      const file = await rive.load(new Uint8Array(await response.arrayBuffer()), undefined, false);
      if (abort.signal.aborted) { file.unref(); return; }
      const artboard = file.artboardByName("Artboard 1");
      // Authored timeline names; Timeline 1 is intentionally unused.
      const idle = new rive.LinearAnimationInstance(artboard.animationByName("Timeline 2"), artboard);
      const hover = new rive.LinearAnimationInstance(artboard.animationByName("Timeline 3"), artboard);
      const thinking = new rive.LinearAnimationInstance(artboard.animationByName("Timeline 4"), artboard);
      const renderer = rive.makeRenderer(element);
      let frame = 0, last = 0, thinkMix = 0, hoverMix = 0;
      let previous: ByteAnimation = "idle";
      const resize = () => {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        element.width = Math.max(1, Math.round(element.clientWidth * ratio));
        element.height = Math.max(1, Math.round(element.clientHeight * ratio));
      };
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      window.addEventListener("resize", resize);
      resize();
      const draw = (now: number) => {
        const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
        last = now;
        const next = desired.current;
        if (next !== previous) {
          if (next === "thinking" && thinkMix === 0) thinking.time = 0;
          if (previous === "hover") hover.time = Math.min(0.6, hover.time);
          previous = next;
        }
        // Let Rive advance and loop the entire idle timeline, even under a mix.
        idle.advance(dt);
        idle.apply(1);
        if (next === "hover") {
          hover.advance(dt);
          hoverMix = Math.min(1, hoverMix + dt / 0.12);
        } else {
          // Reverse the authored rise when the mouse leaves, without a reset.
          hover.time = Math.max(0, hover.time - dt);
          hoverMix = Math.min(hoverMix, hover.time / 0.12);
        }
        if (hoverMix > 0) hover.apply(hoverMix);
        const target = next === "thinking" ? 1 : 0;
        thinkMix += Math.sign(target - thinkMix) * Math.min(Math.abs(target - thinkMix), dt / 0.3);
        if (thinkMix > 0) {
          thinking.advance(dt);
          // Smoothstep blends actual character properties, without a ghost image.
          thinking.apply(thinkMix * thinkMix * (3 - 2 * thinkMix));
        }
        artboard.advance(dt);
        renderer.beginFrame();
        renderer.save();
        // Paws sit at y=300 in the 500x500 artboard. Crop the empty lower area.
        renderer.align(rive.Fit.cover, rive.Alignment.topCenter, { minX: 0, minY: 0, maxX: element.width, maxY: element.height }, artboard.bounds);
        artboard.draw(renderer);
        renderer.restore();
        frame = rive.requestAnimationFrame(draw);
      };
      dispose = () => {
        rive.cancelAnimationFrame(frame);
        observer.disconnect();
        window.removeEventListener("resize", resize);
        idle.delete(); hover.delete(); thinking.delete();
        artboard.delete(); file.unref(); renderer.delete();
      };
      frame = rive.requestAnimationFrame(draw);
      setReady(true);
    })().catch(() => { if (!abort.signal.aborted) setReady(false); });
    return () => { abort.abort(); dispose(); };
  }, []);
  return { canvas, ready };
}
