"use client";
import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/accounts";
import { accountRecoveryEnabled } from "@/lib/features";
import { Button } from "@/components/ui/button";
import { PasswordInput, TextInput } from "@/components/ui/fields";
import s from "./auth.module.css";

type Mode = "forgot-password" | "forgot-username" | "reset-password";
type Email = { subject: string; body: string; sent_at: string };
function RecoveryForm({ mode }: { mode: Mode }) {
  const token = useSearchParams().get("token");
  const reset = mode === "reset-password";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Email[] | null>(null);
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage(""); setMessages(null);
    try {
      const { data } = await api.post(`/auth/${mode}/`, reset ? { token, password } : { email });
      setMessage(data.message); setDone(reset);
      if (!reset) {
        try { setMessages((await api.get<{ messages: Email[] }>("/auth/demo-inbox/", { params: { email } })).data.messages); }
        catch (error) { if (!(axios.isAxiosError(error) && error.response?.status === 404)) setMessage(`${data.message} Demo inbox unavailable; try again later.`); }
      }
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section className={s.formInner} style={{ maxWidth: 560, margin: "auto", padding: 32 }}>
    <h1>{reset ? "Choose a new password" : mode === "forgot-username" ? "Find your username" : "Reset your password"}</h1>
    <form onSubmit={submit} className={s.form}>
      {reset ? <PasswordInput label="New password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /> : <TextInput label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
      <Button type="submit" loading={busy} disabled={done || (reset && !token)}>{reset ? "Update password" : "Send instructions"}</Button>
    </form>
    {reset && !token && <p role="alert">This reset link is missing its token. Request a new link.</p>}
    <p role="status">{message}</p>
    {messages !== null && <aside aria-label="Demo inbox"><h2>Demo inbox</h2><p>Demo only: these messages were saved here instead of emailed.</p>{messages.length === 0 ? <p>No messages.</p> : messages.map((mail, i) => <article key={`${mail.sent_at}-${i}`}><strong>{mail.subject}</strong><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{mail.body.split(/(https?:\/\/\S+)/g).map((part, j) => {
      if (!part.startsWith("http")) return part;
      const url = new URL(part);
      return url.origin === window.location.origin && url.pathname === "/reset-password" ? <Link key={j} href={url.pathname + url.search}>Choose a new password</Link> : part;
    })}</p></article>)}</aside>}
    <Link href="/login">Back to login</Link>
  </section>;
}
export function Recovery({ mode }: { mode: Mode }) {
  if (!accountRecoveryEnabled) return <section className={s.formInner}>
    <h1>Account recovery is not available yet</h1>
    <p>Password resets and username reminders are not enabled for this beta.</p>
    <Link href="/login">Back to login</Link>
  </section>;
  return <Suspense fallback={<p>Opening recovery…</p>}><RecoveryForm mode={mode} /></Suspense>;
}
