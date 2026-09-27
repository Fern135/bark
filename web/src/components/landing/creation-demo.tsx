"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useInView } from "motion/react";
import { Button, IconButton } from "@/components/ui/button";
import { TextInput, Select, Slider, Switch } from "@/components/ui/fields";
import { Icon } from "@/components/ui/icon";
import s from "./landing.module.css";

export type Setting = "meadow" | "sunset" | "space";

type SceneProps = {
  setting: Setting;
  size: number;
  effects: boolean;
  title?: string;
  decorative?: boolean;
  playing?: boolean;
  run?: number;
  onComplete?: () => void;
  active?: boolean;
};

export function Scene({ setting, size, effects, title, decorative = false, playing = false, run = 0, onComplete, active = true }: SceneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const visible = inView && active;
  return <div ref={ref} className={`${s.scene} ${s[setting]} ${decorative ? s.decorativeScene : ""}`} aria-hidden={decorative || undefined}>
    <div className={s.sceneSun} /><div className={s.cloudOne} /><div className={s.cloudTwo} />
    <div className={s.hillBack} /><div className={s.hillFront} /><div className={s.scenePath} />
    <div className={s.treeOne}><i /><span /></div><div className={s.treeTwo}><i /><span /></div>
    {effects && <div className={s.particles} aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <motion.span key={i} style={{ left: `${12 + i * 15}%`, top: `${18 + i % 3 * 16}%` }} animate={visible ? { y: [0, -12, 0], opacity: [0.45, 1, 0.45], scale: [0.8, 1.15, 0.8] } : { opacity: 0.5 }} transition={{ duration: 2.8 + i * 0.2, repeat: visible ? Infinity : 0, delay: i * 0.2 }}>✦</motion.span>)}</div>}
    {title && <span className={s.sceneTitle}>{title}</span>}
    <div className={s.actorLane}><motion.div key={run} className={s.actor} initial={{ left: "36%", y: 0 }} animate={playing ? { left: ["8%", "36%", "64%", "36%"], y: [0, -24, 0, -32, 0, -18, 0], rotate: [0, -8, 7, -5, 0] } : { left: "36%", y: 0, rotate: 0 }} transition={playing ? { duration: 2.6, ease: "easeInOut" } : { duration: 0.3 }} onAnimationComplete={() => { if (playing) onComplete?.(); }}><motion.div animate={{ scale: size }} style={{ transformOrigin: "bottom center" }}><Image src="/images/landing/byte-wave.png" alt={decorative ? "" : "Byte in your miniature world"} width={1024} height={1024} sizes="180px" className={s.actorImage} /></motion.div></motion.div></div>
    <span className={s.sceneFlag} aria-hidden="true">⚑</span>
  </div>;
}

export function CreationDemo({ open, onOpenChange, onCloseAutoFocus }: { open: boolean; onOpenChange: (open: boolean) => void; onCloseAutoFocus: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("My first world");
  const [setting, setSetting] = useState<Setting>("meadow");
  const [size, setSize] = useState(1);
  const [effects, setEffects] = useState(true);
  const [opening, setOpening] = useState(false);
  function reset() { setName("My first world"); setSetting("meadow"); setSize(1); setEffects(true); }
  function start() {
    setOpening(true);
    router.push(`/editor?${new URLSearchParams({ name: name.trim() || "My first world", setting, size: String(size), sparkle: String(effects) })}`);
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><AnimatePresence>{open && <Dialog.Portal forceMount>
    <Dialog.Overlay asChild forceMount><motion.div className={s.overlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} /></Dialog.Overlay>
    <div className={s.dialogPosition}><Dialog.Content asChild forceMount onCloseAutoFocus={(event) => { event.preventDefault(); onCloseAutoFocus(); }}><motion.div className={s.demoDialog} initial={{ opacity: 0, y: 35, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.97 }} transition={{ type: "spring", stiffness: 260, damping: 27 }}>
      <div className={s.demoHeader}><div><p className={s.eyebrow}>YOUR FIRST LITTLE ADVENTURE</p><Dialog.Title>Let’s make a little magic.</Dialog.Title><Dialog.Description>Give your world a name, make it yours, then press Play.</Dialog.Description></div><Dialog.Close asChild><IconButton aria-label="Close creation demo" icon={<Icon name="close" />} /></Dialog.Close></div>
      <div className={s.demoGrid}><div className={s.demoControls}><TextInput label="World name" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} /><Select label="Setting" value={setting} onChange={(event) => setSetting(event.target.value as Setting)} options={[{ value: "meadow", label: "Sunny meadow" }, { value: "sunset", label: "Peachy sunset" }, { value: "space", label: "Starry night" }]} /><Slider label="Byte’s size" value={size} min={0.7} max={1.3} step={0.1} onValueChange={setSize} formatValue={(value) => `${value.toFixed(1)}×`} /><Switch label="A little sparkle" checked={effects} onChange={(event) => setEffects(event.target.checked)} /><div className={s.demoButtons}><Button loading={opening} leadingIcon={<Icon name="play" />} variant="positive" onClick={start}>{opening ? "Opening editor…" : "Play"}</Button><Button variant="subtle" disabled={opening} onClick={reset} leadingIcon={<Icon name="undo" size={16} />}>Reset</Button></div></div><div className={s.demoPreview}><Scene setting={setting} size={size} effects={effects} title={name.trim() || "My first world"} /><p className={s.demoStatus} role="status">Your world is ready for its first little adventure.</p></div></div>
      <p className={s.demoDisclaimer}>Play opens your world in the editor, ready to build and code. Publish whenever you’re ready to share.</p>
    </motion.div></Dialog.Content></div>
  </Dialog.Portal>}</AnimatePresence></Dialog.Root>;
}
