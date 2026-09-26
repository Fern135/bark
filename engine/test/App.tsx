import { useEffect, useRef, useState } from "react";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import { createRuntime, degreesFromQuaternion, quaternionFromDegrees } from "../src/index.js";
import type { EntitySnapshot, GameRuntime, PrimitiveShape, RuntimeState, Vec3, Visual } from "../src/index.js";
import { sampleProject } from "./samples.js";
import { attachDemo } from "./demo.js";
import { FeedbackView, GameplayInspector, PlacementTools, PropertyEditor } from "./gameplay-ui.js";
import "./style.css";

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const number = (data: FormData, name: string) => { const value = String(data.get(name) ?? "").trim(); return value ? Number(value) : NaN; };
const vector = (data: FormData, prefix: string) => v(number(data, `${prefix}x`), number(data, `${prefix}y`), number(data, `${prefix}z`));
type Act = (action: () => void | Promise<void>) => void;
function VectorFields({ name, value }: { name: string; value: Vec3 }) {
  return <div className="vector-fields">{(["x", "y", "z"] as const).map((axis) => <label key={axis}>{axis.toUpperCase()}<input aria-label={`${name} ${axis.toUpperCase()}`} name={`${name}${axis}`} type="number" step="any" required defaultValue={Number(value[axis].toFixed(3))} /></label>)}</div>;
}
function Live({ runtime, selected }: { runtime: GameRuntime; selected: string | null }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => {
      try { const p = selected ? runtime.world.get(selected).worldTransform.position : null; setText(`${runtime.clock.elapsed.toFixed(1)}s · tick ${runtime.clock.tick}${p ? ` · XYZ ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}` : ""}`); } catch { setText(""); }
    }, 100);
    return () => clearInterval(timer);
  }, [runtime, selected]);
  return <output aria-label="Live world status">{text}</output>;
}
function Inspector({ entity: e, runtime: r, entities, act, refresh }: { entity: EntitySnapshot; runtime: GameRuntime; entities: EntitySnapshot[]; act: Act; refresh: () => void }) {
  const project = r.exportProject();
  const submit = (event: React.FormEvent<HTMLFormElement>, action: (data: FormData) => void) => { event.preventDefault(); const data = new FormData(event.currentTarget); act(() => { action(data); refresh(); }); };
  return <>
    <div className="section-heading"><h2>Entity inspector</h2><span>{e.id.slice(0, 12)}</span></div>
    <form onSubmit={(event) => submit(event, (d) => r.world.update(e.id, { name: String(d.get("name")), tags: String(d.get("tags")).split(",").map((s) => s.trim()).filter(Boolean), enabled: d.has("enabled"), visible: d.has("visible") }))}>
      <label>Name<input name="name" defaultValue={e.name} required /></label>
      <label>Tags (comma separated)<input name="tags" defaultValue={e.tags.join(", ")} /></label>
      <div className="two-columns"><label className="checkbox"><input type="checkbox" name="enabled" defaultChecked={e.enabled} />Enabled</label><label className="checkbox"><input type="checkbox" name="visible" defaultChecked={e.visible} />Visible</label></div>
      <button className="wide" type="submit">Apply identity</button>
    </form>
    <details open><summary>Transform &amp; hierarchy</summary>
      <form onSubmit={(event) => submit(event, (d) => r.transforms.set(e.id, { position: vector(d, "Position"), rotation: quaternionFromDegrees(vector(d, "Rotation")), scale: vector(d, "Scale") }, d.get("space") as "local" | "world"))}>
        <label>Transform space<select name="space" defaultValue="local"><option value="local">Local (fields shown)</option><option value="world">World (interpret entered values)</option></select></label>
        <h3>Position</h3><VectorFields name="Position" value={e.transform.position} />
        <h3>Rotation (degrees)</h3><VectorFields name="Rotation" value={degreesFromQuaternion(e.transform.rotation)} />
        <h3>Scale</h3><VectorFields name="Scale" value={e.transform.scale} />
        <button className="wide primary">Apply transform</button>
      </form>
      <form onSubmit={(event) => submit(event, (d) => r.transforms.reparent(e.id, String(d.get("parent")) || null))}>
        <label>Parent<select name="parent" defaultValue={e.parentId ?? ""}><option value="">World root</option>{entities.filter((item) => item.id !== e.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button className="wide">Reparent · preserve world pose</button>
      </form>
    </details>
    <details><summary>Appearance &amp; assets</summary>
      <form onSubmit={(event) => submit(event, (d) => {
        const kind = d.get("kind"); const materialId = String(d.get("material")) || undefined;
        const visual: Visual | null = kind === "group" ? null : kind === "model" ? { kind, assetId: String(d.get("asset")), materialId } : { kind: kind as PrimitiveShape, size: vector(d, "Size"), color: String(d.get("color")), materialId };
        r.world.update(e.id, { visual });
      })}>
        <label>Visual<select name="kind" defaultValue={e.visual?.kind ?? "group"}>{["group", "box", "sphere", "capsule", "model"].map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <VectorFields name="Size" value={e.visual && e.visual.kind !== "model" ? e.visual.size : v(1, 1, 1)} />
        <label>Model asset<select name="asset" defaultValue={e.visual?.kind === "model" ? e.visual.assetId : project.assets.find((a) => a.type === "model")?.id}>{project.assets.filter((a) => a.type === "model").map((a) => <option key={a.id}>{a.id}</option>)}</select></label>
        <label>Material<select name="material" defaultValue={e.visual?.materialId ?? ""}><option value="">Own color / imported material</option>{project.materials.map((m) => <option key={m.id}>{m.id}</option>)}</select></label>
        <label>Color<input type="color" name="color" defaultValue={e.visual && e.visual.kind !== "model" ? e.visual.color ?? "#8ED6A3" : "#8ED6A3"} /></label>
        <button className="wide">Apply appearance</button><p className="hint">Visual dimensions and collider dimensions can be edited independently.</p>
      </form>
    </details>
    <details><summary>Collider &amp; physics</summary>
      <form onSubmit={(event) => submit(event, (d) => r.world.update(e.id, {
        collider: d.has("collider") ? { shape: d.get("shape") as PrimitiveShape, size: vector(d, "Collider"), trigger: d.has("trigger"), membership: number(d, "membership"), mask: number(d, "mask") } : null,
        body: d.has("collider") ? { mode: d.get("mode") as "static" | "dynamic" | "kinematic", gravityEnabled: d.has("gravity"), rotationLocked: d.has("lock"), mass: number(d, "mass"), restitution: number(d, "bounce"), friction: number(d, "friction") } : null,
      }))}>
        <label className="checkbox"><input name="collider" type="checkbox" defaultChecked={!!e.collider} />Enable collider</label>
        <div className="two-columns"><label>Collider shape<select name="shape" defaultValue={e.collider?.shape ?? "box"}>{["box", "sphere", "capsule"].map((s) => <option key={s}>{s}</option>)}</select></label><label>Body<select name="mode" defaultValue={e.body?.mode ?? "static"}><option>static</option><option>dynamic</option><option>kinematic</option></select></label></div>
        <VectorFields name="Collider" value={e.collider?.size ?? v(1, 1, 1)} />
        <label className="checkbox"><input name="trigger" type="checkbox" defaultChecked={e.collider?.trigger} />Nonblocking trigger</label>
        <label className="checkbox"><input name="gravity" type="checkbox" defaultChecked={e.body?.gravityEnabled ?? true} />Gravity</label>
        <label className="checkbox"><input name="lock" type="checkbox" defaultChecked={e.body?.rotationLocked} />Lock rotation</label>
        <div className="three-columns"><label>Mass<input name="mass" type="number" step="any" min="0.01" defaultValue={e.body?.mass ?? 1} required /></label><label>Bounce<input name="bounce" type="number" step="any" min="0" max="1" defaultValue={e.body?.restitution ?? 0.3} required /></label><label>Friction<input name="friction" type="number" step="any" min="0" max="1" defaultValue={e.body?.friction ?? 0.5} required /></label></div>
        <div className="two-columns"><label>Membership<input name="membership" type="number" min="0" max="4294967295" defaultValue={e.collider?.membership ?? 1} required /></label><label>Collision mask<input name="mask" type="number" min="0" max="4294967295" defaultValue={e.collider?.mask ?? 4294967295} required /></label></div>
        <button className="wide">Apply physics</button>
      </form>
      <form onSubmit={(event) => submit(event, (d) => r.physics.applyImpulse(e.id, vector(d, "Impulse")))}><VectorFields name="Impulse" value={v(0, 5, 0)} /><button className="wide" disabled={e.body?.mode !== "dynamic"}>Apply impulse</button></form>
    </details>
    <GameplayInspector runtime={r} entity={e} act={act} refresh={refresh} />
    <button className="wide danger" onClick={() => act(() => { r.world.destroy(e.id); refresh(); })}>Delete selected subtree</button>
  </>;
}

export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null), current = useRef<GameRuntime | null>(null), script = useRef<(() => void) | null>(null);
  const [runtime, setRuntime] = useState<GameRuntime | null>(null), [mounted, setMounted] = useState(true), [state, setState] = useState<RuntimeState>("empty");
  const [entities, setEntities] = useState<EntitySnapshot[]>([]), [selected, setSelected] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const [error, setError] = useState(""), [messages, setMessages] = useState<string[]>([]), [notice, setNotice] = useState("Edit the world, then press Play.");
  const [title, setTitle] = useState("Engine foundation");
  const log = (message: string) => setMessages((items) => [message, ...items].slice(0, 35));
  function refresh(r = current.current) {
    if (!r || ["empty", "loading", "disposed"].includes(r.state)) return;
    const items = r.world.list(); setEntities(items); setSelected((id) => items.some((e) => e.id === id) ? id : items.find((e) => e.tags.includes("player"))?.id ?? items[0]?.id ?? null); setRevision((n) => n + 1); setTitle(r.exportProject().name);
  }
  const act: Act = (action) => { setError(""); Promise.resolve().then(action).catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); }); };
  useEffect(() => {
    if (!mounted || !canvas.current) return;
    const controller = new AbortController(); let r: GameRuntime | undefined; let observer: ResizeObserver | undefined;
    setState("loading"); setError("");
    void createRuntime({ canvas: canvas.current, havokWasmUrl, signal: controller.signal }).then(async (created) => {
      r = created;
      r.on("state", ({ state: next }) => { if (controller.signal.aborted) return; setState(next); log(`State → ${next}`); if (next === "editing") { script.current?.(); script.current = null; setNotice("Authored scene restored. Ready to edit."); refresh(created); } });
      r.on("entity", ({ action, entityId }) => { if (!controller.signal.aborted) { log(`${action}: ${entityId}`); refresh(created); } });
      r.on("error", (e) => { if (!controller.signal.aborted) setError(`${e.code}: ${e.message}`); });
      for (const type of ["collision", "trigger"] as const) r.on(type, (event) => log(`${type} ${event.phase}: ${event.a} / ${event.b}`));
      r.on("interaction", (event) => log(`interact: ${event.entityId}`));
      r.on("property", (event) => { log(`property: ${event.entityId ?? "world"}.${event.key}`); refresh(created); });
      r.on("motion", (event) => { log(`motion ${event.status}: ${event.entityId}`); refresh(created); });
      r.on("target", (event) => log(`target: ${event.actorId} → ${event.targetId ?? "none"}`));
      r.on("respawn", (event) => log(`respawn: ${event.entityId}`));
      await r.load(sampleProject(), { signal: controller.signal });
      if (controller.signal.aborted) { r.dispose(); return; }
      current.current = r; setRuntime(r); refresh(r);
      observer = new ResizeObserver(() => created.resize()); observer.observe(canvas.current!); r.resize();
    }).catch((cause: unknown) => { r?.dispose(); if (!controller.signal.aborted) { setState("error"); setError(cause instanceof Error ? cause.message : String(cause)); } });
    return () => { controller.abort(); observer?.disconnect(); script.current?.(); script.current = null; r?.dispose(); current.current = null; };
  }, [mounted]);
  const chosen = entities.find((e) => e.id === selected);
  const ready = runtime && ["editing", "running", "paused"].includes(state);
  const spawn = (kind: PrimitiveShape) => act(() => { const size = kind === "capsule" ? v(1, 2, 1) : v(1, 1, 1); const id = runtime!.world.spawn({ name: `New ${kind}`, transform: { position: v(0, 4, 0) }, visual: { kind, size, color: "#EBCB87" }, collider: { shape: kind, size }, body: {} }); setSelected(id); refresh(); });
  return <div className="app">
    <header className="header"><div className="brand"><span className="brand-mark">b.</span><div><strong>bark<span> / engine</span></strong><p>Foundation playground</p></div></div><div className="status"><span className={`dot ${state === "running" ? "ready" : ""}`} />{mounted ? state : "unmounted"}</div></header>
    <div className="workspace"><aside className="sidebar">
      <div className="eyebrow">WORLD LAB / 02</div><h1>{title}</h1><p className="intro">Build a scene. Bring it to life.<br />Stop to return to your original world.</p>
      {ready && <PlacementTools runtime={runtime} canvas={canvas.current} state={state} selected={selected} select={setSelected} refresh={() => refresh()} act={act} />}
      <fieldset className="controls" disabled={!ready}>
        <div className="spawn-buttons"><button onClick={() => spawn("box")}>＋ Box</button><button onClick={() => spawn("sphere")}>＋ Ball</button><button onClick={() => spawn("capsule")}>＋ Capsule</button><button onClick={() => act(() => { setSelected(runtime!.world.spawn({ name: "Group" })); refresh(); })}>＋ Group</button></div>
        <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); act(() => { setSelected(runtime!.world.spawnPrefab(String(data.get("prefab")), v(-5, 0, 2))); refresh(); }); }}><label>Prefab<select name="prefab">{runtime && !["empty", "loading", "disposed"].includes(state) && runtime.exportProject().prefabs.map((p) => <option key={p.id}>{p.id}</option>)}</select></label><button className="wide">Spawn prefab</button></form>
        <div className="section-heading"><h2>Scene entities</h2><span>{entities.length}</span></div>
        <div className="object-list">{entities.map((e) => <button key={e.id} className="object-row" aria-pressed={e.id === selected} onClick={() => { setSelected(e.id); refresh(); }}><span>{e.parentId ? "↳ " : ""}{e.name}</span><span className="object-mode">{e.visual?.kind ?? "group"}</span></button>)}</div>
        {chosen && ready && <Inspector key={`${chosen.id}-${revision}`} entity={chosen} runtime={runtime} entities={entities} act={act} refresh={() => refresh()} />}
      </fieldset>
    </aside><main className="stage">
      <div className="stage-toolbar"><span className="eyebrow">{state === "running" || state === "paused" ? "PLAY SESSION" : "AUTHORING WORLD"}</span><div className="toolbar-actions">
        <button disabled={state !== "editing"} onClick={() => act(() => { runtime!.play(); script.current = attachDemo(runtime!); setNotice("Click the viewport · WASD move · Space jump · E interact"); refresh(); })}>Play</button>
        <button disabled={state !== "running" && state !== "paused"} onClick={() => act(() => { if (state === "paused") runtime!.resume(); else runtime!.pause(); })}>{state === "paused" ? "Resume" : "Pause"}</button>
        <button disabled={!runtime || state === "empty"} onClick={() => act(() => { runtime!.stop(); refresh(); })}>Stop / restore</button>
        <button onClick={() => { setRuntime(null); setEntities([]); setSelected(null); setMounted(!mounted); setState("empty"); }}>{mounted ? "Unmount" : "Mount viewport"}</button>
      </div></div>
      <div className="project-bar">
        <button disabled={!runtime} onClick={() => act(async () => { await runtime!.load(sampleProject()); refresh(); })}>Collect &amp; explore</button>
        <button disabled={!runtime} onClick={() => act(async () => { await runtime!.load(sampleProject(true)); refresh(); })}>Physics workshop</button>
        <label className="file-button">Import JSON<input aria-label="Import project JSON" type="file" accept=".json,application/json" disabled={!runtime} onChange={(event) => { const file = event.target.files?.[0]; if (file) act(async () => { await runtime!.load(JSON.parse(await file.text())); refresh(); }); event.target.value = ""; }} /></label>
        <button disabled={!runtime || state === "empty" || state === "loading"} onClick={() => act(() => { const url = URL.createObjectURL(new Blob([JSON.stringify(runtime!.exportProject(), null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "bark-project.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); })}>Export authored JSON</button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="viewport">{mounted ? <canvas ref={canvas} aria-label="3D foundation playground" /> : <div className="empty-state">Viewport unmounted. Mount to create a fresh runtime.</div>}{state === "loading" && <div className="loading">Loading world assets…</div>}<div className="viewport-caption">{notice}</div><FeedbackView runtime={runtime} /></div>
      <div className="stage-footer"><span>{runtime && !["empty", "loading", "disposed"].includes(state) ? <Live runtime={runtime} selected={selected} /> : "No active world"}</span><span>Drag to orbit in editor · Click viewport to control player</span></div>
      <div className="bottom-panels">
        {ready && <details><summary>World properties</summary><PropertyEditor runtime={runtime} entityId={null} act={act} refresh={() => refresh()} /></details>}
        <details><summary>Camera &amp; rendering</summary>{ready && <form key={`settings-${revision}`} onSubmit={(event) => { event.preventDefault(); const d = new FormData(event.currentTarget); act(() => { runtime.cameras.set({ active: d.get("camera") as "editor" | "follow", targetId: String(d.get("target")) || null, fieldOfView: number(d, "fov"), offset: vector(d, "Offset") }); runtime.configure({ background: String(d.get("background")), ambientIntensity: number(d, "ambient"), sunIntensity: number(d, "sun"), shadows: d.has("shadows"), resolutionScale: number(d, "resolution"), maxDevicePixelRatio: number(d, "dpr") }); refresh(); }); }}>
          <div className="three-columns"><label>Camera<select name="camera" defaultValue={runtime.cameras.get().active}><option>editor</option><option>follow</option></select></label><label>Follow target<select name="target" defaultValue={runtime.cameras.get().targetId ?? ""}><option value="">None</option>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label>FOV<input type="number" name="fov" min="15" max="120" defaultValue={runtime.cameras.get().fieldOfView} required /></label></div>
          <VectorFields name="Offset" value={runtime.cameras.get().offset} />
          <div className="three-columns"><label>Background<input type="color" name="background" defaultValue={runtime.settings.background} /></label><label>Ambient<input type="number" name="ambient" min="0" max="10" step="any" defaultValue={runtime.settings.ambientIntensity} required /></label><label>Sun<input type="number" name="sun" min="0" max="10" step="any" defaultValue={runtime.settings.sunIntensity} required /></label><label>Resolution<input name="resolution" type="number" min="0.25" max="2" step="any" defaultValue={runtime.settings.resolutionScale} required /></label><label>DPR cap<input name="dpr" type="number" min="1" max="4" step="any" defaultValue={runtime.settings.maxDevicePixelRatio} required /></label><label className="checkbox"><input name="shadows" type="checkbox" defaultChecked={runtime.settings.shadows} />Shadows</label></div><button>Apply view settings</button>
        </form>}</details>
        <details><summary>Event log · {messages.length}/35</summary><div className="event-log">{messages.map((message, i) => <div key={i}>{message}</div>)}</div></details>
      </div>
    </main></div>
  </div>;
}
