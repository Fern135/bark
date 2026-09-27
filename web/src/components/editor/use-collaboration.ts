import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Collaboration, type CollaborationState } from "@/lib/collaboration";
import type { Game } from "@/lib/games";
import type { SaveSeed } from "@/lib/autosave";
import { useSession } from "@/components/auth/session";

export function useCollaboration(seed: SaveSeed, game: Game, apply: (game: Game) => void) {
  const callback = useRef(apply);
  useEffect(() => { callback.current = apply; }, [apply]);
  const [state, setState] = useState<CollaborationState>({ status: "pending", message: "Connecting…", dirty: seed.dirty, localError: "", connected: false, members: [], peers: [], locks: [], conn: "" });
  const [client] = useState(() => seed.collaboration ? new Collaboration(seed, game, setState, (next) => callback.current(next)) : null);
  const router = useRouter();
  const { user, loading } = useSession();
  useEffect(() => {
    if (!seed.collaboration) return;
    client?.start();
    const offline = () => client?.offline(), online = () => client?.retry();
    window.addEventListener("offline", offline); window.addEventListener("online", online);
    return () => { window.removeEventListener("offline", offline); window.removeEventListener("online", online); client?.dispose(); };
  }, [seed.collaboration, client]);
  useEffect(() => {
    if (!loading && user?.user_id !== seed.owner) client?.suspend();
  }, [user, loading, seed.owner, client]);
  async function leave(event: { preventDefault(): void }, destination: string) {
    event.preventDefault();
    const saved = await client?.settled();
    const recovered = await client?.keepDraft();
    if (saved || window.confirm(recovered ? "Some shared edits are unsaved. Keep them on this device and leave?" : "Local recovery failed. Export JSON before leaving. Leave anyway?")) { window.dispatchEvent(new Event("bark:leave-editor")); router.push(destination); }
  }
  return {
    ...state, client, leave, gameId: seed.id,
    identity: () => seed, flush: () => client?.settled(),
    retry: () => client?.retry(),
    signIn: async () => { if (!(await client?.keepDraft())) return; window.dispatchEvent(new Event("bark:leave-editor")); router.push(`/login?next=${encodeURIComponent(`/editor?id=${seed.id}`)}`); },
    reload: () => { if (window.confirm("Replace local edits with the saved workspace?")) void client?.reload(); },
    copy: async () => { try { const saved = await client?.copy(); if (saved) { window.dispatchEvent(new Event("bark:leave-editor")); window.history.replaceState(null, "", `/editor?id=${saved.id}`); location.reload(); } } catch (e) { setState((old) => ({ ...old, localError: (e as Error).message })); } },
  };
}
