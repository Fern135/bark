import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { EntityDefinition } from "@bark/engine";
import { Icon } from "@/components/ui/icon";
import { Thumbnail } from "./thumbnail";
import type { EditorState } from "./editor-types";
import s from "./properties-panel.module.css";

type Section = "Transform" | "Appearance" | "Collision";
export function PropertiesPanel({ editor, entity, thumbnail, kind, sections, world }: {
  editor: EditorState;
  entity?: EntityDefinition;
  thumbnail?: string;
  kind?: string;
  sections?: Record<Section, ReactNode>;
  world: ReactNode;
}) {
  const [open, setOpen] = useState<Section | null>("Transform");
  const id = useId();
  return <section className={s.panel} aria-label="Object properties">
    <div className={s.heading}><Icon name="sliders" size={21} /><h2>Properties</h2><span className={s.live}>{editor.lock ? "Preview" : "Editing"}</span></div>
    <motion.div key={entity?.id ?? "world"} className={s.identity} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.16 }}>
      <div className={s.thumbnail}>{entity ? <Thumbnail src={thumbnail} name={entity.name} /> : <Icon name="globe" size={35} />}</div>
      <div><span className={s.eyebrow}>{entity ? "SELECTED OBJECT" : "YOUR WORLD"}</span><strong>{entity?.name ?? editor.game.project.name}</strong><span className={s.kind}>{kind ?? "Environment"}</span></div>
    </motion.div>
    {entity && sections ? <>
      <label className={s.name}>Name<input aria-label="Name" value={entity.name} maxLength={80} disabled={editor.lock} onChange={(event) => editor.update(entity.id, { name: event.target.value })} /></label>
      <div className={s.sections}>
        {(["Transform", "Appearance", "Collision"] as const).map((section, index) => <div className={s.section} key={section}>
          <button className={s.sectionTrigger} id={`${id}-${section}-trigger`} aria-expanded={open === section} aria-controls={`${id}-${section}`} onClick={() => setOpen(open === section ? null : section)}>
            <span className={s.sectionIcon}>{index === 0 ? <TransformIcon /> : <Icon name={index === 1 ? "palette" : "cube"} size={17} />}</span>{section}<svg className={s.chevron} data-open={open === section} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m4 5 3 3 3-3" /></svg>
          </button>
          <AnimatePresence initial={false}>{open === section && <motion.div id={`${id}-${section}`} role="region" aria-labelledby={`${id}-${section}-trigger`} className={s.sectionBody} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}>
            <fieldset disabled={editor.lock || !!editor.transformPreview}>{sections[section]}</fieldset>
          </motion.div>}</AnimatePresence>
        </div>)}
      </div>
      <div className={s.bottom}><button disabled={editor.lock} onClick={editor.remove}><Icon name="trash" size={15} />Delete object</button></div>
    </> : <div className={s.world}><h3>World settings</h3>{world}<p>Select an object in the scene to make it yours.</p></div>}
  </section>;
}
function TransformIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v18M3 12h18m-12-6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3" /></svg>;
}
