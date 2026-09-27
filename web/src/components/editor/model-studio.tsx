import { useEffect, useRef, useState } from "react";
import { createProject, createRuntime, defineEntity } from "@bark/engine";
import type { ProjectDocument, GameRuntime } from "@bark/engine";
import s from "./editor.module.css";

/** A disposable presentation scene. It never writes back into the game document. */
export function ModelStudio({
  project,
  selected,
  compact = false,
}: {
  project: ProjectDocument;
  selected: string;
  compact?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const runtime = useRef<GameRuntime | null>(null);
  const [result, setResult] = useState<{ snapshot: string; error?: string }>({
    snapshot: "",
  });
  // Serialize the selected subtree only: script and unrelated world edits do not reset orbit.
  const ids = new Set([selected]);
  let count = 0;
  while (count !== ids.size) {
    count = ids.size;
    for (const e of project.entities)
      if (e.parentId && ids.has(e.parentId)) ids.add(e.id);
  }
  const entities = project.entities.filter((e) => ids.has(e.id));
  const needed = new Set(
    entities.flatMap((e) =>
      e.visual?.kind === "model" ? [e.visual.assetId] : [],
    ),
  );
  const serialized = JSON.stringify({
    entities,
    assets: project.assets.filter(
      (a) => needed.has(a.id) || a.type === "texture",
    ),
    materials: project.materials,
  });
  const message =
    result.snapshot !== serialized ? "Preparing preview…" : result.error;
  useEffect(() => {
    const abort = new AbortController();
    let engine: GameRuntime | undefined;
    const observer = new ResizeObserver(() => engine?.resize());
    observer.observe(canvas.current!);
    void (async () => {
      engine = await createRuntime({
        canvas: canvas.current!,
        havokWasmUrl: "/runtime/HavokPhysics.wasm",
        signal: abort.signal,
      });
      const data = JSON.parse(serialized) as Pick<
        ProjectDocument,
        "entities" | "assets" | "materials"
      >;
      const root = data.entities.find((e) => e.id === selected);
      if (!root) throw new Error("Select an object to preview.");
      root.parentId = null;
      root.transform.position = { x: 0, y: 0, z: 0 };
      root.transform.rotation = { x: 0, y: 0, z: 0, w: 1 };
      for (const e of data.entities) {
        e.body = null;
        e.collider = null;
        e.character = null;
        e.interaction = null;
      }
      const doc = createProject("Model studio");
      Object.assign(doc, data);
      doc.settings = {
        ...doc.settings,
        background: "#E3F4FC",
        ambientIntensity: 0.7,
        sunIntensity: 0.65,
        shadows: true,
      };
      // Presentation pedestal sits below the root's centered model bounds.
      const height =
        project.entities.find((e) => e.id === selected)?.collider?.size.y ?? 2;
      const scale = root.transform.scale.y;
      const width = Math.max(height * scale * 1.15, 2.4);
      doc.entities.push(
        defineEntity({
          id: "__studio_pedestal",
          name: "Preview pedestal",
          transform: {
            position: { x: 0, y: (-height * scale) / 2 - 0.14, z: 0 },
          },
          visual: {
            kind: "sphere",
            size: { x: width, y: 0.28, z: width },
            color: "#A6CDBB",
          },
        }),
      );
      await engine.load(doc, { signal: abort.signal });
      if (abort.signal.aborted) return;
      engine.cameras.frame(selected, 1.9);
      runtime.current = engine;
      setResult({ snapshot: serialized });
    })().catch((error) => {
      if (!abort.signal.aborted)
        setResult({
          snapshot: serialized,
          error:
            error instanceof Error ? error.message : "Preview unavailable.",
        });
    });
    return () => {
      abort.abort();
      observer.disconnect();
      engine?.dispose();
      runtime.current = null;
    };
    // The snapshot includes the geometry and its assets; unrelated project edits are ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, selected]);
  return (
    <div className={`${s.studio} ${compact ? s.compactStudio : ""}`}>
      <canvas ref={canvas} aria-label="Interactive model preview" />
      {message && (
        <div className={s.previewMessage} role="status">
          {message}
        </div>
      )}
      <div className={s.studioCaption}>
        <span>↔</span> Drag to rotate · Scroll to zoom
      </div>
      <button
        className={s.studioReset}
        aria-label="Reset preview camera"
        onClick={() => runtime.current?.cameras.frame(selected, 1.9)}
      >
        ↺
      </button>
    </div>
  );
}
