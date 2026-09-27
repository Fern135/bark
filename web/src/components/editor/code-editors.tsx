import { useEffect, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { Decoration } from "@codemirror/view";
import { Compartment, EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import { python } from "@codemirror/lang-python";
import { setDiagnostics } from "@codemirror/lint";
import { Blockly, validateBlockReferences } from "@bark/scripting/blocks";
import { Icon } from "@/components/ui/icon";
import { BarkFlyout, paletteCategories, showPalette } from "./block-palette";
import s from "./editor.module.css";
import { BarkRenderer } from "./block-renderer";
import { CategoryIcon } from "./category-icon";
import type { Diagnostic } from "@bark/scripting";
import { canonical, type Collaboration } from "@/lib/collaboration";

export function BlocksEditor({
  collaboration,
  initial,
  disabled,
  diagnostic,
  executingBlock,
  onChange,
}: {
  collaboration?: Collaboration | null;
  initial: Record<string, unknown>;
  disabled: boolean;
  diagnostic?: Diagnostic;
  executingBlock?: string;
  onChange(value: Record<string, unknown>, before?: Record<string, unknown>, local?: boolean): void;
}) {
  const [category, setCategory] = useState("Events");
  const [search, setSearch] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(true);
  const container = useRef<HTMLDivElement>(null),
    workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const change = useRef(onChange);
  const blockUndo = useRef<(redo: boolean) => void>(() => {});
  const live = useRef(collaboration);
  const incoming = useRef(initial);
  useEffect(() => { live.current = collaboration; incoming.current = initial; }, [collaboration, initial]);
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (validateBlockReferences(initial).length) return;
    BarkRenderer.register();
    const ws = Blockly.inject(container.current!, {
      plugins: {
        [Blockly.registry.Type.FLYOUTS_VERTICAL_TOOLBOX.toString()]: BarkFlyout,
      },
      toolbox: { kind: "flyoutToolbox", contents: [] },
      theme: Blockly.Theme.defineTheme("bark", {
        name: "bark",
        base: Blockly.Themes.Classic,
        componentStyles: {
          workspaceBackgroundColour: "#FFFFFF",
          toolboxBackgroundColour: "#F8FBFF",
          toolboxForegroundColour: "#292966",
          flyoutBackgroundColour: "#FFFFFF",
          flyoutForegroundColour: "#292966",
          flyoutOpacity: 1,
          scrollbarColour: "#BBCDE0",
          scrollbarOpacity: 0.55,
          insertionMarkerColour: "#087CF0",
          insertionMarkerOpacity: 0.3,
          cursorColour: "#087CF0",
        },
        fontStyle: {
          family: getComputedStyle(container.current!).fontFamily,
          weight: "400",
          size: 17,
        },
      }),
      renderer: "bark",
      sounds: false,
      trashcan: true,
      zoom: { controls: true, wheel: true, startScale: Math.min(1, Math.max(0.65, container.current!.clientHeight / 740)) },
      move: { drag: true, wheel: true, scrollbars: true },
      grid: { spacing: 24, length: 2, colour: "#dae1e4", snap: false },
    });
    workspace.current = ws;
    showPalette(ws, "Events", "");
    Blockly.Events.disable();
    try {
      Blockly.serialization.workspaces.load(initial, ws);
      recolorBlocks(ws);
    } finally {
      Blockly.Events.enable();
    }
    showPalette(ws, "Events", "");
    let authored = Blockly.serialization.workspaces.save(ws);
    change.current(authored, initial);
    let gesture = false, settledAt = 0;
    const publish = () => {
      const next = Blockly.serialization.workspaces.save(ws), before = authored;
      authored = next; incoming.current = next;
      change.current(next, before, true);
    };
    blockUndo.current = (redo) => { settledAt = performance.now() + 200; ws.undo(redo); publish(); };
    const listener = (event: Blockly.Events.Abstract) => {
      if (event.type === Blockly.Events.BLOCK_CREATE) recolorBlocks(ws);
      if (!event.isUiEvent && event.type !== Blockly.Events.FINISHED_LOADING)
        publish();
    };
    ws.addChangeListener(listener);
    const resourceFor = (event: Event) => {
      const target = event.target as Node;
      const block = ws.getAllBlocks(false).find((b) => b.getSvgRoot()?.contains(target));
      return block ? `block:${block.getRootBlock().id}` : "*";
    };
    const hover = (event: Event) => { const resource = resourceFor(event); if (live.current && resource !== "*") void live.current.acquire([resource]); };
    const guard = (event: Event) => {
      const client = live.current;
      if (!client) return;
      const resource = resourceFor(event);
      gesture = true; client.beginInteraction();
      if (!client.owns(resource)) { event.preventDefault(); event.stopPropagation(); void client.acquire([resource]); }
    };
    const keyboardGuard = (event: KeyboardEvent) => {
      const client = live.current;
      if (!client || event.key === "Tab" || event.key === "Escape") return;
      const selected = Blockly.common.getSelected();
      const resource = selected instanceof Blockly.BlockSvg ? `block:${selected.getRootBlock().id}` : "*";
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault(); event.stopPropagation();
        void client.acquire(["*"]).then((ok) => { if (ok) { blockUndo.current(event.shiftKey); client.endInteraction(); } });
      } else if (!client.owns(resource)) {
        event.preventDefault(); event.stopPropagation(); void client.acquire([resource]);
      }
    };
    container.current!.addEventListener("keydown", keyboardGuard, true);
    container.current!.addEventListener("pointerover", hover);
    container.current!.addEventListener("pointerdown", guard, true);
    const end = () => {
      if (!gesture) return;
      gesture = false; settledAt = performance.now() + 200;
      // Blockly queues its move event after pointer-up. Give that local delta
      // precedence before installing a remote subtree waiting on this gesture.
      setTimeout(() => { if (workspace.current === ws) { publish(); live.current?.endInteraction(); } }, 0);
    };
    window.addEventListener("pointerup", end, true);
    const target = container.current!;
    const sync = setInterval(() => {
      const client = live.current;
      if (!client) return;
      if (ws.isDragging() && (!client.state.connected || !client.state.locks.some((l) => l.conn === client.state.conn))) ws.cancelCurrentGesture();
      if (ws.isDragging() || performance.now() < settledAt) return;
      const next = incoming.current;
      const actual = Blockly.serialization.workspaces.save(ws);
      if (canonical({ ...actual, variables: actual.variables ?? [] }) !== canonical({ ...next, variables: next.variables ?? [] })) {
        Blockly.Events.disable();
        try {
          const variables = (next.variables ?? []) as { id: string; name: string; type?: string }[];
          const map = ws.getVariableMap();
          for (const variable of variables) {
            const existing = map.getVariableById(variable.id);
            if (!existing) map.createVariable(variable.name, variable.type ?? "", variable.id);
            else if (existing.getName() !== variable.name) map.renameVariable(existing, variable.name);
          }
          const replacedIds = new Set<string>();
          const variablesChanged = canonical(actual.variables ?? []) !== canonical(next.variables ?? []);
          const rootData = ((next.blocks as { blocks?: Record<string, unknown>[] })?.blocks ?? []);
          const desired = new Map(rootData.map((b) => [b.id, b]));
          const actualRoots = new Map(((actual.blocks as { blocks?: Record<string, unknown>[] })?.blocks ?? []).map((b) => [b.id, b]));
          for (const root of ws.getTopBlocks(false)) {
            const value = desired.get(root.id);
            if (!value || canonical(actualRoots.get(root.id)) !== canonical(value)) {
              root.getDescendants(false).forEach((block) => replacedIds.add(block.id));
              root.dispose(false);
            }
            else desired.delete(root.id);
          }
          for (const value of desired.values()) Blockly.serialization.blocks.append(value as unknown as Blockly.serialization.blocks.State, ws);
          for (const variable of map.getAllVariables()) if (!variables.some((v) => v.id === variable.getId())) map.deleteVariable(variable);
          // Retain local history for independent stacks. Discard complete groups
          // that reference remotely replaced blocks, so undo cannot revert peers.
          if (variablesChanged) ws.clearUndo();
          else for (const stack of [ws.getUndoStack(), ws.getRedoStack()]) {
            const touched = (event: Blockly.Events.Abstract) => {
              const data = event.toJson() as unknown as Record<string, unknown>;
              return [data.blockId, data.oldParentId, data.newParentId, ...(Array.isArray(data.ids) ? data.ids : [])].some((id) => typeof id === "string" && replacedIds.has(id));
            };
            const groups = new Set(stack.filter(touched).map((event) => event.group).filter(Boolean));
            const keep = stack.filter((event) => !touched(event) && !groups.has(event.group));
            stack.splice(0, stack.length, ...keep);
          }
          recolorBlocks(ws);
          authored = Blockly.serialization.workspaces.save(ws);
        } finally { Blockly.Events.enable(); }
      }
    }, 100);
    const resize = new ResizeObserver(() => Blockly.svgResize(ws));
    resize.observe(container.current!);
    return () => {
      resize.disconnect();
      clearInterval(sync);
      window.removeEventListener("pointerup", end, true);
      target.removeEventListener("keydown", keyboardGuard, true);
      target.removeEventListener("pointerover", hover);
      target.removeEventListener("pointerdown", guard, true);
      ws.removeChangeListener(listener);
      ws.dispose();
      workspace.current = null;
    };
    // The parent remounts on import; workspace edits must not recreate Blockly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 600px)");
    const resize = () => setPaletteOpen(!media.matches);
    resize();
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    const ws = workspace.current;
    if (!ws) return;
    if (paletteOpen) showPalette(ws, category, search);
    else ws.getFlyout()?.hide();
    Blockly.svgResize(ws);
    if (!paletteOpen) {
      const frame = requestAnimationFrame(() => ws.zoomToFit());
      return () => cancelAnimationFrame(frame);
    }
  }, [paletteOpen, category, search]);
  useEffect(() => {
    const ws = workspace.current;
    if (!ws) return;
    ws.getAllBlocks(false).forEach((b) => b.setWarningText(null));
    if (diagnostic?.blockId) {
      ws.highlightBlock(diagnostic.blockId);
      ws.getBlockById(diagnostic.blockId)?.setWarningText(diagnostic.message);
      ws.centerOnBlock(diagnostic.blockId);
    } else ws.highlightBlock(null);
  }, [diagnostic]);
  useEffect(() => {
    if (!diagnostic?.blockId)
      workspace.current?.highlightBlock(executingBlock ?? null);
  }, [executingBlock, diagnostic]);
  return (
    <div
      className={`editor-shell ${s.blockShell} ${!paletteOpen ? s.paletteClosed : ""}`}
    >
      <button
        className={s.paletteToggle}
        aria-expanded={paletteOpen}
        onClick={() => setPaletteOpen(!paletteOpen)}
      >
        {paletteOpen ? "Hide blocks" : "Blocks"}
      </button>
      <div className={s.blockSearch}>
        <Icon name="search" />
        <input
          aria-label="Search blocks"
          placeholder="Search blocks..."
          value={search}
          disabled={disabled}
          onChange={(event) => {
            setSearch(event.target.value);
            if (workspace.current)
              showPalette(workspace.current, category, event.target.value);
          }}
        />
      </div>
      <nav className={s.blockCategories} aria-label="Block categories">
        {paletteCategories.map((c) => (
          <button
            key={c.name}
            aria-pressed={category === c.name && !search}
            disabled={disabled}
            style={{ "--category-color": c.color } as React.CSSProperties}
            onClick={() => {
              setCategory(c.name);
              setSearch("");
              if (workspace.current) showPalette(workspace.current, c.name, "");
            }}
          >
            <CategoryIcon name={c.name} fallback={c.icon} />
            <span>{c.label}</span>
          </button>
        ))}
      </nav>
      <div className={s.blockActions}>
        <button
          aria-label="Undo block edit"
          disabled={disabled}
          onClick={async () => { if (!collaboration || await collaboration.acquire(["*"])) { blockUndo.current(false); collaboration?.endInteraction(); } }}
        >
          <Icon name="undo" />
        </button>
        <button
          aria-label="Redo block edit"
          disabled={disabled}
          onClick={async () => { if (!collaboration || await collaboration.acquire(["*"])) { blockUndo.current(true); collaboration?.endInteraction(); } }}
        >
          <Icon name="undo" style={{ transform: "scaleX(-1)" }} />
        </button>
      </div>
      <div
        ref={container}
        className="block-editor"
        aria-label="Block editor"
        inert={disabled}
      />
      {disabled && (
        <div className="locked-overlay">
          <span>Stop to edit your script</span>
        </div>
      )}
    </div>
  );
}

