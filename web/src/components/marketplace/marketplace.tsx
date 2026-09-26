"use client";
import { useRef } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion, useInView } from "motion/react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { games, genres } from "./catalog";
import { GameCard } from "./game-card";
import { MarketFooter, MarketHeader } from "./shell";
import s from "./marketplace.module.css";

export default function Marketplace() {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.get("q") ?? "";
  const category =
    genres.find((genre) => genre === params.get("category")) ?? "All games";
  const sort = params.get("sort") === "newest" ? "newest" : "featured";
  const hero = useRef<HTMLElement>(null);
  const visible = useInView(hero);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "All games" || value === "featured")
      next.delete(key);
    else next.set(key, value);
    window.history.replaceState(
      null,
      "",
      `/games${next.size ? `?${next}` : ""}`,
    );
  }
  const filtered = games.filter(
    (game) =>
      (category === "All games" || game.category === category) &&
      `${game.title} ${game.description} ${game.creator}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  if (sort === "newest") filtered.sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className={s.page}>
      <a href="#games" className={s.skip}>
        Skip to games
      </a>
      <MarketHeader />
      <main>
        <motion.section
          ref={hero}
          className={s.hero}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
        >
          <motion.div
            className={s.heroArt}
            animate={visible ? { y: [0, -7, 0] } : { y: 0 }}
            transition={{
              duration: 6,
              ease: "easeInOut",
              repeat: visible ? Infinity : 0,
            }}
          >
            <Image
              src="/images/games/hero.webp"
              alt="Byte leaping between floating islands and sparkling crystals"
              fill
              sizes="(max-width: 600px) 100vw, 70vw"
              preload
            />
          </motion.div>
          <div className={s.heroCopy}>
            <p className={s.eyebrow}>
              MADE BY IMAGINATION <Icon name="spark" size={15} />
            </p>
            <h1>
              Your next adventure
              <br />
              starts <span>here.</span>
            </h1>
            <p className={s.heroDescription}>
              Little worlds. Big possibilities.
              <br />
              Find something fun. See what happens.
            </p>
            <Button
              variant="positive"
              onClick={() =>
                router.push(
                  `/games/${games[Math.floor(Math.random() * games.length)].slug}`,
                )
              }
              leadingIcon={<Icon name="spark" />}
              trailingIcon={<Icon name="arrow" />}
            >
              Surprise me
            </Button>
            <span className={s.heroNote}>
              A few little worlds to get you started
            </span>
          </div>
          <motion.span
            aria-hidden="true"
            className={s.floatingStar}
            animate={
              visible
                ? { rotate: [-9, 12, -9], scale: [1, 1.12, 1] }
                : { rotate: 0 }
            }
            transition={{ duration: 5, repeat: visible ? Infinity : 0 }}
          >
            ✦
          </motion.span>
        </motion.section>
        <section
          id="games"
          tabIndex={-1}
          className={s.collection}
          aria-labelledby="collection-title"
        >
          <div className={s.filters}>
            <label className={s.search}>
              <Icon name="search" />
              <input
                type="search"
                aria-label="Search games"
                placeholder="Find your kind of adventure…"
                value={query}
                onChange={(event) => filter("q", event.target.value)}
              />
              {query && (
                <button
                  aria-label="Clear search"
                  onClick={() => filter("q", "")}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </label>
            <LayoutGroup id="game-genres">
              <div className={s.categories} aria-label="Game categories">
                {genres.map((genre) => (
                  <button
                    key={genre}
                    aria-pressed={category === genre}
                    onClick={() => filter("category", genre)}
                  >
                    {category === genre && (
                      <motion.span
                        className={s.categoryActive}
                        layoutId="selected-genre"
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 32,
                        }}
                      />
                    )}
                    <span>{genre}</span>
                  </button>
                ))}
              </div>
            </LayoutGroup>
          </div>
          <div className={s.sectionHeading}>
            <div>
              <p className={s.eyebrow}>THE BARK COLLECTION</p>
              <h2 id="collection-title">
                Pick a world. Press play<span>.</span>
              </h2>
            </div>
            <label className={s.sort}>
              Sort by
              <select
                aria-label="Sort games"
                value={sort}
                onChange={(event) => filter("sort", event.target.value)}
              >
                <option value="featured">Featured</option>
                <option value="newest">Newest</option>
              </select>
            </label>
          </div>
          <p className={s.resultCount} role="status">
            {filtered.length} {filtered.length === 1 ? "world" : "worlds"} to
            explore{query && ` for “${query}”`}
          </p>
          <motion.div layout className={s.grid}>
            <AnimatePresence mode="popLayout">
              {filtered.map((game, index) => (
                <GameCard key={game.slug} game={game} index={index} />
              ))}
            </AnimatePresence>
          </motion.div>
          {!filtered.length && (
            <motion.div
              className={s.empty}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Image
                src="/images/landing/byte-wave.png"
                alt="Byte waving"
                width={115}
                height={115}
              />
              <h3>No worlds found. Yet!</h3>
              <p>Try a different word or give another category a go.</p>
              <Button
                variant="outline"
                onClick={() => window.history.replaceState(null, "", "/games")}
              >
                Show all games
              </Button>
            </motion.div>
          )}
        </section>
      </main>
      <MarketFooter />
    </div>
  );
}
