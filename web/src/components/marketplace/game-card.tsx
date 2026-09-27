"use client";
import Image from "next/image";
import Link from "next/link";
import { motion } from "motion/react";
import { Icon } from "@/components/ui/icon";
import { gameCover, type MarketplaceGame } from "./catalog";
import s from "./marketplace.module.css";

export function GameCard({
  game,
  index = 0,
}: {
  game: MarketplaceGame;
  index?: number;
}) {
  return (
    <motion.article
      layout="position"
      className={s.card}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{
        type: "spring",
        stiffness: 260,
        damping: 28,
        opacity: { duration: 0.18 },
        delay: Math.min(index, 5) * 0.045,
      }}
      whileHover={{ y: -6 }}
    >
      <Link
        href={`/games/${game.slug}`}
        aria-label={`Play ${game.title}`}
        className={s.cardLink}
      >
        <div className={s.cardArt} style={{ backgroundColor: game.color }}>
          <Image
            src={gameCover(game.slug)}
            alt={`${game.title} cover illustration with Byte`}
            width={768}
            height={512}
            sizes="(max-width: 600px) 95vw, (max-width: 1000px) 48vw, 32vw"
          />
          <span className={s.cardPlay}>
            <Icon name="play" size={24} />
          </span>
          {game.slug === "woodland-wander" && (
            <span className={s.pick}>
              <Icon name="spark" size={13} />
              Byte’s pick
            </span>
          )}
        </div>
        <div className={s.cardBody}>
          <div>
            <h3>{game.title}</h3>
            <span className={s.creator}>
              <span className={s.creatorBadge}>b</span>by {game.creator}
            </span>
          </div>
          <span className={s.genre} style={{ backgroundColor: game.color }}>
            {game.category}
          </span>
        </div>
      </Link>
    </motion.article>
  );
}
