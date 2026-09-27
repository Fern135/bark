import { api } from "./api";
import type { Member } from "./collaboration";
import type { GameSummary } from "./games";
export type Workspace = { enabled: boolean; code: string | null; members: Member[] };
const path = (id: string) => `/canvas/games/${encodeURIComponent(id)}/workspace/`;
export const workspaces = {
  get: async (id: string) => (await api.get<Workspace>(path(id))).data,
  invite: async (id: string, revision: number) => (await api.post<Workspace>(path(id), {}, { headers: { "If-Match": `"${revision}"` } })).data,
  disable: async (id: string) => (await api.delete<Workspace>(path(id))).data,
  join: async (code: string) => (await api.post<GameSummary>("/canvas/workspaces/join/", { code })).data,
  remove: async (id: string, user: string) => { await api.delete(`/canvas/games/${encodeURIComponent(id)}/members/${encodeURIComponent(user)}/`); },
};
