"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { transitions, useEntrance } from "@/components/ui/motion";
import Link from "next/link";
import { Button, IconButton } from "@/components/ui/button";
import { TextInput, Select, Slider, Switch } from "@/components/ui/fields";
import { Icon } from "@/components/ui/icon";
import { Panel } from "@/components/ui/panel";
import { Tabs } from "@/components/ui/tabs";
import { MotionShowcase } from "./motion-showcase";
import styles from "./showcase.module.css";

const palette = [
  { name: "Midnight", value: "#101052", token: "var(--bark-ink)" },
  { name: "Bark blue", value: "#087CF0", token: "var(--bark-blue)" },
  { name: "Let's go", value: "#A4EF86", token: "var(--bark-green)" },
  { name: "A little magic", value: "#783CF0", token: "var(--bark-purple)" },
  { name: "Fresh canvas", value: "#F1F9FA", token: "var(--bark-canvas)" },
];
const exampleObjects = ["Byte", "Tree", "Gem", "Rock", "Chair", "Bridge"];
const languages = [{ value: "blocks", label: "Blocks" }, { value: "python", label: "Python" }, { value: "javascript", label: "JavaScript" }, { value: "lua", label: "Lua" }];

export function Showcase() {
  const entrance = useEntrance();
  const artEntrance = useEntrance(0.12);
  const [mode, setMode] = useState("code");
  const [library, setLibrary] = useState("bark");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("My first world");
  const [language, setLanguage] = useState("blocks");
  const [scale, setScale] = useState(1);
  const [solid, setSolid] = useState(true);
  const [snap, setSnap] = useState(false);
  const [feedback, setFeedback] = useState("Try an action to see it respond.");
  const matches = exampleObjects.filter((item) => item.toLowerCase().includes(search.toLowerCase()));

  return <div className={styles.shell}>
    <a href="#main" className={styles.skip}>Skip to components</a>
    <header className={styles.header}>
      <Link href="/" aria-label="Bark home" className={styles.brand}>bark<span aria-hidden="true">✳</span></Link>
      <span className={styles.headerDivider} />
      <span className={styles.headerTitle}>The building blocks</span>
      <span className={styles.version}><span />Component library · 01</span>
    </header>
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <p className={styles.eyebrow}>OUR TOOLKIT</p>
        <nav aria-label="Component sections" className={styles.nav}>
          <a href="#foundations"><span>01</span>Foundations<Icon name="spark" size={17} /></a>
          <a href="#actions"><span>02</span>Actions<Icon name="play" size={17} /></a>
          <a href="#navigation"><span>03</span>Navigation<Icon name="arrow" size={17} /></a>
          <a href="#surfaces"><span>04</span>Surfaces<Icon name="cube" size={17} /></a>
          <a href="#forms"><span>05</span>Forms<Icon name="palette" size={17} /></a>
          <a href="#motion"><span>06</span>Motion playground<Icon name="spark" size={17} /></a>
        </nav>
        <div className={styles.sideNote}><Icon name="spark" size={24} /><strong>Small pieces.<br />Big possibilities.</strong><p>A friendly foundation for everything we build next.</p></div>
        <p className={styles.sideFooter}>Made for curious minds.</p>
      </aside>
      <main id="main" className={styles.main}>
        <motion.section {...entrance} className={styles.hero} aria-labelledby="page-title">
          <div><p className={styles.eyebrow}>THE BARK COMPONENT COLLECTION</p><h1 id="page-title">A little playful.<br />A lot of possibility<span>.</span></h1><p>Good ideas start with simple pieces. Meet the colors,<br className={styles.desktopBreak} /> controls, and little details that make Bark feel like Bark.</p><div className={styles.heroBadges}><span><Icon name="check" size={14} />Ready to try</span><span>9 core components</span></div></div>
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={artEntrance.viewport} transition={artEntrance.transition} className={styles.heroArt} aria-hidden="true"><div className={styles.artOrbit} /><div className={styles.artSquare}><Icon name="cube" size={68} /></div><div className={styles.artCircle}><Icon name="play" size={28} /></div><div className={styles.artPill}><Icon name="plus" size={19} />Create something</div><span className={styles.artSpark}>✳</span><span className={styles.artDot} /></motion.div>
        </motion.section>

        <section id="foundations" className={styles.section} aria-labelledby="foundations-title">
          <SectionHeading number="01" id="foundations-title" title="Foundations" note="A familiar feeling, in every detail." />
          <Panel><div className={styles.swatches}>{palette.map((color, index) => <motion.div key={color.name} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ ...transitions.gentle, delay: index * 0.045 }}><div className={styles.swatch} style={{ background: color.token }} /><strong>{color.name}</strong><span>{color.value}</span></motion.div>)}</div><div className={styles.foundationFooter}><span><strong>Aa</strong> Rounded type. Clear words. Room to breathe.</span><span>Soft corners · Gentle shadows</span></div></Panel>
        </section>

        <section id="actions" className={styles.section} aria-labelledby="actions-title">
          <SectionHeading number="02" id="actions-title" title="Actions" note="Make the next step feel easy." />
          <Panel title="Buttons" description="A clear invitation to play, create, and explore." headerAction={<span className={styles.tag}>5 variants</span>} footer={<span role="status"><motion.span key={feedback} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={transitions.fade}>{feedback}</motion.span></span>}>
            <div className={styles.buttonSamples}>
              <Sample label="Primary"><Button leadingIcon={<Icon name="plus" />} onClick={() => setFeedback("Create clicked. Your next idea starts here.")}>Create</Button></Sample>
              <Sample label="Positive"><Button variant="positive" leadingIcon={<Icon name="play" />} onClick={() => setFeedback("Play clicked. Ready to explore!")}>Play</Button></Sample>
              <Sample label="Accent"><Button variant="accent" leadingIcon={<Icon name="upload" />} onClick={() => setFeedback("Publish clicked. This is a component preview; nothing was published.")}>Publish</Button></Sample>
              <Sample label="Outline"><Button variant="outline" leadingIcon={<Icon name="upload" />} onClick={() => setFeedback("Upload clicked. File selection will be connected in the editor.")}>Upload model</Button></Sample>
              <Sample label="Subtle"><Button variant="subtle" leadingIcon={<Icon name="plus" />} onClick={() => setFeedback("Invite clicked. This preview does not send invitations.")}>Invite</Button></Sample>
            </div>
            <div className={styles.rule} />
            <div className={styles.buttonSamples}>
              <Sample label="Small"><Button size="small" trailingIcon={<Icon name="arrow" size={16} />} onClick={() => setFeedback("Small button clicked.")}>Next step</Button></Sample>
              <Sample label="Disabled"><Button disabled leadingIcon={<Icon name="play" />}>Play</Button></Sample>
              <Sample label="Loading"><Button loading>Saving…</Button></Sample>
              <Sample label="Icon only"><div className={styles.inline}><IconButton icon={<Icon name="undo" />} aria-label="Undo example action" onClick={() => setFeedback("Example action undone.")} /><IconButton icon={<Icon name="plus" />} aria-label="Add example item" onClick={() => setFeedback("Example item added.")} /><IconButton disabled icon={<Icon name="close" />} aria-label="Remove example item" /></div></Sample>
            </div>
          </Panel>
        </section>

        <section id="navigation" className={styles.section} aria-labelledby="navigation-title">
          <SectionHeading number="03" id="navigation-title" title="Navigation" note="Find your own way to create." />
          <div className={styles.twoColumns}>
            <Panel title="Mode tabs" description="One workspace. A few different perspectives.">
              <Tabs label="Editor mode preview" value={mode} onValueChange={setMode} items={[
                { value: "code", label: "Code", icon: <Icon name="code" />, content: "Connect ideas and bring your world to life with code." },
                { value: "design", label: "Design", icon: <Icon name="palette" />, content: "Give every object a little personality. Make it yours." },
                { value: "viewport", label: "Viewport", icon: <Icon name="cube" />, content: "See the bigger picture. Explore the world you are building." },
              ]} />
            </Panel>
            <Panel title="Segmented tabs" description="Keep related choices together.">
              <Tabs label="Model library preview" variant="segmented" value={library} onValueChange={setLibrary} items={[
                { value: "bark", label: "Bark library", content: "A home for characters, tools, and little discoveries." },
                { value: "uploads", label: "My uploads", content: "Your own creations will feel right at home here." },
                { value: "shared", label: "Shared", disabled: true, content: "Shared models." },
              ]} />
            </Panel>
          </div>
        </section>

        <section id="surfaces" className={styles.section} aria-labelledby="surfaces-title">
          <SectionHeading number="04" id="surfaces-title" title="Surfaces" note="A little space for every idea." />
          <div className={styles.twoColumns}>
            <Panel title="A place to start" description="A panel brings related things together." headerAction={<IconButton size="small" icon={<Icon name="plus" size={16} />} aria-label="Add to panel example" onClick={() => setFeedback("Panel action clicked.")} />} footer="A quiet footer for a helpful detail."><div className={styles.dottedPreview}><span className={styles.previewCube}><Icon name="cube" size={32} /></span><strong>Room for your imagination</strong><p>Give your content a clear, comfortable home.</p></div></Panel>
            <Panel><div className={styles.simpleSurface}><span className={styles.miniEyebrow}>KEEP IT SIMPLE</span><h3>Sometimes, less<br />is just enough.</h3><p>The same surface, with space<br />to do its own thing.</p><Button variant="outline" size="small" trailingIcon={<Icon name="arrow" size={16} />} onClick={() => setFeedback("Simple panel action clicked.")}>Explore an idea</Button></div></Panel>
          </div>
        </section>

        <section id="forms" className={styles.section} aria-labelledby="forms-title">
          <SectionHeading number="05" id="forms-title" title="Forms" note="Little adjustments. Just right." />
          <div className={styles.twoColumns}>
            <Panel title="Words & choices" description="Friendly fields that make room for an answer.">
              <div className={styles.fieldStack}>
                <TextInput label="Project name" value={name} onChange={(event) => setName(event.target.value)} description="Every great world starts with a name." error={!name.trim() ? "Give your project a name." : undefined} />
                <Select label="Language" value={language} onChange={(event) => setLanguage(event.target.value)} options={languages} />
                <TextInput label="Search objects" type="search" placeholder="Try “Tree”…" value={search} onChange={(event) => setSearch(event.target.value)} />
                <div className={styles.searchResults} aria-live="polite"><span>{matches.length} {matches.length === 1 ? "match" : "matches"}</span><div><AnimatePresence initial={false} mode="popLayout">{matches.length ? matches.map((item) => <motion.span layout="position" key={item} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={transitions.fade}>{item}</motion.span>) : <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transitions.fade}>No objects match “{search}”. Try another name.</motion.p>}</AnimatePresence></div></div>
              </div>
            </Panel>
            <Panel title="Make it your own" description="Try the controls. Watch the details change.">
              <div className={styles.fieldStack}>
                <div className={styles.scalePreview}><motion.div initial={false} animate={{ scale, rotate: solid ? 0 : -8 }} transition={transitions.gentle}><Icon name="cube" size={32} /></motion.div><span>Object preview</span></div>
                <Slider label="Scale" value={scale} onValueChange={setScale} min={0.5} max={2} step={0.1} formatValue={(value) => `${value.toFixed(1)}×`} />
                <Switch label="Solid" description="Collides with other objects" checked={solid} onChange={(event) => setSolid(event.target.checked)} />
                <Switch label="Snap to grid" description="A little help lining things up" checked={snap} onChange={(event) => setSnap(event.target.checked)} />
                <div className={styles.liveSummary} role="status"><motion.span key={`${solid}-${snap}`} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}><Icon name="check" size={17} /></motion.span>{scale.toFixed(1)}× scale · {solid ? "Solid" : "Not solid"} · {snap ? "Grid snap on" : "Free placement"}</div>
              </div>
            </Panel>
          </div>
          <Panel title="Every state deserves a little care" description="Helpful messages, clear boundaries, and no guessing." className={styles.statesPanel}>
            <div className={styles.statesGrid}>
              <TextInput label="Object name" defaultValue="" placeholder="Give it a name" error="Enter a name to continue." required />
              <TextInput label="Position X" type="number" defaultValue={0} step={0.1} description="Number input · steps of 0.1" />
              <TextInput label="Read-only example" value="World" readOnly description="This name is managed by the project." />
              <TextInput label="Unavailable field" defaultValue="Coming soon" disabled />
              <Select label="Choose an animation" defaultValue="" placeholder="Select animation" options={[{ value: "idle", label: "Idle" }, { value: "walk", label: "Walk" }]} error="Choose an animation to preview." />
              <Select label="Unavailable select" defaultValue="idle" options={[{ value: "idle", label: "Idle" }]} disabled />
              <Slider label="Locked scale" value={1} onValueChange={() => {}} min={0.5} max={2} step={0.1} formatValue={(value) => `${value.toFixed(1)}×`} disabled />
              <div className={styles.fieldStack}><Switch label="Unavailable switch" disabled /><Switch label="Locked on" checked disabled /></div>
            </div>
          </Panel>
        </section>
        <section id="motion" className={styles.section} aria-labelledby="motion-title">
          <SectionHeading number="06" id="motion-title" title="A little extra magic" note="Full motion. A little more personality." />
          <MotionShowcase />
        </section>
        <footer className={styles.footer}><span className={styles.footerBrand}>bark<span>✳</span></span><span>Built from little things. Made for big ideas.</span><a href="#main">Back to top ↑</a></footer>
      </main>
    </div>
  </div>;
}

function SectionHeading({ number, title, note, id }: { number: string; title: string; note: string; id: string }) {
  return <div className={styles.sectionHeading}><div><span>{number}</span><h2 id={id}>{title}</h2></div><p>{note}</p></div>;
}

function Sample({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className={styles.sample}>{children}<span>{label}</span></div>;
}
