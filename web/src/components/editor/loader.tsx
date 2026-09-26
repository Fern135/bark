"use client";
import dynamic from "next/dynamic";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { findGame, gameFile } from "@/components/marketplace/catalog";
import { useSession } from "@/components/auth/session";
import { errorMessage } from "@/lib/accounts";
import { gamesApi, type Game } from "@/lib/games";
import { drafts } from "@/lib/drafts";
import type { SaveSeed } from "@/lib/autosave";
const Editor = dynamic(() => import("./editor"), { ssr: false, loading: () => <p role="status">Opening your workshop…</p> });

function EditorEntry() {
  const params = useSearchParams();
  const [request] = useState(() => ({ id: params.get("id"), draft: params.get("draft"), slug: params.get("game"), adopt: params.get("adopt") === "1" }));
  const { user, loading, error: sessionError } = useSession();
  const [loaded, setLoaded] = useState<{ game: Game; seed: SaveSeed; warning: string; frameStarter: boolean }>();
  const mounted = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (loading || mounted.current) return;
    const abort = new AbortController();
    void (async () => {
      if (request.id && !user) throw new Error(sessionError || "Sign in to open this saved game.");
      const id = request.id ?? request.draft ?? crypto.randomUUID();
      const owner = user?.user_id ?? null;
      let warning = "";
      let local;
      try {
        local = await drafts.get(owner, id);
        if (!local && request.adopt && owner) local = await drafts.get(null, id);
      } catch { warning = "Local recovery is unavailable. Export JSON to keep a backup."; }
      if (request.draft && !local && !request.slug) throw new Error("This draft is not available for this account on this device. Open a saved game from My Games or create a new world.");
      let saved;
      if (request.id || (local?.revision !== null && local?.revision !== undefined)) {
        if (!owner) throw new Error("Sign in to the original account to open this saved game.");
        saved = await gamesApi.get(id, abort.signal);
      }
      let game: Game;
      const { parseGame } = await import("@bark/scripting/player");
      if (saved) game = await parseGame(JSON.stringify(saved.document), { baseUrl: location.href, signal: abort.signal });
      else if (request.slug) {
        if (!findGame(request.slug)) throw new Error("That world is not in the Bark collection.");
        const response = await fetch(gameFile(request.slug), { signal: abort.signal });
        if (!response.ok) throw new Error("We couldn’t load this world. Please try again.");
        game = await parseGame(await response.text(), { baseUrl: location.href, signal: abort.signal });
      } else { const { starterGame } = await import("./catalog"); game = starterGame(); }
      if (abort.signal.aborted) return;
      let dirty = !saved && !request.slug;
      let revision = saved?.revision ?? null;
      let restored = false;
      if (local?.dirty && (!saved || local.updatedAt > Date.parse(saved.updated_at) || local.revision !== saved.revision)) {
        if (window.confirm("Restore your unsaved work from this device?")) {
          game = local.document; dirty = true; revision = local.revision; restored = true;
        } else await drafts.remove(local.owner, id);
      }
      const seed: SaveSeed = { id, owner, revision: saved?.collaboration && dirty && !local?.collabBase ? saved.revision : revision, dirty, collaboration: saved?.collaboration, recoveryConflict: !!(saved?.collaboration && restored && local && !local.collabBase), role: saved?.role, publication: saved?.publication, collabBase: saved?.collaboration ? (restored && local?.collabBase ? local.collabBase : saved.document) : undefined };
      if (local?.owner === null && request.adopt && owner) {
        await drafts.put({ ...seed, document: game, updatedAt: Date.now() });
        await drafts.remove(null, id);
      }
      const url = new URL(location.href);
      url.searchParams.delete("adopt");
      if (!request.id) url.searchParams.set("draft", id);
      window.history.replaceState(null, "", url);
      mounted.current = true;
      setLoaded({ game, seed, warning, frameStarter: !saved && !request.slug && !local });
    })().catch((error: unknown) => { if (!abort.signal.aborted && !axios.isCancel(error)) setError(errorMessage(error)); });
    return () => abort.abort();
  }, [loading, user, request, sessionError]);
  if (loaded) return <Editor initialGame={loaded.game} frameStarter={loaded.frameStarter} saveSeed={loaded.seed} recoveryWarning={loaded.warning} catalogSlug={request.slug ?? undefined} />;
  if (error) return <section style={{ padding: 48 }}><p role="alert">{error}</p><Link href={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in</Link>{" · "}<button onClick={() => location.reload()}>Retry</button>{" · "}<Link href="/my-games">My Games</Link></section>;
  return <p role="status" style={{ padding: 48 }}>Opening your workshop…</p>;
}
export function EditorLoader() { return <Suspense fallback={<p>Opening your workshop…</p>}><EditorEntry /></Suspense>; }
