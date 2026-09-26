import type { Game } from "./games";
export type Draft = { id: string; owner: string | null; revision: number | null; document: Game; dirty: boolean; updatedAt: number; collabBase?: Game };
const key = (owner: string | null, id: string) => `${owner ?? "guest"}:${id}`;
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("bark-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Local draft storage is blocked. Close other Bark tabs and retry."));
  });
}
async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("drafts", mode);
      const request = action(tx.objectStore("drafts"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Local draft storage was interrupted."));
    });
  } finally { db.close(); }
}
export const drafts = {
  get: (owner: string | null, id: string) => transact<Draft | undefined>("readonly", (store) => store.get(key(owner, id))),
  put: async (draft: Draft) => { await transact("readwrite", (store) => store.put(draft, key(draft.owner, draft.id))); },
  remove: async (owner: string | null, id: string) => { await transact("readwrite", (store) => store.delete(key(owner, id))); },
};
