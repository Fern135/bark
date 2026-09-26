import { useEffect, useState } from "react";
import type {
  FeedbackSnapshot,
  GameRuntime,
  ProjectDocument,
} from "@bark/engine";
import type { Inspection, SessionStatus } from "../src/types";

export function Feedback({ runtime }: { runtime: GameRuntime | null }) {
  const [state, setState] = useState<FeedbackSnapshot>({
    hud: {},
    notifications: [],
    prompt: null,
  });
  useEffect(() => {
    if (!runtime) return;
    setState(runtime.feedback.get());
    const off = runtime.on("feedback", setState, { scope: "runtime" });
    const stateOff = runtime.on(
      "state",
      () => setState(runtime.feedback.get()),
      { scope: "runtime" },
    );
    return () => {
      off();
      stateOff();
    };
  }, [runtime]);
  return (
    <div className="game-feedback" aria-live="polite">
      <div className="hud">
        {Object.entries(state.hud).map(([key, item]) => (
          <span key={key} data-testid={`hud-${key}`}>
            {item.label}:{" "}
            {typeof item.value === "object"
              ? JSON.stringify(item.value)
              : String(item.value)}
          </span>
        ))}
      </div>
      <div className="notifications">
        {state.notifications.map((n) => (
          <div key={n.id}>{n.text}</div>
        ))}
      </div>
      {state.prompt && (
        <div className="interaction-prompt">{state.prompt.text}</div>
      )}
    </div>
  );
}

export function PropertyInspector({
  runtime,
  project,
  status,
  onSave,
}: {
  runtime: GameRuntime | null;
  project: ProjectDocument;
  status: SessionStatus;
  onSave(
    target: string | null,
    key: string,
    value: unknown,
    remove: boolean,
  ): void;
}) {
  const [target, setTarget] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("0");
  const [error, setError] = useState("");
  const [, refresh] = useState(0);
  const editable = !!runtime && ["idle", "ready"].includes(status);
  useEffect(() => {
    if (!runtime) return;
    const off = runtime.on("property", () => refresh((n) => n + 1), {
      scope: "runtime",
    });
    const entityOff = runtime.on("entity", () => refresh((n) => n + 1), {
      scope: "runtime",
    });
    return () => {
      off();
      entityOff();
    };
  }, [runtime]);
  useEffect(() => {
    setTarget("");
    setKey("");
  }, [project.name]);
  let properties: Record<string, unknown> = {};
  try {
    properties = runtime?.properties.list(target || null) ?? {};
  } catch {
    /* A runtime entity may have been collected. */
  }
  function save(remove = false) {
    try {
      if (!key.trim()) throw new Error("Enter a property name.");
      onSave(target || null, key, remove ? null : JSON.parse(value), remove);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <details className="inspector">
      <summary>
        Properties ·{" "}
        {editable ? "authored starting values" : "runtime values (read-only)"}
      </summary>
      <label>
        Target{" "}
        <select
          aria-label="Property target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">World</option>
          {project.entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <div className="property-values">
        {Object.entries(properties).map(([name, val]) => (
          <button
            key={name}
            onClick={() => {
              setKey(name);
              setValue(JSON.stringify(val));
            }}
          >
            {name}: {JSON.stringify(val)}
          </button>
        ))}
      </div>
      <fieldset disabled={!editable}>
        <input
          aria-label="Property name"
          placeholder="Property name"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <input
          aria-label="Property JSON value"
          placeholder='JSON value, e.g. 3 or "hello"'
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button onClick={() => save()}>Save property</button>
        <button onClick={() => save(true)}>Remove property</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

export function LiveInspection({
  enabled,
  onToggle,
  snapshot,
}: {
  enabled: boolean;
  onToggle(value: boolean): void;
  snapshot?: Inspection;
}) {
  return (
    <details className="inspector" open={enabled}>
      <summary>Live inspection</summary>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />{" "}
        Enable live inspection
      </label>
      {enabled && (
        <div data-testid="inspection">
          <p>
            {snapshot?.line
              ? `Line ${snapshot.line}${snapshot.blockId ? " · block " + snapshot.blockId : ""}`
              : "Waiting for script execution"}
          </p>
          <div className="watch-columns">
            <div>
              <strong>Game variables</strong>
              <pre>{JSON.stringify(snapshot?.globals ?? {}, null, 2)}</pre>
            </div>
            <div>
              <strong>Current locals</strong>
              <pre>{JSON.stringify(snapshot?.locals ?? {}, null, 2)}</pre>
            </div>
          </div>
          <strong>Recent events</strong>
          <pre>
            {snapshot?.activity
              .map(
                (e) =>
                  `${e.time.toFixed(2)} ${e.event} → ${e.handler}: ${e.phase}`,
              )
              .join("\n")}
          </pre>
        </div>
      )}
    </details>
  );
}
