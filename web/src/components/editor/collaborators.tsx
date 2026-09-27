"use client";
import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/auth/session";
import { workspaces, type Workspace } from "@/lib/workspaces";
import { gamesApi } from "@/lib/games";
import { errorMessage } from "@/lib/accounts";
import type { useEditor } from "./use-editor";
import s from "./collaborators.module.css";

export function Collaborators({ editor }: { editor: Omit<ReturnType<typeof useEditor>, "canvas" | "session"> }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false), [invite, setInvite] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const members = editor.shared ? editor.live.members : user ? [{ user: user.user_id, name: user.username, role: "owner" as const }] : [];
  const identity = () => editor.cloud.identity();
  useEffect(() => {
    const id = new URL(location.href).searchParams.get("id");
    if (editor.shared && editor.role === "owner" && id && new URL(location.href).searchParams.get("invite") === "1") {
      void workspaces.get(id).then((result) => { setWorkspace(result); setInvite(true); }).catch((e) => setMessage(errorMessage(e)));
      const url = new URL(location.href); url.searchParams.delete("invite"); history.replaceState(null, "", url);
    }
  }, [editor.shared, editor.role]);
  async function action(fn: () => Promise<void>) { setBusy(true); setMessage(""); try { await fn(); } catch (e) { setMessage(errorMessage(e)); } finally { setBusy(false); } }
  async function showInvite() {
    if (!user) { await editor.cloud.signIn(); return; }
    await action(async () => {
      if (!(await editor.cloud.flush())) throw new Error("Save your pending edits before inviting someone.");
      const seed = identity(); if (!seed) return;
      const saved = await gamesApi.get(seed.id);
      const result = saved.collaboration ? await workspaces.get(seed.id) : await workspaces.invite(seed.id, saved.revision);
      if (!saved.collaboration) { window.dispatchEvent(new Event("bark:leave-editor")); window.history.replaceState(null, "", `/editor?id=${seed.id}&invite=1`); location.reload(); return; }
      setWorkspace(result); setInvite(true); setOpen(false);
    });
  }
  async function changeCode(disable = false) {
    await action(async () => { const seed = identity(); if (!seed) return; setWorkspace(disable ? await workspaces.disable(seed.id) : await workspaces.invite(seed.id, seed.revision ?? 0)); });
  }
  async function copy(value: string) { await action(async () => { await navigator.clipboard.writeText(value); setMessage("Copied!"); }); }
  return <>
    <Popover.Root open={open} onOpenChange={(value) => { setOpen(value); setMessage(""); }}>
      <Popover.Trigger asChild><button className={s.trigger} aria-label="Collaborators"><span className={s.bubbles}>{members.slice(0, 3).map((m, i) => <span key={m.user} style={{ background: ["#ddebff", "#ece0ff", "#ffe4ce"][i] }}>{m.name.slice(0, 1).toUpperCase()}</span>)}</span><span>{members.length > 1 ? `${members.length} collaborators` : "Collaborate"}</span></button></Popover.Trigger>
      <Popover.Portal><Popover.Content className={s.menu} align="end" sideOffset={12} collisionPadding={12}>
        <div className={s.heading}><h2>Build together</h2><Popover.Close aria-label="Close collaborators">×</Popover.Close></div>
        <p>A little world, built together. Invite friends to your workshop.</p>
        <ul className={s.roster}>{members.map((member) => {
          const peers = editor.live.peers.filter((p) => p.user === member.user);
          const editing = peers.find((p) => p.resource)?.resource;
          return <li key={member.user}><span className={s.avatar}>{member.name.slice(0, 1).toUpperCase()}</span><div><strong>{member.name}{member.user === user?.user_id ? " (you)" : ""}</strong><small>{member.role === "owner" ? "Owner" : "Editor"} · {editing ? `Editing ${editing.startsWith("entity:") ? "an object" : editing.startsWith("block:") ? "blocks" : editing === "script" ? "Python" : "the world"}` : peers.length || (!editor.shared && member.user === user?.user_id) ? "Online" : "Offline"}</small></div>{editor.role === "owner" && member.role !== "owner" && <button disabled={busy} onClick={() => { if (confirm(`Remove ${member.name} from this workspace?`)) void action(async () => { await workspaces.remove(identity()!.id, member.user); }); }}>Remove</button>}</li>;
        })}</ul>
        {editor.role === "owner" ? <Button disabled={busy} onClick={() => void showInvite()}>Invite collaborators</Button> : <p>Only the owner manages invitations.</p>}
        {editor.shared && <Button variant="outline" disabled={busy} onClick={() => void action(async () => { await editor.cloud.copy(); })}>Save a personal copy</Button>}
        {message && <p role="status">{message}</p>}
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    <Dialog.Root open={invite} onOpenChange={setInvite}><Dialog.Portal><Dialog.Overlay className={s.overlay}/><Dialog.Content className={s.dialog}>
      <div className={s.heading}><Dialog.Title>Invite to your workspace</Dialog.Title><Dialog.Close aria-label="Close invite">×</Dialog.Close></div>
      <Dialog.Description>Anyone with this code can sign in and join as an editor. You remain the owner.</Dialog.Description>
      {workspace?.code ? <><label className={s.code}>Invite code<input readOnly value={workspace.code} onFocus={(e) => e.target.select()} /></label><div className={s.actions}><Button disabled={busy} onClick={() => void copy(workspace.code!)}>Copy code</Button><Button variant="outline" disabled={busy} onClick={() => void copy(`${location.origin}/join?code=${encodeURIComponent(workspace.code!)}`)}>Copy invite link</Button></div></> : <p>Invitations are disabled.</p>}
      <div className={s.actions}><Button variant="subtle" disabled={busy} onClick={() => { if (!workspace?.code || confirm("Reset the code? Existing members keep access.")) void changeCode(); }}>{workspace?.code ? "Reset code" : "Enable invitations"}</Button>{workspace?.code && <Button variant="subtle" disabled={busy} onClick={() => void changeCode(true)}>Disable code</Button>}</div>
      <p className={s.note}>Editors can change the world and scripts. Only you can manage people, rename, or delete this workspace.</p>
      {message && <p role="status">{message}</p>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}
