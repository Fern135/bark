"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExpandCard } from "@/components/ui/expand-card";
import { MorphingButton, type ActionStatus } from "@/components/ui/morphing-button";
import { PopoverAction, SpringPopover } from "@/components/ui/spring-popover";
import { TiltCard } from "@/components/ui/tilt-card";
import { Switch, TextInput } from "@/components/ui/fields";
import { Icon, type IconName } from "@/components/ui/icon";
import { Panel } from "@/components/ui/panel";
import { Tabs } from "@/components/ui/tabs";
import styles from "./motion-showcase.module.css";

const cards = [
  { title: "Little world", subtitle: "A place for big ideas", tone: "blue", icon: "cube", description: "Every adventure needs a starting point. This little world is ready for its first tree, its first character, and its first story." },
  { title: "A spark of magic", subtitle: "Make something unexpected", tone: "purple", icon: "spark", description: "A tiny surprise can make a world feel alive. Give your creation a special effect, a secret to discover, or a little extra personality." },
  { title: "Ready, set, play", subtitle: "Let curiosity take the lead", tone: "green", icon: "play", description: "The best part of building is trying it out. Explore your ideas, discover what works, and come back with a new adventure in mind." },
] satisfies { title: string; subtitle: string; tone: "blue" | "purple" | "green"; icon: IconName; description: string }[];

export function MotionShowcase() {
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [fail, setFail] = useState(false);
  const [tab, setTab] = useState("idea");
  const [choice, setChoice] = useState("Open the menu and choose a starting point.");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function previewSave() {
    if (status === "loading") return;
    setStatus("loading");
    timer.current = setTimeout(() => { setStatus(fail ? "error" : "success"); }, 1100);
  }

  return <div className={styles.collection}>
    <div className={styles.row}>
      <Panel title="A button with a happy ending" description="Press save. Watch the shape, icon, and message change.">
        <div className={styles.saveStage}><MorphingButton status={status} label="Save changes" onClick={previewSave} /></div>
        <div className={styles.saveControls}><Switch label="Preview a failed save" checked={fail} onChange={(event) => setFail(event.target.checked)} disabled={status === "loading"} />
          <p role="status">{status === "loading" ? "Saving demo…" : status === "success" ? "Demo saved! Click again to replay." : status === "error" ? "Demo failed. Turn off the failure preview and retry." : "This is a demo; no project data is saved."}</p></div>
      </Panel>
      <Panel title="A menu that unfolds" description="A soft spring, then each choice arrives in turn.">
        <div className={styles.popoverStage}>
          <SpringPopover title="What shall we make?" trigger={<Button variant="accent" trailingIcon={<Icon name="chevron" />}>Create something</Button>}>
            {(close) => <><p>Every great idea starts somewhere.</p>{cards.map((card) => <PopoverAction key={card.title} leadingIcon={<Icon name={card.icon} />} onClick={() => { setChoice(`You chose ${card.title.toLowerCase()}.`); close(); }}>{card.title}</PopoverAction>)}</>}
          </SpringPopover>
        </div>
        <p className={styles.caption} role="status">{choice}</p>
      </Panel>
    </div>
    <Panel title="A closer look" description="Move your pointer over a card, then open it. The same surface grows into the details.">
      <div className={styles.cards}>{cards.map((card) => <TiltCard key={card.title}>
        <ExpandCard {...card} artwork={<span className={`${styles.artObject} ${styles[card.tone]}`}><Icon name={card.icon} size={64} /></span>}>
          <div className={styles.detailTags}><span>Made for exploring</span><span>A little imagination</span></div>
          <p className={styles.detailHint}>Press Escape or the close button to return to your card.</p>
        </ExpandCard>
      </TiltCard>)}</div>
    </Panel>
    <Panel title="Follow the idea" description="Change tabs to feel the direction and height adjust. Your draft stays right where you left it.">
      <Tabs label="Motion story" value={tab} onValueChange={setTab} variant="segmented" items={[
        { value: "idea", label: "01 · Imagine", icon: <Icon name="spark" />, content: <div className={styles.tabCopy}><h3>What if…?</h3><p>A world in the clouds. A tiny explorer. A door that leads somewhere unexpected.</p></div> },
        { value: "make", label: "02 · Make", icon: <Icon name="palette" />, content: <div className={styles.tabCopy}><h3>Give your idea a name.</h3><p>Start small. You can build the rest one little piece at a time.</p><TextInput label="Your adventure" defaultValue="A walk among the clouds" description="Try editing this, switching tabs, and coming back." /><div className={styles.detailTags}><span>One curious character</span><span>Somewhere to explore</span><span>A little surprise</span></div></div> },
        { value: "play", label: "03 · Play", icon: <Icon name="play" />, content: <div className={styles.tabCopy}><h3>Off you go.</h3><p>Try it. Discover something. Come back with another idea.</p><span className={styles.ready}><Icon name="check" size={18} /> Ready for an adventure</span></div> },
      ]} />
    </Panel>
  </div>;
}