function recolorBlocks(workspace: Blockly.WorkspaceSvg) {
  for (const block of workspace.getAllBlocks(false)) {
    const type = block.type;
    if (type.startsWith("variables_") || type === "math_change") {
      block.setColour("#FF5148");
      continue;
    }
    if (
      [
        "bark_start",
        "bark_input_event",
        "bark_touch",
        "bark_interact",
        "bark_event_state",
      ].includes(type)
    )
      block.setColour("#FFA600");
    else if (type.startsWith("bark_")) block.setColour("#903AFF");
    else if (type.startsWith("controls_")) block.setColour("#1689EF");
    else if (type.startsWith("text")) block.setColour("#903AFF");
  }
}

export function PythonEditor({
  collaboration,
  source,
  readOnly: requestedReadOnly,
  diagnostic,
  executingLine,
  onChange,
}: {
  collaboration?: Collaboration | null;
  source: string;
  readOnly: boolean;
  diagnostic?: Diagnostic;
  executingLine?: number;
  onChange?(value: string): void;
}) {
  const readOnly = requestedReadOnly || (!!collaboration && !collaboration.owns("script"));
  const remoteChange = useRef(false);
  const [editable] = useState(() => new Compartment());
  const container = useRef<HTMLDivElement>(null),
    editor = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);
  useEffect(() => {
    const view = new EditorView({
      parent: container.current!,
      state: EditorState.create({
        doc: source,
        extensions: [
          basicSetup,
          executionDecoration,
          python(),
          editable.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": { height: "100%", fontSize: "13px" },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "Consolas, monospace",
            },
            ".cm-content": { padding: "16px 0" },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !remoteChange.current)
              change.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
    // Source updates are applied to the existing editor in the following effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    editor.current?.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly, editable]);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== source) {
      remoteChange.current = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
        annotations: Transaction.addToHistory.of(false),
      });
      remoteChange.current = false;
    }
  }, [source]);
  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    const line = diagnostic?.line
      ? view.state.doc.line(
          Math.min(view.state.doc.lines, Math.max(1, diagnostic.line)),
        )
      : undefined;
    view.dispatch(
      setDiagnostics(
        view.state,
        diagnostic && line
          ? [
              {
                from: line.from,
                to: line.to,
                severity: "error",
                message: diagnostic.message,
              },
            ]
          : [],
      ),
    );
    if (line) view.dispatch({ effects: EditorView.scrollIntoView(line.from) });
  }, [diagnostic, readOnly]);
  useEffect(() => {
    editor.current?.dispatch({ effects: executionLine.of(executingLine) });
  }, [executingLine, readOnly]);
  return (
    <div
      className="python-editor"
      tabIndex={0}
      onFocus={() => { if (!requestedReadOnly) { collaboration?.beginInteraction(); void collaboration?.acquire(["script"]); } }}
      onPointerEnter={() => { if (!requestedReadOnly) void collaboration?.acquire(["script"]); }}
      onPointerDown={() => { if (!requestedReadOnly) void collaboration?.acquire(["script"]); }}
      onBlur={() => collaboration?.endInteraction()}
      ref={container}
      aria-label={readOnly ? "Python preview" : "Python editor"}
    />
  );
}

const executionLine = StateEffect.define<number | undefined>();
const executionDecoration = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(executionLine)) {
        const line = effect.value;
        return line && line <= transaction.state.doc.lines
          ? Decoration.set([
              Decoration.line({ class: "executing-line" }).range(
                transaction.state.doc.line(line).from,
              ),
            ])
          : Decoration.none;
      }
    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});
