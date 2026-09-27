"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { motion, MotionConfig } from "motion/react";
import { Button, IconButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Collaborators } from "./collaborators";
import { BlocksEditor, PythonEditor } from "./code-editors";
import { ByteHint, ByteToggle } from "./byte-hint";
import { useByteHints } from "./use-byte-hints";
import { ScenePanel } from "./scene-panel";
import { Inspector } from "./inspector";
import { AddObject } from "./add-object";
import { ModelStudio } from "./model-studio";
import type { SaveSeed } from "@/lib/autosave";
import { renderThumbnails } from "./thumbnails";
import { useEditor } from "./use-editor";
import { TransformToolbar } from "./transform-toolbar";
import { nunito } from "@/lib/fonts";
import { PublishControl } from "@/components/marketplace/publish-control";
import { gamesApi } from "@/lib/games";
import type { Game } from "./use-editor";
import s from "./editor.module.css";

type Tab = "code" | "design" | "viewport";
export default function Editor({
  initialGame,
  catalogSlug,
  saveSeed,
  recoveryWarning,
  frameStarter,
}: {
  initialGame: Game;
  catalogSlug?: string;
  saveSeed: SaveSeed;
  recoveryWarning?: string;
  frameStarter?: boolean;
}) {
  const {
    canvas: canvasRef,
    session: sessionRef,
    ...editor
  } = useEditor(initialGame, saveSeed, frameStarter);
  const [tab, setTab] = useState<Tab>("viewport");
  const [adding, setAdding] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [drawer, setDrawer] = useState<"scene" | "inspector" | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const file = useRef<HTMLInputElement>(null);
  const drawerTrigger = useRef<HTMLElement | null>(null);
  const selectedEntity = editor.game.project.entities.find(
    (e) => e.id === editor.selected,
  );
  const selected = selectedEntity && editor.transformPreview?.id === selectedEntity.id
    ? { ...selectedEntity, transform: editor.transformPreview.transform } : selectedEntity;
  const restriction = selected?.character ? "Character: upright rotation ? uniform resize"
    : selected && ((selected.collider && selected.collider.shape !== "box") || editor.game.project.entities.some((e) => e.parentId === selected.id)) ? "This object resizes proportionally" : "";
  const { setViewportActive } = editor;
  useEffect(() => { setViewportActive(tab === "viewport" && !adding && !drawer); }, [tab, adding, drawer, setViewportActive]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (tab !== "viewport" || adding || drawer || editor.lock || event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [data-radix-popper-content-wrapper]')) return;
      if (event.ctrlKey || event.metaKey) {
        if (event.code === "KeyZ" || event.code === "KeyY") { event.preventDefault(); editor.undoTransform(event.shiftKey || event.code === "KeyY"); }
        return;
      }
      const tool = ({ Digit1: "select", Digit2: "move", Digit3: "resize", Digit4: "rotate" } as const)[event.code as 'Digit1'];
      if (tool) { event.preventDefault(); editor.setTools((old) => ({ ...old, tool })); }
      if (event.code === "KeyF" && editor.selected) { event.preventDefault(); editor.frame(editor.selected); }
      if (event.code === "Escape") editor.cancelTransform();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [tab, adding, drawer, editor]);
  const playing = ["running", "paused", "preparing"].includes(editor.status);
  const byte = useByteHints(editor.game, saveSeed.id, editor.localScriptRevision, tab === "code" && !editor.lock && !adding && !replacing && !languageOpen && !drawer, editor.documentGeneration);
  useEffect(() => {
    let disposed = false;
    renderThumbnails()
      .then((value) => {
        if (!disposed) setThumbs(value);
      })
      .catch(() => {
        /* The live viewport reports engine initialization errors. */
      });
    return () => {
      disposed = true;
    };
  }, []);
  function play() {
    setTab("viewport");
    setDrawer(null);
    void editor.play();
  }
  const scene = (
    <ScenePanel
      editor={editor}
      thumbs={thumbs}
      onAdd={() => {
        setReplacing(false);
        setAdding(true);
      }}
    />
  );
  const inspector = (
    <Inspector
      editor={editor}
      selected={selected}
      properties={tab === "viewport"}
      thumbnail={selected?.tags.includes("ground") ? thumbs.world : thumbs[selected?.tags.find((tag) => tag.startsWith("starter:"))?.slice(8) ?? ""]}
      compact={tab !== "design" && drawer !== "inspector"}
      onModel={() => {
        setReplacing(true);
        setAdding(true);
      }}
    />
  );
  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 380, damping: 32 }}>
    <div className={s.editor} style={{ fontFamily: nunito.style.fontFamily }}>
      <header className={s.header}>
        <Link
          href="/"
          className={s.brand}
          style={{ fontFamily: nunito.style.fontFamily }}
          aria-label="Bark home"
          onNavigate={(event) => void editor.cloud.leave(event, "/")}
        >
          bark
          <svg aria-hidden="true" viewBox="0 0 24 28">
            <path d="m6 10 2-7m5 12 8-4m-8 10 8 3" />
          </svg>
        </Link>
        <div className={s.projectName}>
          <input
            aria-label="Project name"
            value={editor.game.project.name}
            disabled={editor.lock || editor.role !== "owner"}
            maxLength={80}
            onChange={(event) => editor.rename(event.target.value)}
          />
          <span className={s.saveState}>
            <SaveIcon saved={!editor.dirty} />
            <span role="status">{editor.cloud.message}</span>
          </span>
        </div>
        <div className={s.headerActions}>
          <div className={s.collaborators}><Collaborators editor={editor}/></div>
          <Link href="/my-games" onNavigate={(event) => void editor.cloud.leave(event, "/my-games")}>My Games</Link>
          {["guest", "session"].includes(editor.cloud.status) && <Button size="small" onClick={() => void editor.cloud.signIn()}>Sign in to save</Button>}
          {catalogSlug && (
            <Link
              href={`/games/${catalogSlug}`}
              onNavigate={(event) => void editor.cloud.leave(event, `/games/${catalogSlug}`)}
            >
              Back to game
            </Link>
          )}
          <Button
            variant="outline"
            size="small"
            disabled={editor.lock}
            onClick={() => file.current?.click()}
            leadingIcon={<Icon name="upload" size={17} />}
          >
            Import
          </Button>
          <Button
            variant="outline"
            size="small"
            className={s.exportButton}
            disabled={!editor.ready || editor.busy}
            onClick={() => void editor.exportFile()}
            leadingIcon={<Icon name="upload" size={22} />}
          >
            Export JSON
          </Button>
          {playing ? (
            <>
              <Button
                variant="positive"
                disabled={editor.status === "preparing"}
                onClick={() => {
                  if (editor.status === "running") sessionRef.current?.pause();
                  else {
                    sessionRef.current?.resume();
                    canvasRef.current?.focus();
                  }
                }}
              >
                {editor.status === "paused" ? "Resume" : "Pause"}
              </Button>
              <Button
                variant="outline"
                onClick={() => sessionRef.current?.stop()}
              >
                Stop
              </Button>
              <Button
                variant="subtle"
                disabled={editor.status === "preparing"}
                onClick={play}
              >
                Restart
              </Button>
            </>
          ) : (
            <Button
              variant="positive"
              disabled={editor.lock}
              leadingIcon={<Icon name="play" />}
              onClick={play}
            >
              Play
            </Button>
          )}
        <PublishControl key={editor.cloud.gameId} id={editor.cloud.gameId} title={editor.game.project.name} role={saveSeed.role} published={editor.cloud.gameId === saveSeed.id && saveSeed.publication?.is_public} disabled={!editor.ready || editor.busy || playing} signIn={editor.cloud.signIn} beforePublish={async () => {
          if (!(await editor.cloud.flush())) return;
          const identity = editor.cloud.identity();
          if (!identity) return;
          return gamesApi.get(identity.id);
        }} />
        </div>
        <input
          ref={file}
          type="file"
          hidden
          accept=".json,application/json"
          aria-label="Import game JSON"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (chosen) void editor.importFile(chosen);
          }}
        />
      </header>
      {(editor.cloud.localError || recoveryWarning || ["error", "offline", "conflict", "session"].includes(editor.cloud.status)) && <div className={s.persistenceNotice} role="alert">
        <span>{editor.cloud.localError || recoveryWarning || editor.cloud.message}</span>
        {editor.cloud.message.includes("live editing") && !editor.shared && <Button size="small" onClick={() => location.reload()}>Connect to workspace</Button>}
        {["error", "offline"].includes(editor.cloud.status) && <Button size="small" onClick={editor.cloud.retry}>Retry save</Button>}
        {editor.cloud.status === "conflict" && <><Button size="small" onClick={editor.cloud.reload}>Reload saved version</Button><Button size="small" onClick={() => void editor.cloud.copy()}>Save as a copy</Button></>}
      </div>}
      <div className={s.navRow}>
        <nav aria-label="Editor views" className={s.tabs}>
          {(["code", "design", "viewport"] as const).map((name, i) => (
            <motion.button
              key={name}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              aria-current={tab === name ? "page" : undefined}
              onClick={() => setTab(name)}
            >
              <Icon name={(["code", "palette", "cube"] as const)[i]} />
              {name[0].toUpperCase() + name.slice(1)}
              {tab === name && (
                <motion.span layoutId="editor-tab" className={s.tabLine} />
              )}
            </motion.button>
          ))}
        </nav>
        {tab === "code" ? (
          <div className={s.language}>
            <Popover.Root open={languageOpen} onOpenChange={setLanguageOpen}>
              <Popover.Trigger asChild>
                <button
                  className={s.languageTrigger}
                  aria-expanded={languageOpen}
                  onClick={() => setLanguageOpen(!languageOpen)}
                >
                  Language:{" "}
                  <strong>
                    {editor.game.script.language === "blocks"
                      ? "Blocks"
                      : "Python"}
                  </strong>
                  <span aria-hidden="true">⌄</span>
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  className={s.languageMenu}
                  style={{ fontFamily: nunito.style.fontFamily }}
                  align="start"
                  sideOffset={8}
                >
                  <Button
                    variant="subtle"
                    size="small"
                    disabled={
                      editor.lock ||
                      (editor.game.script.language === "python" &&
                        !editor.game.script.blocksBackup)
                    }
                    onClick={() => {
                      editor.convert();
                      setLanguageOpen(false);
                    }}
                  >
                    {editor.game.script.language === "blocks"
                      ? "Convert to Python"
                      : "Restore blocks"}
                  </Button>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        ) : (
          <span className={s.navHint}>Small steps. Big imaginations.</span>
        )}
        <div className={`${s.mobileTools} ${tab === "viewport" ? s.viewportPanelButtons : ""}`}>
          <Button
            variant="outline"
            size="small"
            onClick={() => setDrawer("scene")}
          >
            Scene
          </Button>
          <Button
            variant="outline"
            size="small"
            onClick={() => setDrawer("inspector")}
          >
            {tab === "viewport" ? "Properties" : "Settings"}
          </Button>
        </div>
      </div>
      <main data-view={tab} className={`${s.workspace} ${tab === "design" ? s.design : ""}`}>
        {tab === "viewport" && <aside className={s.viewportProperties} aria-label="Properties panel">{drawer !== "inspector" && inspector}</aside>}
        {tab === "design" && (
          <aside className={s.designInspector}>{inspector}</aside>
        )}
        <section
          className={`${s.canvasPanel} ${tab !== "viewport" ? s.hiddenCanvas : ""}`}
          onPointerUpCapture={() => editor.live.client?.endInteraction()}
          onPointerCancelCapture={() => editor.live.client?.endInteraction()}
          aria-label="3D viewport"
          aria-hidden={tab !== "viewport"}
          onPointerEnter={() => { if (editor.selected) void editor.acquire([`entity:${editor.selected}`]); }}
          onPointerDownCapture={() => { editor.live.client?.beginInteraction(); if (editor.selected) void editor.acquire([`entity:${editor.selected}`]); }}
        >
          <canvas
            ref={canvasRef}
            className={s.canvas}
            tabIndex={tab === "viewport" ? 0 : -1}
            aria-label="Interactive 3D world"
          />
          {!editor.ready && (
            <div className={s.loading} role="status">
              {editor.diagnostic
                ? "The world could not open. Check the message below."
                : "Growing your little world…"}
            </div>
          )}
          <div className={s.viewportLabel}>
            <Icon name="cube" size={16} />
            {tab === "design"
              ? `Design · ${selected?.name ?? "World"}`
              : editor.game.project.name}
          </div>
          {!playing && (
            <TransformToolbar editor={editor} restriction={restriction} />
          )}
          <div className={s.hud}>
            {Object.entries(editor.feedback.hud).map(([key, value]) => (
              <span key={key}>
                {value.label}:{" "}
                {typeof value.value === "object"
                  ? JSON.stringify(value.value)
                  : String(value.value)}
              </span>
            ))}
            {editor.feedback.notifications.map((note) => (
              <span key={note.id}>{note.text}</span>
            ))}
            {editor.feedback.prompt && (
              <span>{editor.feedback.prompt.text}</span>
            )}
          </div>
          <div className={s.canvasHint}>
            {playing
              ? editor.status === "preparing"
                ? "Getting Python ready…"
                : "Click the world to focus · Stop to return to editing"
              : editor.tools.tool === "resize" ? "Drag a face · Alt: center · Shift: proportions" : "Right drag: orbit · Scroll: zoom · Click: select"}
          </div>
          <Image
            className={s.mascot}
            src="/images/editor/byte-peek.png"
            alt=""
            width={110}
            height={110}
          />
        </section>
        {tab === "design" && (
          <motion.section className={s.studioPanel} aria-label="Model studio" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.24 }}>
            {selected ? (
              <ModelStudio
                project={editor.game.project}
                selected={selected.id}
              />
            ) : (
              <div className={s.previewMessage}>
                Choose an object in Scene to customize it.
              </div>
            )}
            <Image
              className={s.mascot}
              src="/images/editor/byte-peek.png"
              alt=""
              width={140}
              height={140}
            />
          </motion.section>
        )}
        {tab === "code" && (
          <motion.section className={s.codePanel} aria-label="World code" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <ByteToggle enabled={byte.enabled} signedIn={byte.signedIn} toggle={byte.toggle} />
            <div className={s.codeHeading}>
              <div>
                <h1>
                  World <span>· Global code</span>
                </h1>
                <p>Runs across your whole project.</p>
              </div>
            </div>
            <div className={s.codeBody}>
              {editor.ready &&
                (editor.game.script.language === "blocks" ? (
                  <BlocksEditor collaboration={editor.shared ? editor.live.client : null}
                    key={editor.revision}
                    initial={editor.game.script.workspace}
                    disabled={editor.lock}
                    diagnostic={editor.diagnostic}
                    onChange={(workspace, before, local) =>
                      editor.script({ language: "blocks", workspace }, before ? { language: "blocks", workspace: before } : undefined, local ?? false)
                    }
                  />
                ) : (
                  <PythonEditor collaboration={editor.shared ? editor.live.client : null}
                    source={editor.game.script.source}
                    readOnly={editor.lock}
                    diagnostic={editor.diagnostic}
                    onChange={(source) => {
                      if (editor.game.script.language === "python")
                        editor.script({ ...editor.game.script, source });
                    }}
                  />
                ))}
            </div>
            <ByteHint suggestion={byte.suggestion} dismiss={byte.dismiss} />
          </motion.section>
        )}
        <aside className={s.sidebar}>
          {scene}
        </aside>
      </main>
      <footer className={s.footer}>
        <span>
          <SaveIcon saved={!editor.dirty} />
          {editor.status === "idle" || editor.status === "ready"
            ? editor.cloud.message
            : editor.status}{" "}
          · {tab === "code" ? "World script" : editor.game.project.name}
        </span>
        <span>
          {tab === "code"
            ? "World script | Connect a block, then press Play"
            : tab === "design"
              ? "Model studio | Your changes update the world"
              : "Right drag to orbit | Middle drag to pan | Scroll to zoom"}
        </span>
      </footer>
      {(editor.diagnostic || editor.output.length > 0) && (
        <section className={s.console} aria-label="Script output">
          {editor.diagnostic && (
            <p role="alert" className={s.error}>
              {editor.diagnostic.message}
            </p>
          )}
          {editor.output.length > 0 && (
            <details open>
              <summary>Output</summary>
              <pre>{editor.output.join("\n")}</pre>
            </details>
          )}
        </section>
      )}
      <Dialog.Root
        open={drawer !== null}
        onOpenChange={(open) => {
          if (!open) setDrawer(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={s.overlay} />
          <Dialog.Content
            className={`${s.drawer} ${tab === "viewport" && drawer === "inspector" ? s.propertiesDrawer : ""}`}
            style={{ fontFamily: nunito.style.fontFamily }}
            onOpenAutoFocus={() => {
              drawerTrigger.current = document.activeElement as HTMLElement;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              drawerTrigger.current?.focus();
            }}
          >
            <Dialog.Title>
              {drawer === "scene" ? "Your scene" : tab === "viewport" ? "Properties" : "Object settings"}
            </Dialog.Title>
            <Dialog.Description className={s.srOnly}>
              Edit the selected object or choose another object.
            </Dialog.Description>
            <Dialog.Close asChild>
              <IconButton
                className={s.close}
                aria-label="Close panel"
                icon={<Icon name="close" />}
              />
            </Dialog.Close>
            {drawer === "scene" ? scene : inspector}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {adding && (
        <AddObject
          open
          onOpenChange={setAdding}
          editor={editor}
          thumbs={thumbs}
          replacing={replacing}
          onAdded={() => {
            setTab("design");
            setAdding(false);
          }}
        />
      )}
    </div>
    </MotionConfig>
  );
}

function SaveIcon({ saved }: { saved: boolean }) {
  return (
    <svg
      width="30"
      height="28"
      viewBox="0 0 32 28"
      fill="none"
      stroke={saved ? "#00AD45" : "#747bb2"}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 23H24a6 6 0 0 0 1-12 8 8 0 0 0-15-2 7 7 0 0 0-1 14Z" />
      {saved ? <path d="m12 15 3 3 6-7" /> : <path d="M16 12v5m0 3v.1" />}
    </svg>
  );
}
