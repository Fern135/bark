import type { GameRuntime } from "../src/index.js";

/** Trusted game rules. Movement, targeting, properties and motion are engine operations. */
export function attachDemo(runtime: GameRuntime, report: (message: string) => void = () => {}): () => void {
  const player = runtime.world.list({ tag: "player" }).find((e) => e.character); if (!player) return () => {};
  const say = (text: string) => { runtime.feedback.notify(text); report(text); };
  const coins = () => Number(runtime.properties.get(null, "coins") ?? 0);
  runtime.feedback.setHud("coins", "Coins", coins());
  runtime.feedback.setHud("checkpoint", "Checkpoint", "Start");
  const property = runtime.on("property", ({ entityId, key }) => { if (entityId === null && key === "coins") runtime.feedback.setHud("coins", "Coins", coins()); }, { scope: "session" });
  const update = runtime.onUpdate(() => {
    if (!runtime.world.list().some((e) => e.id === player.id && e.effectiveEnabled && e.character)) return;
    const forward = runtime.cameras.forward(), length = Math.hypot(forward.x, forward.z) || 1;
    const f = { x: forward.x / length, z: forward.z / length };
    const held = (name: string) => runtime.input.action(name).held ? 1 : 0;
    const z = held("forward") - held("backward"), x = held("right") - held("left");
    runtime.characters.move(player.id, { x: f.x * z + f.z * x, y: 0, z: f.z * z - f.x * x });
    if (runtime.input.action("jump").pressed) runtime.characters.jump(player.id);
    if (runtime.input.action("interact").pressed && !runtime.interactions.interact(player.id)) say("No interaction target ahead.");
    if (runtime.world.get(player.id).worldTransform.position.y < -12) runtime.characters.respawn(player.id);
  });
  const trigger = runtime.on("trigger", ({ phase, a, b }) => {
    if (phase !== "enter" || (a !== player.id && b !== player.id)) return;
    const other = runtime.world.list().find((e) => e.id === (a === player.id ? b : a)); if (!other) return;
    if (other.tags.includes("collectible")) {
      runtime.world.destroy(other.id); runtime.properties.set(null, "coins", coins() + 1);
      say(`Collected ${coins()} coin${coins() === 1 ? "" : "s"}.`);
    }
    if (other.tags.includes("checkpoint") && !runtime.properties.get(other.id, "active")) {
      const position = other.worldTransform.position;
      runtime.characters.setSpawn(player.id, { position: { x: position.x, y: position.y + 1.1, z: position.z }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
      runtime.properties.set(other.id, "active", true); runtime.feedback.setHud("checkpoint", "Checkpoint", other.name); say("Checkpoint activated.");
    }
    if (other.tags.includes("goal")) say(`Finished with ${coins()} coins! Stop restores the world.`);
  }, { scope: "session" });
  const interact = runtime.on("interaction", ({ entityId }) => {
    const entity = runtime.world.get(entityId);
    if (entity.tags.includes("door")) {
      if (runtime.properties.get(entityId, "open")) return;
      const required = Number(runtime.properties.get(entityId, "requiredCoins") ?? 3);
      if (coins() < required) { say(`Collect ${required} coins to open the door.`); return; }
      runtime.properties.set(entityId, "open", true);
      runtime.world.update(entityId, { interaction: { ...entity.interaction!, enabled: false }, visual: entity.visual?.kind === "box" ? { ...entity.visual, color: "#EBCB87" } : entity.visual });
      const p = entity.worldTransform.position; runtime.motion.glideTo(entityId, { ...p, y: p.y + 4 }, 1.5, "easeInOut"); say("Door unlocked.");
    } else say(`Interacted with ${entity.name}.`);
  }, { scope: "session" });
  const motion = runtime.on("motion", ({ entityId, status }) => { if (status === "completed" && runtime.world.get(entityId).tags.includes("door")) say("Door open. Reach the checkpoint!"); }, { scope: "session" });
  const respawn = runtime.on("respawn", () => say("Returned to your checkpoint."), { scope: "session" });
  return () => { update(); trigger(); interact(); motion(); respawn(); property(); };
}
