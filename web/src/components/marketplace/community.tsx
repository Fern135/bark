"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import axios from "axios";
import { marketplaceApi, type PublicGamePage } from "@/lib/marketplace";
import { Button } from "@/components/ui/button";
import { MarketHeader, MarketFooter } from "./shell";
import s from "./marketplace.module.css";
import c from "./community.module.css";

export function CollectionTabs({ demos = false }: { demos?: boolean }) {
  return <nav className={c.tabs} aria-label="Game collections"><Link href="/games" aria-current={!demos ? "page" : undefined}>Community</Link><Link href="/games?source=demos" aria-current={demos ? "page" : undefined}>Bark demos</Link></nav>;
}

export default function Community() {
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [result, setResult] = useState<{ key: string; data?: PublicGamePage; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const key = `${query}:${page}:${attempt}`;
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void marketplaceApi.list(query, page, abort.signal).then((data) => setResult({ key, data })).catch((error) => { if (!axios.isCancel(error)) setResult({ key, error: "We couldn’t load community games. Please try again." }); });
    }, query ? 200 : 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, page, key]);
  function search(q: string, nextPage = 1) {
    const next = new URLSearchParams(); if (q) next.set("q", q); if (nextPage > 1) next.set("page", String(nextPage));
    window.history.replaceState(null, "", `/games${next.size ? `?${next}` : ""}`);
  }
  const current = result?.key === key ? result : undefined;
  return <div className={s.page}><MarketHeader /><main>
    <section className={c.hero}><div><p className={s.eyebrow}>MADE BY THE BARK COMMUNITY</p><h1>Little worlds.<br /><span>Everyone’s invited.</span></h1><p>Find a world made by someone like you. Click in and play.</p><Link className={c.create} href="/editor">Make your own world →</Link></div><Image src="/images/games/hero.webp" alt="Byte exploring floating islands" width={600} height={400} preload /></section>
    <CollectionTabs />
    <section className={c.collection} aria-label="Community games"><div className={c.heading}><h2>Fresh from the community</h2><label className={s.search}><input aria-label="Search community games" type="search" placeholder="Search worlds or creators…" value={query} onChange={(e) => search(e.target.value)} /></label></div>
      {!current ? <p role="status">Finding worlds…</p> : current.error ? <div role="alert" className={c.empty}><h3>The collection is taking a moment</h3><p>{current.error}</p><Button onClick={() => setAttempt((n) => n + 1)}>Retry</Button></div> : <>
        <p role="status">{current.data!.count} {current.data!.count === 1 ? "world" : "worlds"} to explore</p>
        <div className={s.grid}>{current.data!.games.map((game, index) => <motion.article className={s.card} key={game.id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 5) * .04 }} whileHover={{ y: -5 }}><Link href={`/games/${game.id}`} className={s.cardLink} aria-label={`Play ${game.name}`}><div className={s.cardArt}><Image unoptimized src={game.cover_url || "/images/games/hero.webp"} alt={`${game.name} world cover`} width={640} height={400} onError={(event) => { event.currentTarget.src = "/images/games/hero.webp"; }} /><span className={s.cardPlay}>▶</span></div><div className={s.cardBody}><div><h3>{game.name}</h3><span className={s.creator}>by {game.creator}</span></div><span className={s.genre}>Community</span></div></Link></motion.article>)}</div>
        {!current.data!.games.length && <div className={c.empty}><Image src="/images/landing/byte-wave.png" alt="Byte waving" width={110} height={110} /><h3>{query ? "No worlds found. Yet!" : "Your world could be the first."}</h3><p>{query ? "Try another name or creator." : "Create something fun, then publish it for everyone to play."}</p><Link href={query ? "/games" : "/editor"}>{query ? "Show all games" : "Create a world →"}</Link></div>}
        {(page > 1 || current.data!.has_more) && <div className={c.paging}><Button variant="outline" disabled={page === 1} onClick={() => search(query, page - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={!current.data!.has_more} onClick={() => search(query, page + 1)}>Next</Button></div>}
      </>}
    </section></main><MarketFooter /></div>;
}
