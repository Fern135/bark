import type { ProjectDocument } from "@bark/engine";
import type { GameDocument } from "@bark/scripting";
import { api } from "./api";

export type Game = GameDocument<ProjectDocument>;
export type GameSummary = { id: string; name: string; revision: number; created_at: string; updated_at: string; owner: { user: string; name: string }; role: "owner" | "editor"; collaboration: boolean; publication?: { is_public: boolean } };
export type SavedGame = GameSummary & { document: Game };
const path = (id: string) => `/canvas/games/${encodeURIComponent(id)}/`;
const match = (revision: number) => ({ headers: { "If-Match": `"${revision}"` } });
export const gamesApi = {
  list: async (signal?: AbortSignal) => (await api.get<{ games: GameSummary[] }>("/canvas/games/", { signal })).data.games,
  get: async (id: string, signal?: AbortSignal) => (await api.get<SavedGame>(path(id), { signal })).data,
  create: async (id: string, document: Game, owner: string) => (await api.post<SavedGame>("/canvas/games/", { id, document }, { headers: { "X-Bark-Owner": owner } })).data,
  save: async (id: string, revision: number, document: Game, owner: string) => (await api.put<SavedGame>(path(id), document, { headers: { ...match(revision).headers, "X-Bark-Owner": owner } })).data,
  rename: async (game: GameSummary, name: string) => (await api.patch<SavedGame>(path(game.id), { name }, match(game.revision))).data,
  remove: async (game: GameSummary) => { await api.delete(path(game.id), match(game.revision)); },
};
