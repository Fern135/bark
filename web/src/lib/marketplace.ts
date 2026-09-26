import { api } from "./api";
import type { Game } from "./games";

export type Publication = { is_public: boolean; published_at?: string | null };
export type PublicGame = { id: string; name: string; creator: string; revision: number; published_at: string; updated_at: string; cover_url: string | null };
export type PublicGameDetail = PublicGame & { document: Game };
export type PublicGamePage = { games: PublicGame[]; count: number; page: number; has_more: boolean };
const path = (id: string) => `/marketplace/games/${encodeURIComponent(id)}/`;
export const marketplaceApi = {
  list: async (q: string, page: number, signal?: AbortSignal) => (await api.get<PublicGamePage>("/marketplace/games/", { params: { q, page }, signal })).data,
  get: async (id: string, signal?: AbortSignal) => (await api.get<PublicGameDetail>(path(id), { signal })).data,
  publish: async (id: string, is_public: boolean, owner: string) => (await api.put<Publication>(`${path(id)}publication/`, { is_public }, { headers: { "X-Bark-Owner": owner } })).data,
  cover: async (id: string, revision: number, png: string) => { await api.put(`${path(id)}cover/`, { revision, png }); },
};

export async function captureCover(id: string, revision: number, document: Game) {
  const { createRuntime } = await import("@bark/engine");
  const canvas = window.document.createElement("canvas");
  canvas.width = 640; canvas.height = 400;
  canvas.style.cssText = "position:fixed;left:-10000px;top:0;width:640px;height:400px;pointer-events:none";
  window.document.body.append(canvas);
  try {
    const runtime = await createRuntime({ canvas, havokWasmUrl: "/runtime/HavokPhysics.wasm" });
    try {
      await runtime.load(document.project);
      runtime.cameras.frame();
      for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await marketplaceApi.cover(id, revision, canvas.toDataURL("image/png").split(",")[1]);
    } finally { runtime.dispose(); }
  } finally { canvas.remove(); }
}
