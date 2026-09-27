import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { nunito } from "@/lib/fonts";
import { Icon } from "@/components/ui/icon";
import { findGame, games } from "@/components/marketplace/catalog";
import { GameCard } from "@/components/marketplace/game-card";
import { GameCanvas } from "@/components/marketplace/player";
import { MarketFooter, MarketHeader } from "@/components/marketplace/shell";
import s from "@/components/marketplace/marketplace.module.css";
import { cache } from "react";
import axios from "axios";
import { marketplaceApi } from "@/lib/marketplace";
import { CommunityGame, CommunityUnavailable } from "@/components/marketplace/community-game";

export const dynamic = "force-dynamic";
const isPublicId = (slug: string) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(slug);
const publicGame = cache((id: string) => marketplaceApi.get(id));
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const slug = (await params).slug;
  if (isPublicId(slug)) {
    const game = await publicGame(slug).catch(() => null);
    return { title: game ? `${game.name} — Play on Bark` : "Play a community world — Bark" };
  }
  const game = findGame(slug);
  return {
    title: game ? `${game.title} — Play on Bark` : "World not found — Bark",
    description: game?.description,
  };
}
export default async function GamePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const slug = (await params).slug;
  if (isPublicId(slug)) {
    let game;
    try { game = await publicGame(slug); }
    catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) notFound();
      return <CommunityUnavailable />;
    }
    return <CommunityGame game={game} />;
  }
  const game = findGame(slug);
  if (!game) notFound();
  const related = games
    .filter((entry) => entry.slug !== game.slug)
    .sort(
      (a, b) =>
        Number(b.category === game.category) -
        Number(a.category === game.category),
    )
    .slice(0, 3);
  return (
    <div className={nunito.className}>
      <div className={s.page}>
        <MarketHeader />
        <main>
          <Link href="/games?source=demos" className={s.breadcrumb}>
            <Icon name="arrow" size={16} />
            Back to exploring
          </Link>
          <div className={s.detailGrid}>
            <div>
              <GameCanvas key={game.slug} game={game} />
              <div className={s.titleRow}>
                <div>
                  <h1>{game.title}</h1>
                  <span className={s.creator}>
                    <span className={s.creatorBadge}>b</span>by {game.creator} ·
                    A Bark demo world
                  </span>
                </div>
                <span
                  className={s.genre}
                  style={{ backgroundColor: game.color }}
                >
                  {game.category}
                </span>
              </div>
              <p className={s.detailText}>{game.description}</p>
            </div>
            <aside className={s.aside}>
              <p className={s.eyebrow}>A LITTLE FIELD GUIDE</p>
              <h2>How to play</h2>
              <p>{game.objective}</p>
              <div className={s.keys}>
                <div>
                  <span>Move</span>
                  <kbd>W A S D / ↑ ↓ ← →</kbd>
                </div>
                <div>
                  <span>Jump</span>
                  <kbd>Space</kbd>
                </div>
                <div>
                  <span>Focus the game</span>
                  <kbd>Click canvas</kbd>
                </div>
              </div>
              <p className={s.touchNote}>
                Bring a keyboard for this adventure. You can explore the
                collection on any device.
              </p>
              <h2>Curious how it works?</h2>
              <p>
                Peek inside, change a few things, and make this little world
                your own.
              </p>
              <Link className={s.editorLink} href={`/editor?game=${game.slug}`}>
                <Icon name="code" size={18} />
                Open in editor
                <Icon name="arrow" size={16} />
              </Link>
              <small>
                Sign in to autosave your changes to My Games.
                <br />
                You can also export your world as JSON.
              </small>
              <figure className={s.screenshot}>
                <Image
                  src={`/games/screenshots/${game.slug}.png`}
                  alt={`Actual ${game.title} gameplay`}
                  width={800}
                  height={500}
                  sizes="(max-width: 1000px) 90vw, 260px"
                />
                <figcaption>A peek inside · actual gameplay</figcaption>
              </figure>
            </aside>
          </div>
          <h2 className={s.relatedTitle}>One more adventure?</h2>
          <div className={s.grid}>
            {related.map((entry, index) => (
              <GameCard game={entry} index={index} key={entry.slug} />
            ))}
          </div>
        </main>
        <MarketFooter />
      </div>
    </div>
  );
}
