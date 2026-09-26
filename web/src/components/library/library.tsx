"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { useSession } from "@/components/auth/session";
import { MarketHeader, MarketFooter } from "@/components/marketplace/shell";
import { PublishControl } from "@/components/marketplace/publish-control";
import { Button } from "@/components/ui/button";
import { gamesApi, type GameSummary } from "@/lib/games";
import { workspaces } from "@/lib/workspaces";
import { errorMessage } from "@/lib/accounts";
import { nunito } from "@/lib/fonts";
import s from "./library.module.css";

export function Library() {
  const { user, loading: sessionLoading, error: sessionError, refresh } = useSession();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loadedFor, setLoadedFor] = useState<string>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [section, setSection] = useState<"owner" | "editor">("owner");
  const visible = games.filter((g) => g.role === section);
  const [busy, setBusy] = useState<string>();
  useEffect(() => {
    if (!user) return;
    const abort = new AbortController();
    void gamesApi.list(abort.signal).then((games) => { setGames(games); setLoadedFor(user.user_id); setError(""); }).catch((error) => { if (!axios.isCancel(error)) setError(errorMessage(error)); });
    return () => abort.abort();
  }, [user, attempt]);
  async function change(game: GameSummary, remove = false) {
    const name = remove ? undefined : window.prompt("Name your world", game.name);
    if (!remove && (!name?.trim() || name.trim() === game.name)) return;
    if (remove && !window.confirm(`Delete “${game.name}”? This cannot be undone.`)) return;
    setBusy(game.id);
    try {
      if (remove) { await gamesApi.remove(game); const { drafts } = await import("@/lib/drafts"); await drafts.remove(user!.user_id, game.id).catch(() => {}); }
      else await gamesApi.rename(game, name!.trim());
      setAttempt((n) => n + 1);
    } catch (error) {
      setError(axios.isAxiosError(error) && error.response?.status === 412 ? "This game changed elsewhere. The library has been refreshed; try your action again." : errorMessage(error));
      if (axios.isAxiosError(error) && error.response?.status === 412) setAttempt((n) => n + 1);
    } finally { setBusy(undefined); }
  }
  return <div className={`${s.page} ${nunito.className}`}><MarketHeader /><main className={s.main}>
    <div className={s.heading}><div><h1>My Games</h1><p>Your worlds and the workspaces you build together.</p></div><Link href="/join">Join workspace</Link><Link href="/editor">Create a world →</Link></div>
    {user && <div className={s.actions} role="group" aria-label="Library view"><Button variant={section === "owner" ? "primary" : "outline"} onClick={() => setSection("owner")}>Owned by me</Button><Button variant={section === "editor" ? "primary" : "outline"} onClick={() => setSection("editor")}>Shared with me</Button></div>}
    {(error || sessionError) && <div className={s.notice} role="alert">{error || sessionError} <Button size="small" onClick={() => { void refresh(); setAttempt((n) => n + 1); }}>Retry</Button></div>}
    {sessionLoading ? <p role="status">Checking account…</p> : !user ? <p><Link href="/login?next=%2Fmy-games">Log in</Link> to see your saved games. You can still <Link href="/editor">try the editor</Link>.</p> : loadedFor !== user.user_id ? <p role="status">Loading your games…</p> : visible.length === 0 ? <section className={s.card}><h2>{section === "owner" ? "A world of possibilities" : "Your team worlds will appear here"}</h2><p>{section === "owner" ? "Create your first world. Your edits will save automatically." : "Join with an invite code to build together."}</p><Link href="/editor">Start creating</Link></section> : <div className={s.grid}>{visible.map((game) => <article className={s.card} key={game.id}>
      <h2>{game.name}</h2><p>{game.publication?.is_public ? "Public" : "Private"}{game.collaboration ? ` · Shared · Owner: ${game.owner.name}` : ""} · Updated {new Date(game.updated_at).toLocaleDateString()}</p><div className={s.actions}><Link href={`/editor?id=${game.id}`}>Edit</Link><Link href={`/my-games/${game.id}`}>Play</Link>{game.role === "owner" && <Button size="small" variant="subtle" disabled={busy === game.id} onClick={() => void change(game)}>Rename</Button>}<Button size="small" variant="subtle" disabled={busy === game.id} onClick={() => { if (game.role === "owner") void change(game, true); else if (confirm(`Leave ${game.name}? You will need an invite to return.`)) void workspaces.remove(game.id, user.user_id).then(() => setAttempt((n) => n + 1)).catch((e) => setError(errorMessage(e))); }}>{game.role === "owner" ? "Delete" : "Leave"}</Button></div>
      <PublishControl id={game.id} title={game.name} role={game.role} published={game.publication?.is_public} onChange={(is_public) => setGames((all) => all.map((item) => item.id === game.id ? { ...item, publication: { is_public } } : item))} />
    </article>)}</div>}
  </main><MarketFooter /></div>;
}
