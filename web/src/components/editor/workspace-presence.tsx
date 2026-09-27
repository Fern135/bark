import { useEffect, useRef } from "react";
import type { GameRuntime } from "@bark/engine";
import type { Collaboration } from "@/lib/collaboration";
import s from "./editor.module.css";

export function peerColor(user: string) {
  let hash = 0;
  for (const character of user) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return ["#7555dd", "#db6524", "#008b7d", "#c43c88", "#247ad4"][Math.abs(hash) % 5];
}

export function WorkspacePresence({ runtime, client, selected, view }: { runtime: GameRuntime | null; client: Collaboration | null; selected: string | null; view: string }) {
  const labels = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!runtime || !client) return;
    const host = labels.current;
    const update = () => {
      if (!["editing", "running", "paused"].includes(runtime.state)) return;
      client.publishPresence({ camera: runtime.cameras.pose(), selected, view });
      const peers = client.state.connected ? client.state.peers.filter((peer) => peer.conn !== client.state.conn) : [];
      runtime.editorTools.presence(peers.map((peer) => ({ ...peer, id: peer.conn, color: peerColor(peer.user), preview: peer.preview && client.state.locks.some((lock) => lock.conn === peer.conn && ["*", `entity:${peer.preview!.id}`].includes(lock.resource)) ? peer.preview : null })));
      if (!host) return;
      const active = new Set<string>();
      for (const peer of peers) {
        if (!peer.camera) continue;
        active.add(peer.conn);
        let label = Array.from(host.children).find((el) => (el as HTMLElement).dataset.peer === peer.conn) as HTMLSpanElement | undefined;
        if (!label) { label = document.createElement("span"); label.dataset.peer = peer.conn; label.className = s.peerLabel; host.append(label); }
        const name = client.state.members.find((member) => member.user === peer.user)?.name ?? "Collaborator";
        const p = runtime.cameras.project(peer.camera.position);
        label.textContent = `${name} · ${peer.view === "code" ? "Code" : peer.view === "design" ? "Design" : "Camera"}`;
        label.title = `${name}: ${Object.values(peer.camera.position).map((n) => n.toFixed(1)).join(", ")}`;
        label.style.background = peerColor(peer.user);
        const inset = Math.min(host.clientWidth / 2, label.offsetWidth / 2 + 8);
        label.style.left = `${Math.min(host.clientWidth - inset, Math.max(inset, (Number.isFinite(p.x) ? p.x : 0.5) * host.clientWidth))}px`;
        label.style.top = `${Math.min(0.9, Math.max(0.1, Number.isFinite(p.y) ? p.y : 0.5)) * 100}%`;
        label.style.opacity = p.visible ? "1" : "0.65";
      }
      for (const label of Array.from(host.children)) if (!active.has((label as HTMLElement).dataset.peer!)) label.remove();
    };
    update();
    const timer = setInterval(update, 80);
    return () => { clearInterval(timer); if (runtime.state !== "disposed" && runtime.state !== "empty") runtime.editorTools.presence([]); host?.replaceChildren(); };
  }, [runtime, client, selected, view]);
  return <div ref={labels} className={s.peerLabels} aria-label="Collaborator cameras" />;
}
