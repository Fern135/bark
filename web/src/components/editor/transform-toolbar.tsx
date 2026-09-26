import * as Popover from "@radix-ui/react-popover";
import { motion, AnimatePresence } from "motion/react";
import type { EditorTool } from "@bark/engine";
import type { EditorState } from "./editor-types";
import s from "./transform-toolbar.module.css";

const tools: { id: EditorTool; name: string; path: string }[] = [
  { id: "select", name: "Select", path: "m5 3 14 9-7 1-3 7-4-17Z" },
  { id: "move", name: "Move", path: "M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" },
  { id: "resize", name: "Resize", path: "M4 10V4h6M14 20h6v-6M4 4l6 6M20 20l-6-6M14 4h6v6M4 14v6h6" },
  { id: "rotate", name: "Rotate", path: "M20 10a8 8 0 1 0-1 7M20 4v6h-6" },
];
function Glyph({ path }: { path: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}
export function TransformToolbar({ editor, restriction }: { editor: EditorState; restriction: string }) {
  return <>
    <motion.div className={s.toolbar} role="toolbar" aria-label="Object transform tools" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
      <div className={s.tools}>
        {tools.map((tool, index) => <button key={tool.id} type="button" aria-label={`${tool.name} tool`} aria-pressed={editor.tools.tool === tool.id} disabled={editor.lock} onClick={() => editor.setTools((old) => ({ ...old, tool: tool.id }))} title={`${tool.name} · ${index + 1}`}>
          {editor.tools.tool === tool.id && <motion.span className={s.active} layoutId="transform-tool" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
          <span className={s.toolContent}><Glyph path={tool.path} /><span>{tool.name}</span><kbd>{index + 1}</kbd></span>
        </button>)}
      </div>
      <div className={s.divider} />
      <Popover.Root>
        <Popover.Trigger asChild><button className={s.settingsTrigger} aria-label="Transform settings" title="Snapping, axes and camera"><Glyph path="M4 7h16M4 17h16M8 4v6M16 14v6" /><span>{editor.tools.snapping ? "Snap on" : "Free"}</span></button></Popover.Trigger>
        <Popover.Portal><Popover.Content className={s.popover} sideOffset={12} align="end" collisionPadding={12}>
          <h3>Make it precise</h3>
          <label className={s.toggle}>Snap to increments<input type="checkbox" checked={editor.tools.snapping} onChange={(e) => editor.setTools((old) => ({ ...old, snapping: e.target.checked }))} /></label>
          <div className={s.increments}>{([['moveSnap', 'Move', 'units'], ['resizeSnap', 'Resize', 'units'], ['rotateSnap', 'Rotate', '°']] as const).map(([key, label, unit]) => <label key={key}>{label}<span><input aria-label={`${label} snap increment`} type="number" min="0.01" step={key === 'rotateSnap' ? 1 : 0.25} value={editor.tools[key]} onChange={(e) => { const value = Number(e.target.value); if (value > 0 && Number.isFinite(value)) editor.setTools((old) => ({ ...old, [key]: value })); }} />{unit}</span></label>)}</div>
          <span className={s.label}>Move & rotate axes</span>
          <div className={s.segment}>{(['world', 'local'] as const).map((space) => <button key={space} aria-pressed={editor.tools.space === space} onClick={() => editor.setTools((old) => ({ ...old, space }))}>{space === 'world' ? 'World' : 'Local'}</button>)}</div>
          <div className={s.camera}><button disabled={!editor.selected || editor.lock} onClick={() => editor.frame(editor.selected!)}>Focus object <kbd>F</kbd></button><button disabled={editor.lock} onClick={() => editor.frame()}>Reset view</button></div>
          <p>Right drag to orbit · Middle drag to pan<br />Scroll to zoom · Esc cancels a drag</p>
          <Popover.Arrow className={s.arrow} />
        </Popover.Content></Popover.Portal>
      </Popover.Root>
    </motion.div>
    <div className={s.history}>
      <button aria-label="Undo transform" title="Undo · Ctrl/⌘ Z" disabled={editor.lock || !editor.historySize.undo} onClick={() => editor.undoTransform()}><Glyph path="M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12" /></button>
      <button aria-label="Redo transform" title="Redo · Ctrl/⌘ Shift Z" disabled={editor.lock || !editor.historySize.redo} onClick={() => editor.undoTransform(true)}><Glyph path="m15 4 5 5-5 5M20 9h-10a6 6 0 0 0 0 12" /></button>
    </div>
    <AnimatePresence mode="wait">{(editor.transformPreview || restriction) && <motion.div key={editor.transformPreview ? 'drag' : restriction} className={s.readout} role="status" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      {editor.transformPreview ? <><span className={s.liveDot} />{editor.transformPreview.label}<kbd>Esc to cancel</kbd></> : restriction}
    </motion.div>}</AnimatePresence>
  </>;
}
