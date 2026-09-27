"use client";

import Image from "next/image";
import Link from "next/link";
import { AccountLinks } from "@/components/auth/session";
import { useRef, useState, type ReactNode } from "react";
import { motion, useInView, useScroll, useSpring, useTransform } from "motion/react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Panel } from "@/components/ui/panel";
import { Tabs } from "@/components/ui/tabs";
import { ExpandCard } from "@/components/ui/expand-card";
import { TiltCard } from "@/components/ui/tilt-card";
import { SpringPopover, PopoverAction } from "@/components/ui/spring-popover";
import { CreationDemo, Scene, type Setting } from "./creation-demo";
import s from "./landing.module.css";

function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <motion.div className={className} initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.12 }} transition={{ type: "spring", stiffness: 110, damping: 22 }}>{children}</motion.div>;
}
function Float({ children, className, delay = 0 }: { children: ReactNode; className: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref);
  return <motion.div ref={ref} className={className} animate={visible ? { y: [0, -10, 0], rotate: [-2, 1, -2] } : { y: 0 }} transition={{ duration: 5, repeat: visible ? Infinity : 0, ease: "easeInOut", delay }}>{children}</motion.div>;
}
function Brand() { return <span className={s.brand}>bark<span aria-hidden="true">✳</span></span>; }
function CodeBlocks({ animated = false }: { animated?: boolean }) {
  return <div className={s.blocks} aria-label="When play clicked, move 10 steps, say Hello world">
    {[<><Icon name="play" size={18} /> when Play clicked</>, <>move <b>10</b> steps <Icon name="arrow" size={18} /></>, <>say <b>Hello, world!</b></>].map((label, i) => <motion.div key={i} className={`${s.block} ${s[`block${i}`]}`} initial={animated ? { x: 35, y: -15, opacity: 0, rotate: 6 } : false} whileInView={{ x: 0, y: 0, opacity: 1, rotate: 0 }} viewport={{ once: true }} transition={{ type: "spring", stiffness: 220, damping: 18, delay: i * 0.22 }}>{label}</motion.div>)}
  </div>;
}
export function Landing() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [tab, setTab] = useState("code");
  const [setting, setSetting] = useState<Setting>("meadow");
  const lastTrigger = useRef<HTMLElement | null>(null);
  const navigationTarget = useRef<string | null>(null);
  const hero = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: hero, offset: ["start start", "end start"] });
  const artY = useSpring(useTransform(scrollYProgress, [0, 1], [0, 65]), { stiffness: 100, damping: 30 });
  function openDemo() { lastTrigger.current = document.activeElement as HTMLElement; setDemoOpen(true); }
  return <div className={s.landing}>
    <a href="#main" className={s.skip}>Skip to content</a>
    <header className={s.header}>
      <a href="#" aria-label="Bark home" className={s.brandLink}><Brand /></a>
      <nav aria-label="Main navigation" className={s.desktopNav}><Link href="/games">Play games</Link><a href="#how-it-works">How it works</a><a href="#explore">Explore</a><a href="#meet-byte">Meet Byte <span className={s.new}>Woof!</span></a></nav>
      <div className={s.navActions}><div className={s.accountLinks}><AccountLinks /></div><div className={s.mobileMenu}><SpringPopover onCloseAutoFocus={(event) => { if (navigationTarget.current) { event.preventDefault(); const target = document.getElementById(navigationTarget.current); target?.focus({ preventScroll: true }); target?.scrollIntoView({ behavior: "smooth" }); navigationTarget.current = null; } }} title="Go exploring" trigger={<Button variant="subtle" aria-label="Open navigation"><span aria-hidden="true">☰</span></Button>}>{(close) => <>{[["How it works", "how-it-works"], ["Explore", "explore"], ["Meet Byte", "meet-byte"]].map(([label, id]) => <PopoverAction key={id} onClick={() => { navigationTarget.current = id; close(); }}>{label}<Icon name="arrow" /></PopoverAction>)}<div className={s.menuAccountLinks}><Link href="/games" onClick={close}>Play games<Icon name="play" size={17} /></Link><AccountLinks /></div></>}</SpringPopover></div><Button variant="positive" onClick={openDemo} trailingIcon={<Icon name="arrow" />}>Start creating</Button></div>
    </header>
    <main id="main">
      <section className={s.hero} ref={hero} aria-labelledby="hero-title">
        <div className={s.heroCopy}>
          <motion.p className={s.eyebrow} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}><span className={s.statusDot} /> A little idea can become a whole world</motion.p>
          <motion.h1 id="hero-title" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6 }}>Big ideas.<br />Little blocks.<br /><span>Your world.</span><svg className={s.underline} viewBox="0 0 400 22" aria-hidden="true"><motion.path d="M8 13 Q175 -2 388 10 M40 20 Q220 6 360 18" stroke="currentColor" fill="none" strokeWidth="5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, delay: 0.65 }} /></svg></motion.h1>
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}><p className={s.heroDescription}>Dream up a game. Bring it to life.<br />Make a little magic with Bark.</p><div className={s.ctaRow}><Button className={s.largeButton} onClick={openDemo} trailingIcon={<Icon name="arrow" />}>Start creating</Button><a className={s.watchLink} href="#how-it-works"><span><Icon name="play" size={15} /></span>See how it works</a></div><p className={s.heroNote}><Icon name="spark" size={16} /> Big imagination. No experience needed.</p></motion.div>
        </div>
        <motion.div className={s.heroArt} style={{ y: artY }}><div className={s.heroHalo} /><motion.div initial={{ opacity: 0, scale: 0.88, y: 40 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", damping: 23, stiffness: 75, delay: 0.15 }}><TiltCard><Image src="/images/landing/hero-world.png" alt="Byte, the orange Bark puppy, on a floating island with trees and a waterfall" width={1536} height={1024} sizes="(max-width: 760px) 100vw, 58vw" preload className={s.heroImage} /></TiltCard></motion.div><Float className={s.heroCode}><CodeBlocks /></Float><Float className={s.heroBadge} delay={0.7}><span className={s.badgeIcon}><Icon name="check" /></span><span>Your imagination<br /><strong>just came to life.</strong></span></Float><span className={s.heroStar} aria-hidden="true">✦</span><span className={s.heroDoodle} aria-hidden="true">made by you ↴</span></motion.div>
      </section>
      <div className={s.promiseStrip}><span><Icon name="cube" /> Build something you imagined</span><span><Icon name="code" /> Learn a little as you go</span><span><Icon name="play" /> Turn “what if” into “let’s play”</span></div>
      <section tabIndex={-1} id="how-it-works" className={s.howSection} aria-labelledby="how-title">
        <Reveal className={s.sectionHeading}><p className={s.eyebrow}>FROM WHAT IF TO WOW</p><h2 id="how-title">A little imagination.<br className={s.mobileBreak} /> A whole lot of possibility.</h2><p>Pick it. Make it yours. Bring it to life.</p></Reveal>
        <Reveal className={s.editorWrap}><div className={s.editorBar}><span className={s.miniBrand}>bark<span>✳</span></span><strong>My first world</strong><span className={s.previewLabel}>Interactive preview</span><Button variant="positive" size="small" onClick={openDemo} leadingIcon={<Icon name="play" size={16} />}>Try it</Button></div><div className={s.editorBody}><Tabs label="Explore the creation journey" value={tab} onValueChange={setTab} items={[
          { value: "code", label: "Code", icon: <Icon name="code" />, content: <div className={s.previewGrid}><div className={s.codeCanvas}><span className={s.canvasLabel}>A few blocks. A big first step.</span><CodeBlocks animated /><span className={s.canvasCaption}>Little instructions. Endless possibilities.</span></div><Scene active={tab === "code"} setting="meadow" size={1} effects title="Hello, world!" /></div> },
          { value: "design", label: "Design", icon: <Icon name="palette" />, content: <div className={s.previewGrid}><div className={s.previewCopy}><span className={s.stepPill}>MAKE IT YOURS</span><h3>Every world starts<br />with a little “what if?”</h3><p>A sunny meadow or a starry night? You get to choose.</p><SpringPopover title="Choose your setting" trigger={<Button variant="outline" trailingIcon={<Icon name="chevron" />}>Change the scenery</Button>}>{(close) => <>{(["meadow", "sunset", "space"] as const).map((item) => <PopoverAction key={item} onClick={() => { setSetting(item); close(); }}>{item === "meadow" ? "Sunny meadow" : item === "sunset" ? "Peachy sunset" : "Starry night"}{setting === item && <Icon name="check" />}</PopoverAction>)}<div className={s.menuAccountLinks}><AccountLinks /></div></>}</SpringPopover></div><Scene active={tab === "design"} setting={setting} size={1} effects title="Your world, your rules" /></div> },
          { value: "play", label: "Play", icon: <Icon name="play" />, content: <div className={s.previewGrid}><div className={s.previewCopy}><span className={s.stepPill}>THE BEST PART</span><h3>You made that.<br />Now make it move.</h3><p>Meet Byte, change the scene, and watch your very first idea spring to life.</p><Button variant="positive" onClick={openDemo} leadingIcon={<Icon name="play" />}>Play with Byte</Button></div><Scene active={tab === "play"} setting="sunset" size={1} effects title="Ready when you are" /></div> },
        ]} /></div></Reveal>
        <div className={s.steps}>{[["01", "A world of your own", "Start with a tiny idea. A forest adventure? A treasure hunt? There's room for all of it.", "cube"], ["02", "A little block magic", "Connect simple instructions and discover how your ideas fit together.", "code"], ["03", "A big ‘I made that!’", "Press play, see what happens, and keep making it a little more you.", "play"]].map(([number, title, text, icon]) => <Reveal key={number}><Panel className={s.stepCard}><div className={s.stepTop}><span>{number}</span><Icon name={icon as "cube" | "code" | "play"} size={25} /></div><h3>{title}</h3><p>{text}</p></Panel></Reveal>)}</div>
      </section>
      <section tabIndex={-1} id="explore" className={s.exploreSection} aria-labelledby="explore-title"><Reveal className={s.exploreHeading}><div><p className={s.eyebrow}>A SPARK FOR YOUR NEXT BIG IDEA</p><h2 id="explore-title">What will you dream up?</h2></div><span>One little idea is all it takes. <span aria-hidden="true">↙</span></span></Reveal><div className={s.cards}>{([
        ["meadow", "A woodland adventure", "Follow your curiosity", "Imagine hidden paths, a friendly guide, and a treasure waiting beyond the trees. What would you put at the end of the trail?", "green"],
        ["space", "A trip past the moon", "Think outside this world", "Imagine a puppy astronaut hopping between planets. What strange new worlds would Byte discover?", "purple"],
        ["sunset", "A sky full of possibility", "Let your ideas take flight", "Imagine floating islands and peach-colored clouds. Build a path through the sky, one little idea at a time.", "blue"],
      ] as const).map(([theme, title, subtitle, description, tone]) => <Reveal key={theme}><TiltCard><ExpandCard title={title} subtitle={subtitle} description={description} tone={tone} artwork={<Scene setting={theme} size={0.8} effects decorative />}><p className={s.ideaNote}>An idea to inspire your next creation.</p></ExpandCard></TiltCard></Reveal>)}</div></section>
      <section tabIndex={-1} id="meet-byte" className={s.byteSection} aria-labelledby="byte-title"><Reveal className={s.bytePortrait}><span className={s.byteRing} /><Image src="/images/landing/byte-wave.png" alt="Byte waving hello" width={1024} height={1024} sizes="(max-width: 760px) 75vw, 350px" /><span className={s.speech}>Hey, I’m Byte!</span></Reveal><Reveal className={s.byteCopy}><p className={s.eyebrow}>A LITTLE FRIEND. A BIG IMAGINATION.</p><h2 id="byte-title">Every great adventure<br />starts with a little bark.</h2><p>Meet Byte. Curious by nature. Always up for a new idea. And very ready to be the star of your first creation.</p><Button variant="outline" onClick={openDemo} trailingIcon={<Icon name="arrow" />}>Make something with Byte</Button></Reveal></section>
      <Reveal className={s.finalCta}><span className={s.finalStar} aria-hidden="true">✦</span><p className={s.eyebrow}>GO ON. SURPRISE YOURSELF.</p><h2>Your next big adventure?<br /><span>You get to make it.</span></h2><p>A little curiosity is the perfect place to start.</p><Button className={s.largeButton} variant="positive" onClick={openDemo} trailingIcon={<Icon name="arrow" />}>Let’s make something</Button><span className={s.finalSpark} aria-hidden="true">✳</span></Reveal>
    </main>
    <footer className={s.footer}><a href="#" aria-label="Bark home" className={s.brandLink}><Brand /></a><span>Small steps. Big imaginations.</span><nav aria-label="Footer navigation"><a href="#how-it-works">How it works</a><a href="#explore">Explore</a><a href="#meet-byte">Meet Byte</a></nav><small>Made for the joy of making.</small></footer>
    <CreationDemo open={demoOpen} onOpenChange={setDemoOpen} onCloseAutoFocus={() => lastTrigger.current?.focus()} />
  </div>;
}
