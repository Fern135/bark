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

export function generateStaticParams() {
  return games.map(({ slug }) => ({ slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const game = findGame((await params).slug);
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
  const game = findGame((await params).slug);
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
          <Link href="/games" className={s.breadcrumb}>
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
                Your changes stay in your session.
                <br />
                Export your world to keep it.
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
