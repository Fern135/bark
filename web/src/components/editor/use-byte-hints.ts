import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import axios from "axios";
import { useSession } from "@/components/auth/session";
import { api } from "@/lib/api";
import { ByteHints, ByteReviewError, type ByteRequest, type ByteResponse } from "@/lib/byte-hints";
import { buildByteSnapshot, byteKey } from "./byte-snapshot";
import type { Game } from "./use-editor";
import type { Diagnostic } from "@bark/scripting";

async function review(body: ByteRequest, signal: AbortSignal): Promise<ByteResponse> {
  try { return (await api.post<ByteResponse>("/coach/review/", body, { signal, timeout: 25_000 })).data; }
  catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) window.dispatchEvent(new Event("bark:session-expired"));
      const raw = error.response?.headers["retry-after"];
      const seconds = Number(raw);
      throw new ByteReviewError(raw && Number.isFinite(seconds) ? seconds * 1000 : raw ? Math.max(0, Date.parse(raw) - Date.now()) || 120_000 : 120_000);
    }
    throw error;
  }
}

export function useByteHints(game: Game, projectId: string, localRevision: number, active: boolean, revision: number, scriptId: string | null = null, diagnostic?: Diagnostic) {
  const { user } = useSession();
  const [controller] = useState(() => new ByteHints(review));
  const [preferences, setPreferences] = useState<Record<string, boolean>>({});
  // Local diagnostics arrive after the edit. Update the snapshot without
  // cancelling the review already scheduled for that same code revision.
  const key = useMemo(() => byteKey(game, scriptId), [game, scriptId]);
  const userId = user?.user_id;
  const enabled = !!userId && preferences[userId] !== false;
  const suggestion = useSyncExternalStore(controller.subscribe, controller.getSnapshot, () => null);
  const status = useSyncExternalStore(controller.subscribe, controller.getStatus, () => "idle" as const);
  const preferenceKey = userId ? `bark:byte-hints:${userId}` : null;
  // Read browser preferences before scheduling any reviews for this account.
  useEffect(() => {
    if (!preferenceKey || !userId) return;
    let value = true;
    try { value = localStorage.getItem(preferenceKey) !== "off"; } catch { /* Browser storage can be disabled. */ }
    queueMicrotask(() => setPreferences((old) => ({ ...old, [userId]: value })));
  }, [preferenceKey, userId]);
  useEffect(() => {
controller.update({ identity: JSON.stringify([userId ?? "guest", projectId, revision, scriptId]), key, localRevision, enabled: enabled && !!userId && preferences[userId] !== undefined, active, snapshot: () => {
 const snapshot = buildByteSnapshot(game, scriptId);
 if (snapshot && diagnostic) snapshot.diagnostics = [diagnostic, ...snapshot.diagnostics];
  return snapshot;
 } });
  }, [controller, userId, projectId, revision, scriptId, key, localRevision, enabled, active, game, diagnostic]);
  useEffect(() => {
    let pointer = false, composing = false;
    const refresh = () => controller.activity(pointer || composing || document.hidden || !!document.querySelector('[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper]'));
    const down = () => { pointer = true; refresh(); };
    const up = () => { pointer = false; refresh(); };
    const start = () => { composing = true; refresh(); };
    const end = () => { composing = false; refresh(); };
    const blur = () => { pointer = false; composing = false; controller.activity(true); };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    document.addEventListener("compositionstart", start, true);
    document.addEventListener("compositionend", end, true);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", refresh);
    let modal = false;
    const observer = new MutationObserver(() => {
      const next = !!document.querySelector('[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper]');
      if (modal !== next) { modal = next; refresh(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    refresh();
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      document.removeEventListener("compositionstart", start, true);
      document.removeEventListener("compositionend", end, true);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", refresh);
      controller.dispose();
    };
  }, [controller]);
  function toggle(value: boolean) {
    if (!userId || !preferenceKey) return;
    if (!value) controller.dispose();
    setPreferences((old) => ({ ...old, [userId]: value }));
    try { localStorage.setItem(preferenceKey, value ? "on" : "off"); } catch { /* Session choice still works. */ }
  }
  return { enabled, signedIn: !!userId, suggestion: enabled && active ? suggestion : null, status, request: controller.requestNow, dismiss: controller.dismiss, toggle };
}
