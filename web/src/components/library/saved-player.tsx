"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { useSession } from "@/components/auth/session";
import { MarketHeader } from "@/components/marketplace/shell";
import { GameCanvas } from "@/components/marketplace/player";
import { gamesApi, type SavedGame } from "@/lib/games";
import { errorMessage } from "@/lib/accounts";
import { nunito } from "@/lib/fonts";
import s from "./library.module.css";
export function SavedPlayer({ id }: { id: string }) {
  const { user, loading } = useSession();
  const owner = user?.user_id;
  const [loaded, setLoaded] = useState<{ game: SavedGame; owner: string }>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!owner) return;
    const abort = new AbortController();
    void gamesApi.get(id, abort.signal).then((game) => { setLoaded({ game, owner }); setError(""); }).catch((error) => { if (!axios.isCancel(error)) setError(errorMessage(error)); });
    return () => abort.abort();
  }, [id, owner, attempt]);
  const game = loaded?.owner === user?.user_id && loaded?.game.id === id ? loaded.game : undefined;
  return <div className={`${s.page} ${nunito.className}`}><MarketHeader /><main className={s.main}><Link href="/my-games">← My Games</Link>
    {loading ? <p role="status">Checking account…</p> : !user ? <p><Link href={`/login?next=${encodeURIComponent(`/my-games/${id}`)}`}>Sign in to play your saved game</Link></p> : error ? <p role="alert">{error} <button onClick={() => setAttempt((n) => n + 1)}>Retry</button></p> : !game ? <p role="status">Loading your world…</p> : <><div className={s.heading}><h1>{game.name}</h1><Link href={`/editor?id=${id}`}>Open in editor</Link></div><GameCanvas key={`${id}-${game.revision}`} game={{ slug: id, title: game.name }} document={game.document} /></>}
  </main></div>;
}
