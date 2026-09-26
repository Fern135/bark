"use client";
import Link from "next/link";
import type { PublicGameDetail } from "@/lib/marketplace";
import { MarketHeader, MarketFooter } from "./shell";
import { IsolatedPlayer } from "./isolated-player";
import { CopyGameLink } from "./publish-control";
import { nunito } from "@/lib/fonts";
import s from "./marketplace.module.css";
import c from "./community.module.css";

export function CommunityGame({ game }: { game: PublicGameDetail }) {
  const bindings = game.document.project.input;
  return <div className={`${s.page} ${nunito.className}`}><MarketHeader /><main><Link href="/games" className={s.breadcrumb}>← Back to exploring</Link><div className={c.detailHeading}><div><p className={s.eyebrow}>A COMMUNITY WORLD</p><h1>{game.name}</h1><p>by {game.creator}</p></div><CopyGameLink id={game.id} /></div><IsolatedPlayer game={game} /><section className={c.instructions}><h2>How to play</h2><p>Click Play game, then click the game to focus your keyboard.</p><div className={c.bindings}>{Object.entries(bindings ?? {}).map(([action, keys]) => <div key={action}><span>{action}</span><kbd>{Array.isArray(keys) ? keys.join(" / ") : String(keys)}</kbd></div>)}</div><p>Bring a keyboard for this adventure. Reload this page to play the latest saved version.</p></section></main><MarketFooter /></div>;
}

export function CommunityUnavailable() {
  return <div className={s.page}><MarketHeader /><main className={c.empty}><h1>This world is taking a moment</h1><p role="alert">We couldn’t load this game. Please try again.</p><button onClick={() => location.reload()}>Retry</button><p><Link href="/games">Back to exploring</Link></p></main></div>;
}
