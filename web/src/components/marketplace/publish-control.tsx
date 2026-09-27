"use client";
import { useRef, useState } from "react";
import Image from "next/image";
import * as Popover from "@radix-ui/react-popover";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useSession } from "@/components/auth/session";
import { errorMessage } from "@/lib/accounts";
import { gamesApi, type SavedGame } from "@/lib/games";
import { captureCover, marketplaceApi } from "@/lib/marketplace";
import s from "./publishing.module.css";

export function CopyGameLink({ id }: { id: string }) {
  const [message, setMessage] = useState("");
  const [fallback, setFallback] = useState("");
  return <><Button variant="outline" onClick={async () => {
    const link = `${location.origin}/games/${id}`;
    try { await navigator.clipboard.writeText(link); setMessage("Link copied!"); setFallback(""); }
    catch { setMessage("Copy this link:"); setFallback(link); }
  }}>Copy link</Button><span role="status" className={s.copyStatus}>{message}</span>{fallback && <input aria-label="Game link" readOnly value={fallback} onFocus={(event) => event.target.select()} style={{ width: "100%", minWidth: 0 }} />}</>;
}

export function PublishControl({ id, title, published = false, role = "owner", disabled = false, beforePublish, signIn, onChange }: {
  id: string; title: string; published?: boolean; role?: "owner" | "editor"; disabled?: boolean;
  beforePublish?: () => Promise<SavedGame | undefined>; signIn?: () => Promise<void>; onChange?: (value: boolean) => void;
}) {
  const { user } = useSession();
  const [isPublic, setPublic] = useState(published);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const working = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  async function change(value: boolean) {
    if (working.current) return;
    if (!user) { await signIn?.(); return; }
    working.current = true; setBusy(true); setError("");
    const owner = user.user_id;
    try {
      const saved = value ? await (beforePublish ? beforePublish() : gamesApi.get(id)) : undefined;
      if (value && !saved) throw new Error("Save your changes before publishing. Use the save recovery actions and try again.");
      const state = await marketplaceApi.publish(id, value, owner);
      setPublic(state.is_public); onChange?.(state.is_public); setOpen(true);
      if (saved) void captureCover(id, saved.revision, saved.document).catch(() => { /* The listing uses Bark artwork when capture is unavailable. */ });
    } catch (cause) { setError(errorMessage(cause)); setOpen(true); }
    finally { working.current = false; setBusy(false); }
  }
  if (role !== "owner") return <span className={s.visibility}>{isPublic ? "Public · Saved changes are public" : "Private · Owner can publish"}</span>;
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Anchor asChild><span className={s.trigger}><Button ref={trigger} variant="accent" loading={busy} disabled={disabled} leadingIcon={<Icon name="upload" />} onClick={() => isPublic ? setOpen(!open) : void change(true)}>{busy ? "Publishing…" : isPublic ? "Published" : "Publish"}</Button>{isPublic && <small>Saved changes are public</small>}</span></Popover.Anchor>
    <AnimatePresence>{open && <Popover.Portal forceMount><Popover.Content asChild forceMount sideOffset={12} collisionPadding={16} onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}>
      <motion.section className={s.panel} aria-label="Publishing" initial={{ opacity: 0, y: -8, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: .97 }} transition={{ type: "spring", stiffness: 380, damping: 30 }}>
        <Popover.Close className={s.close} aria-label="Close publishing panel">×</Popover.Close>
        <Image src="/images/landing/byte-wave.png" alt="Byte waving" width={96} height={96} />
        <h2>{isPublic ? "Your world is public!" : "Your world is private"}</h2>
        <p className={s.world}>{title}</p>
        <p>{isPublic ? "Anyone can find and play your world. Saved changes are public." : "Your world is only available to you and your collaborators."}</p>
        {error && <p role="alert" className={s.error}>{error}</p>}
        {isPublic ? <><div className={s.actions}><a className={s.view} href={`/games/${id}`} target="_blank" rel="noopener noreferrer">View game ↗</a><CopyGameLink id={id} /></div><Button variant="subtle" disabled={busy} onClick={() => void change(false)}>Unpublish</Button></> : <Button variant="accent" disabled={busy || disabled} onClick={() => void change(true)}>{error ? "Retry publish" : "Publish"}</Button>}
      </motion.section>
    </Popover.Content></Popover.Portal>}</AnimatePresence>
  </Popover.Root>;
}
