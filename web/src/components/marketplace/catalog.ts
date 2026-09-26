export const genres = [
  "All games",
  "Adventure",
  "Platformer",
  "Puzzle",
  "Racing",
] as const;
export type Genre = (typeof genres)[number];
export interface MarketplaceGame {
  slug: string;
  title: string;
  category: Exclude<Genre, "All games">;
  description: string;
  objective: string;
  color: string;
  date: string;
  creator: string;
}
export const games: MarketplaceGame[] = [
  {
    slug: "woodland-wander",
    title: "Woodland Wander",
    category: "Adventure",
    description:
      "Take the scenic route. A little forest, a winding trail, and five golden gems waiting to be found.",
    objective: "Explore the woodland and collect all five golden gems.",
    color: "#e6f4df",
    date: "2026-09-21",
    creator: "Bark",
  },
  {
    slug: "cloud-hop",
    title: "Cloud Hop",
    category: "Platformer",
    description:
      "Head in the clouds? Perfect. Hop between floating islands and follow a trail of sky crystals.",
    objective:
      "Jump across the gaps and collect the four sky crystals. Falling returns you to the start.",
    color: "#e4f1ff",
    date: "2026-09-22",
    creator: "Bark",
  },
  {
    slug: "crystal-maze",
    title: "Crystal Maze",
    category: "Puzzle",
    description:
      "A sparkling little labyrinth. Find a way around its violet walls and uncover every hidden crystal.",
    objective: "Find all three crystals by navigating around the maze walls.",
    color: "#eee6ff",
    date: "2026-09-23",
    creator: "Bark",
  },
  {
    slug: "moon-bounce",
    title: "Moon Bounce",
    category: "Platformer",
    description:
      "One small hop. One very big adventure. Bounce between moon rocks in a gentle low-gravity world.",
    objective: "Use longer, low-gravity jumps to reach all four moon crystals.",
    color: "#ebeaff",
    date: "2026-09-24",
    creator: "Bark",
  },
  {
    slug: "rainbow-rally",
    title: "Rainbow Rally",
    category: "Racing",
    description:
      "On your marks, get set, go explore. Race on foot through a colorful course, one checkpoint at a time.",
    objective:
      "Run through the five glowing checkpoints in order. Restart to beat your time.",
    color: "#ffedda",
    date: "2026-09-25",
    creator: "Bark",
  },
  {
    slug: "garden-quest",
    title: "Garden Quest",
    category: "Adventure",
    description:
      "Good things grow here. Peek behind flowers and hedges to discover a garden full of tiny treasures.",
    objective: "Search the garden for all five hidden golden treasures.",
    color: "#fff0e6",
    date: "2026-09-26",
    creator: "Bark",
  },
];
export const findGame = (slug: string) =>
  games.find((game) => game.slug === slug);
export const gameFile = (slug: string) => `/games/data/${slug}.json`;
export const gameCover = (slug: string) => `/images/games/${slug}.webp`;
