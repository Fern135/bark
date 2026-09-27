"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { accounts, errorMessage, type User } from "@/lib/accounts";
import { Button } from "@/components/ui/button";
import s from "./session.module.css";

type Session = { user: User | null; loading: boolean; error: string; refresh: () => Promise<void>; setUser: (user: User | null) => void };
const Context = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setValue] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const setUser = useCallback((value: User | null) => { generation.current++; setValue(value); setLoading(false); setError(""); }, []);
  const refresh = useCallback(() => {
    const request = ++generation.current;
    return accounts.me().then((value) => { if (request === generation.current) { setValue(value); setError(""); } })
      .catch((error) => { if (request === generation.current) { if (axios.isAxiosError(error) && error.response?.status === 401) { setValue(null); setError(""); } else setError(errorMessage(error)); } })
      .finally(() => { if (request === generation.current) setLoading(false); });
  }, []);
  useEffect(() => {
    void refresh();
    const focus = () => { void refresh(); };
    const expired = () => setUser(null);
    window.addEventListener("focus", focus);
    window.addEventListener("bark:session-expired", expired);
    return () => { window.removeEventListener("focus", focus); window.removeEventListener("bark:session-expired", expired); };
  }, [refresh, setUser]);
  return <Context.Provider value={{ user, loading, error, refresh, setUser }}>{children}</Context.Provider>;
}
export function useSession() {
  const session = useContext(Context);
  if (!session) throw new Error("SessionProvider is missing");
  return session;
}
export function AccountLinks({ joinClassName }: { joinClassName?: string }) {
  const { user, loading, setUser } = useSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try { await accounts.logout(); setUser(null); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  if (loading) return <span role="status">Checking account…</span>;
  return <>{user ? <><Link href="/my-games" data-account-link="games">My Games</Link><span className={s.name} title={user.username}>{user.username}</span><Button size="small" variant="subtle" loading={busy} onClick={() => void logout()}>Log out</Button></> : <><Link href="/login">Log in</Link><Link className={joinClassName} href="/signup">Join Bark</Link></>}{error && <span role="alert">{error}</span>}</>;
}
