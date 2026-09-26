import { useEffect, useRef } from "react";
import * as Blockly from "blockly";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { python } from "@codemirror/lang-python";
import { setDiagnostics } from "@codemirror/lint";
import { toolbox } from "../src/blocks";
import type { Diagnostic } from "../src/types";

export function BlocksEditor({
  initial,
  disabled,
  diagnostic,
  onChange,
}: {
  initial: Record<string, unknown>;
  disabled: boolean;
  diagnostic?: Diagnostic;
  onChange(value: Record<string, unknown>): void;
}) {
  const container = useRef<HTMLDivElement>(null),
    workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    const ws = Blockly.inject(container.current!, {
      toolbox,
      renderer: "zelos",
      sounds: false,
      trashcan: true,
      zoom: { controls: true, wheel: true, startScale: 0.7 },
      move: { drag: true, wheel: true, scrollbars: true },
      grid: { spacing: 24, length: 2, colour: "#dae1e4", snap: false },
    });
    workspace.current = ws;
    Blockly.Events.disable();
    try {
      Blockly.serialization.workspaces.load(initial, ws);
    } finally {
      Blockly.Events.enable();
    }
    change.current(Blockly.serialization.workspaces.save(ws));
    const listener = (event: Blockly.Events.Abstract) => {
      if (!event.isUiEvent && event.type !== Blockly.Events.FINISHED_LOADING)
        change.current(Blockly.serialization.workspaces.save(ws));
    };
    ws.addChangeListener(listener);
    const resize = new ResizeObserver(() => Blockly.svgResize(ws));
    resize.observe(container.current!);
    return () => {
      resize.disconnect();
      ws.removeChangeListener(listener);
      ws.dispose();
      workspace.current = null;
    };
  }, []);
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
  return (
    <div className="editor-shell">
      <div ref={container} className="block-editor" aria-label="Block editor" inert={disabled} />
      {disabled && (
        <div className="locked-overlay">
          <span>Stop to edit your script</span>
        </div>
      )}
    </div>
  );
}

export function PythonEditor({
  source,
  readOnly,
  diagnostic,
  onChange,
}: {
  source: string;
  readOnly: boolean;
  diagnostic?: Diagnostic;
  onChange?(value: string): void;
}) {
  const container = useRef<HTMLDivElement>(null),
    editor = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    const view = new EditorView({
      parent: container.current!,
      state: EditorState.create({
        doc: source,
        extensions: [
          basicSetup,
          python(),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": { height: "100%", fontSize: "13px" },
            ".cm-scroller": { overflow: "auto", fontFamily: "Consolas, monospace" },
            ".cm-content": { padding: "16px 0" },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
  }, [readOnly]);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== source)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
  }, [source]);
  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    const line = diagnostic?.line
      ? view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, diagnostic.line)))
      : undefined;
    view.dispatch(
      setDiagnostics(
        view.state,
        diagnostic && line
          ? [{ from: line.from, to: line.to, severity: "error", message: diagnostic.message }]
          : [],
      ),
    );
    if (line) view.dispatch({ effects: EditorView.scrollIntoView(line.from) });
  }, [diagnostic, readOnly]);
  return (
    <div
      className="python-editor"
      ref={container}
      aria-label={readOnly ? "Python preview" : "Python editor"}
    />
  );
}
