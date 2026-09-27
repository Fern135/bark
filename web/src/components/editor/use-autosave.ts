import { useEffect, useRef, useState } from "react";
import { Autosave, type SaveSeed, type SaveState } from "@/lib/autosave";
import type { Game } from "@/lib/games";
import { useSession } from "@/components/auth/session";
import { useRouter } from "next/navigation";

export function useAutosave(game: Game, seed: SaveSeed, enabled = true) {
  const { user } = useSession();
  const router = useRouter();
  const controller = useRef<Autosave | null>(null);
  const first = useRef({ game, seed });
  const previous = useRef(game);
  const [gameId, setGameId] = useState(seed.id);
  const [state, setState] = useState<SaveState>({ status: "pending", message: "Opening…", localError: "", dirty: seed.dirty });
  useEffect(() => {
    if (!enabled) return;
    const saver = new Autosave(first.current.seed, first.current.game, (next) => { setState(next); setGameId(saver.identity.id); });
    controller.current = saver; previous.current = first.current.game;
    saver.start();
    const online = () => saver.retry(true);
    window.addEventListener("online", online);
    return () => { window.removeEventListener("online", online); saver.dispose(); controller.current = null; };
  }, [enabled]);
  useEffect(() => { controller.current?.setUser(user?.user_id ?? null); }, [user]);
  useEffect(() => { if (previous.current !== game) { previous.current = game; controller.current?.update(game); } }, [game]);
  async function leave(event: { preventDefault(): void }, destination: string) {
    event.preventDefault();
    const saver = controller.current;
    if (!saver) return;
    const saved = await saver.flush();
    await saver.keepDraft();
    if (saved || window.confirm("This world has unsaved changes. Leave anyway? Export JSON first if local recovery is unavailable.")) {
      window.dispatchEvent(new Event("bark:leave-editor"));
      router.push(destination);
    }
  }
  async function signIn() {
    const saver = controller.current;
    if (!saver || !(await saver.keepDraft())) return;
    const seed = saver.identity;
    const next = `/editor?${seed.revision === null ? "draft" : "id"}=${seed.id}${seed.owner === null ? "&adopt=1" : ""}`;
    window.dispatchEvent(new Event("bark:leave-editor"));
    router.push(`/login?next=${encodeURIComponent(next)}`);
  }
  return { ...state, gameId, flush: () => {
    const saver = controller.current;
    if (saver?.identity.revision === null) saver.update(game);
    return saver?.flush();
  }, identity: () => controller.current?.identity, leave, signIn, retry: () => controller.current?.retry(), copy: () => controller.current?.copy(), reload: () => {
    if (window.confirm("Reload the saved version? Your local version will be replaced. Export JSON first to keep it.")) {
      const saver = controller.current;
      if (saver) void import("@/lib/drafts").then(async ({ drafts }) => {
        const seed = saver.identity;
        await saver.keepDraft();
        await drafts.remove(seed.owner, seed.id);
        saver.dispose(false);
        window.dispatchEvent(new Event("bark:leave-editor"));
        window.history.replaceState(null, "", `/editor?id=${seed.id}`);
        location.reload();
      }).catch(() => setState((old) => ({ ...old, localError: "Could not clear local recovery. Export JSON before reloading." })));
    }
  } };
}
