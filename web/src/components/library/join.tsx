"use client";
import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/components/auth/session";
import { MarketHeader } from "@/components/marketplace/shell";
import { Button } from "@/components/ui/button";
import { workspaces } from "@/lib/workspaces";
import { errorMessage } from "@/lib/accounts";
import s from "./library.module.css";
function Form() {
  const params = useSearchParams(), router = useRouter();
  const { user, loading } = useSession();
  const [code, setCode] = useState(params.get("code") ?? ""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  return <section className={s.card} style={{ maxWidth: 480, margin: "40px auto" }}><h1>Join a workspace</h1><p>Build a world together. Enter the invite code your workspace owner shared with you.</p><form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(""); try { const game = await workspaces.join(code.trim()); router.push(`/editor?id=${game.id}`); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}><label>Invite code<input aria-label="Invite code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={48} required style={{ display: "block", width: "100%", padding: 12, margin: "12px 0", border: "1px solid #c2d4e8", borderRadius: 12 }}/></label>{loading ? <p>Checking account…</p> : user ? <Button type="submit" disabled={busy}>{busy ? "Joining…" : "Join workspace"}</Button> : <Link href={`/login?next=${encodeURIComponent(`/join?code=${code}`)}`}>Sign in to join</Link>}</form>{error && <p role="alert">{error}</p>}<p>You’ll join as an editor. The owner manages workspace access.</p></section>;
}
export function JoinWorkspace() { return <div className={s.page}><MarketHeader/><main className={s.main}><Suspense fallback={<p>Loading invite…</p>}><Form/></Suspense></main></div>; }
