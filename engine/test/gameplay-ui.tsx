import { useEffect, useState } from "react";
import type { EntitySnapshot, FeedbackSnapshot, GameRuntime, PlacementSnapshot, PlacementSource, RuntimeState } from "../src/index.js";
type Act = (action: () => void | Promise<void>) => void;

export function GameplayInspector({ runtime: r, entity: e, act, refresh }: { runtime: GameRuntime; entity: EntitySnapshot; act: Act; refresh: () => void }) {
  return <details><summary>Character, interaction &amp; properties</summary>
    <form onSubmit={(event) => { event.preventDefault(); const d = new FormData(event.currentTarget); act(() => {
      r.world.update(e.id, { character: d.has("character") ? { speed: Number(d.get("speed")), jumpSpeed: Number(d.get("jumpSpeed")), slopeLimit: Number(d.get("slopeLimit")), spawn: e.character?.spawn ?? { position: e.worldTransform.position, rotation: e.worldTransform.rotation } } : null,
        interaction: d.has("interaction") ? { enabled: d.has("interactionEnabled"), prompt: String(d.get("prompt")), distance: Number(d.get("distance")) } : null }); refresh();
    }); }}>
      <label className="checkbox"><input name="character" type="checkbox" defaultChecked={!!e.character} />Character controller</label>
      <p className="hint">Requires an upright, root dynamic capsule with rotation locked.</p>
      <div className="three-columns"><label>Walk speed<input name="speed" type="number" min="0" max="100" step="any" defaultValue={e.character?.speed ?? 5} /></label><label>Jump speed<input name="jumpSpeed" type="number" min="0" max="100" step="any" defaultValue={e.character?.jumpSpeed ?? 6} /></label><label>Slope limit<input name="slopeLimit" type="number" min="0" max="80" defaultValue={e.character?.slopeLimit ?? 50} /></label></div>
      <label className="checkbox"><input name="interaction" type="checkbox" defaultChecked={!!e.interaction} />Interaction target</label>
      <label className="checkbox"><input name="interactionEnabled" type="checkbox" defaultChecked={e.interaction?.enabled ?? true} />Interaction enabled</label>
      <label>Interaction prompt<input name="prompt" defaultValue={e.interaction?.prompt ?? "Interact · E"} /></label>
      <label>Interaction distance<input name="distance" type="number" min="0.01" max="100" step="any" defaultValue={e.interaction?.distance ?? 3} /></label>
      <button className="wide">Apply gameplay settings</button>
    </form>
    {e.character && <><p className="hint">Spawn: {Object.values(e.character.spawn.position).map((n) => n.toFixed(2)).join(", ")}</p><button className="wide" onClick={() => act(() => { r.characters.setSpawn(e.id, { position: e.worldTransform.position, rotation: e.worldTransform.rotation }); refresh(); })}>Use current pose as spawn</button><button className="wide" onClick={() => act(() => { r.characters.respawn(e.id); refresh(); })}>Respawn character</button></>}
    <PropertyEditor runtime={r} entityId={e.id} act={act} refresh={refresh} />
  </details>;
}
export function PropertyEditor({ runtime: r, entityId, act, refresh }: { runtime: GameRuntime; entityId: string | null; act: Act; refresh: () => void }) {
  const [key, setKey] = useState(""), [value, setValue] = useState("0");
  return <form onSubmit={(event) => { event.preventDefault(); act(() => { r.properties.set(entityId, key, JSON.parse(value)); refresh(); }); }}>
    <pre className="property-values">{JSON.stringify(r.properties.list(entityId), null, 2)}</pre>
    <label>Property key<input value={key} onChange={(e) => setKey(e.target.value)} required /></label>
    <label>Property value (JSON)<textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} required /></label>
    <div className="two-columns"><button>Set property</button><button type="button" onClick={() => act(() => { r.properties.remove(entityId, key); refresh(); })}>Remove property</button></div>
  </form>;
}
export function FeedbackView({ runtime }: { runtime: GameRuntime | null }) {
  const [feedback, setFeedback] = useState<FeedbackSnapshot>({ hud: {}, notifications: [], prompt: null });
  useEffect(() => { if (!runtime) { setFeedback({ hud: {}, notifications: [], prompt: null }); return; } setFeedback(runtime.feedback.get()); return runtime.on("feedback", setFeedback); }, [runtime]);
  return <div className="game-feedback"><div className="hud" aria-label="Game HUD">{Object.entries(feedback.hud).map(([key, entry]) => <span key={key}>{entry.label}: {typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value)}</span>)}</div>
    {feedback.prompt && <div className="interaction-prompt" role="status">{feedback.prompt.text}</div>}
    <div className="notifications" aria-live="polite">{feedback.notifications.slice(-3).map((n) => <div key={n.id}>{n.text}</div>)}</div>
  </div>;
}
export function PlacementTools({ runtime: r, canvas, state, selected, select, refresh, act }: { runtime: GameRuntime; canvas: HTMLCanvasElement | null; state: RuntimeState; selected: string | null; select: (id: string) => void; refresh: () => void; act: Act }) {
  const [preview, setPreview] = useState<PlacementSnapshot>(r.placement.get()), [source, setSource] = useState("box");
  const sync = () => setPreview(r.placement.get());
  useEffect(() => { sync(); }, [state]);
  useEffect(() => {
    if (!canvas || state !== "editing") return;
    let down: { x: number; y: number } | null = null;
    const ray = (event: PointerEvent) => { const rect = canvas.getBoundingClientRect(); return r.cameras.ray((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2); };
    const move = (event: PointerEvent) => { if (r.placement.get().active) { const p = ray(event); setPreview(r.placement.aim(p.from, p.to)); } };
    const start = (event: PointerEvent) => { down = event.button === 0 ? { x: event.clientX, y: event.clientY } : null; };
    const end = (event: PointerEvent) => {
      if (!down || event.button !== 0) return; const click = Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5; down = null; if (!click) return;
      const p = ray(event);
      act(() => { if (r.placement.get().active) { r.placement.aim(p.from, p.to); if (r.placement.get().valid) { select(r.placement.commit()); refresh(); } sync(); }
        else { const hit = r.physics.raycast(p.from, p.to); if (hit) select(hit.entityId); } });
    };
    const key = (event: KeyboardEvent) => { if (event.code === "Escape") { r.placement.cancel(); sync(); } if (event.code === "KeyR" && r.placement.get().active) { event.preventDefault(); r.placement.rotate(); sync(); } };
    const cancel = () => { down = null; };
    canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerdown", start); canvas.addEventListener("pointerup", end); canvas.addEventListener("pointerleave", cancel); canvas.addEventListener("keydown", key);
    return () => { canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerdown", start); canvas.removeEventListener("pointerup", end); canvas.removeEventListener("pointerleave", cancel); canvas.removeEventListener("keydown", key); };
  }, [r, canvas, state, select, refresh, act]);
  const begin = (source: PlacementSource) => act(() => { r.placement.begin(source); sync(); });
  return <fieldset className="placement-tools" disabled={state !== "editing"}>
    <div className="two-columns"><button aria-pressed={!preview.active} onClick={() => { r.placement.cancel(); sync(); }}>Select</button><button aria-pressed={preview.active} onClick={() => begin(source.startsWith("prefab:") ? { prefabId: source.slice(7) } : { primitive: source as "box" | "sphere" | "capsule" })}>Place</button></div>
    <label>Placement object<select value={source} onChange={(e) => setSource(e.target.value)}><option value="box">Box</option><option value="sphere">Sphere</option><option value="capsule">Capsule</option>{r.exportProject().prefabs.map((p) => <option key={p.id} value={`prefab:${p.id}`}>{p.id} prefab</option>)}</select></label>
    <div className="two-columns"><label>Grid spacing<input type="number" min="0.01" max="100" step="any" defaultValue={preview.grid} onChange={(e) => act(() => { r.placement.configure({ grid: Number(e.target.value) }); sync(); })} /></label><label>Rotation snap<input type="number" min="1" max="180" defaultValue={preview.rotationSnap} onChange={(e) => act(() => { r.placement.configure({ rotationSnap: Number(e.target.value) }); sync(); })} /></label></div>
    <div className="two-columns"><button disabled={!preview.active} onClick={() => act(() => { r.placement.rotate(); sync(); })}>Rotate · R</button><button disabled={!selected} onClick={() => selected && begin({ duplicateId: selected })}>Duplicate selection</button></div>
    {preview.active && <output aria-label="Placement status">{preview.reason} · {preview.yaw}° · Esc cancels</output>}
  </fieldset>;
}
