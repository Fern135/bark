import { degreesFromQuaternion, quaternionFromDegrees } from "@bark/engine";
import type { EntityDefinition, Vec3 } from "@bark/engine";
import s from "./editor.module.css";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { TextInput, Slider, Switch } from "@/components/ui/fields";
import { catalog, makeObject } from "./catalog";
import type { EditorState } from "./editor-types";
import { PropertiesPanel } from "./properties-panel";
export function Inspector({
  editor,
  selected,
  onModel,
  compact = false,
  properties = false,
  thumbnail,
}: {
  editor: EditorState;
  selected?: EntityDefinition;
  onModel(): void;
  compact?: boolean;
  properties?: boolean;
  thumbnail?: string;
}) {
  const e = selected;
  const worldFields = (<fieldset disabled={editor.lock} className={s.fields}>
          <label>
            Sky color
            <input
              type="color"
              value={editor.game.project.settings.background}
              onChange={(event) =>
                editor.edit((r) =>
                  r.configure({ background: event.target.value }),
                )
              }
            />
          </label>
          <Slider
            label="Sunlight"
            value={editor.game.project.settings.sunIntensity}
            min={0}
            max={5}
            step={0.1}
            onValueChange={(value) =>
              editor.edit((r) => r.configure({ sunIntensity: value }))
            }
          />
          <Switch
            label="Shadows"
            checked={editor.game.project.settings.shadows}
            onChange={(event) =>
              editor.edit((r) => r.configure({ shadows: event.target.checked }))
            }
          />
          <p className={s.help}>
            Your world script lives in Code. Select an object to change its
            appearance.
          </p>
        </fieldset>);
  if (!e) return properties ? <PropertiesPanel editor={editor} world={worldFields} /> : (
    <section className={s.panel}><div className={s.panelHeading}><Icon name="palette" /><h2>World settings</h2></div>{worldFields}</section>
  );
  const color =
    e.visual && e.visual.kind !== "model"
      ? (e.visual.color ?? "#FFFFFF")
      : null;
  const rotation = degreesFromQuaternion(e.transform.rotation);
  const kind =
    e.tags.find((t) => t.startsWith("category:"))?.slice(9) ??
    (e.character ? "Character" : "Object");
  const uniform = !!e.character || (!!e.collider && e.collider.shape !== "box") || editor.game.project.entities.some((child) => child.parentId === e.id);
  function transform(
    field: "position" | "rotation" | "scale",
    axis: keyof Vec3,
    value: number,
  ) {
    if (!Number.isFinite(value)) return;
    if (field === "rotation" && e!.character && axis !== "y") return;
    if (field === "scale") value = Math.max(0.01, value);
    let vector = {
      ...(field === "rotation" ? rotation : e!.transform[field]),
      [axis]: value,
    };
    if (field === "scale" && uniform) {
      const factor = Math.max(value / e!.transform.scale[axis], 0.01 / Math.min(...Object.values(e!.transform.scale)));
      vector = { x: e!.transform.scale.x * factor, y: e!.transform.scale.y * factor, z: e!.transform.scale.z * factor };
    }
    editor.update(e!.id, {
      transform: {
        ...e!.transform,
        [field]: field === "rotation" ? quaternionFromDegrees(vector) : vector,
      },
    });
  }
  const appearanceFields = (<>
        <div className={s.modelField}>
        <span className={s.fieldTitle}>Model</span>
        <Button
          variant="outline"
          size="small"
          leadingIcon={<Icon name="cube" />}
          className={s.modelButton}
          onClick={onModel}
        >
          Gallery & upload
        </Button>
        </div>
        {color && (
          <label>
            Color
            <input
              type="color"
              value={color}
              onChange={(event) =>
                editor.edit((r) => {
                  if (e.visual && e.visual.kind !== "model")
                    r.world.update(e.id, {
                      visual: { ...e.visual, color: event.target.value },
                    });
                  for (const child of r.world.children(e.id)) {
                    if (child.visual && child.visual.kind !== "model")
                      r.world.update(child.id, {
                        visual: { ...child.visual, color: event.target.value },
                      });
                  }
                })
              }
            />
          </label>
        )}
  </>);
  const collisionFields = (<>
        <div className={s.physicsField}>
        <span className={s.fieldTitle}>Physics</span>
        <Switch
          label="Solid (collides with objects)"
          checked={!!e.collider && !e.collider.trigger}
          disabled={!!e.character || !!e.parentId}
          description={
            e.character ? "Characters need a solid capsule." : e.parentId ? "Collision is controlled by the parent object." : undefined
          }
          onChange={(event) =>
            editor.update(
              e.id,
              event.target.checked
                ? {
                    collider: {
                      shape: "box",
                      size:
                        e.visual && e.visual.kind !== "model"
                          ? e.visual.size
                          : { x: 1, y: 1, z: 1 },
                    },
                    body: { mode: "static" },
                  }
                : { collider: null, body: null, interaction: null },
            )
          }
        />
        </div>
  </>);
  const resetAppearance = (
        <Button
          variant="subtle"
          size="small"
          leadingIcon={<Icon name="undo" size={16} />}
          onClick={() => {
            const item = catalog.find((item) =>
              e.tags.includes(`starter:${item.id}`),
            );
            editor.edit((r) => {
              r.world.update(e.id, {
                transform: { ...e.transform, scale: { x: 1, y: 1, z: 1 } },
              });
              if (
                item &&
                (!item.model ||
                  r.assets
                    .list()
                    .some((asset) => asset.id === `starter-${item.id}`))
              ) {
                const defaults = makeObject(item, e.id);
                for (const part of defaults)
                  if (r.world.list().some((v) => v.id === part.id))
                    r.world.update(part.id, { visual: part.visual });
              }
            });
          }}
        >
          Reset appearance
        </Button>
  );
  const transformFields = (<>
        {(["position", "rotation", "scale"] as const).map((field) => (
          <div className={s.transform} data-transform={field} key={field}>
            <span>
              {field[0].toUpperCase() + field.slice(1)}{" "}
              {properties ? <small>{field === "rotation" ? "degrees" : field === "scale" ? "multiplier" : "units"}</small> : !compact && (field === "rotation" ? "(degrees)" : "(X, Y, Z)")}
            </span>
            <div>
              {(["x", "y", "z"] as const).map((axis) => (
                <label key={axis} className={s[axis]}>
                  <span>{axis.toUpperCase()}</span>
                  <input
                    key={`${e.id}-${field}-${axis}-${field === "rotation" ? rotation[axis] : e.transform[field][axis]}`}
                    aria-label={`${field} ${axis}`}
                    type="number"
                    min={field === "scale" ? 0.01 : undefined}
                    disabled={field === "rotation" && !!e.character && axis !== "y"}
                    step={field === "rotation" ? 5 : 0.1}
                    defaultValue={Number(
                      (field === "rotation"
                        ? rotation[axis]
                        : e.transform[field][axis]
                      ).toFixed(2),
                    )}
                    onBlur={(event) => {
                      if (event.target.value !== "" && Number.isFinite(event.target.valueAsNumber)) {
                        if (field === "scale") event.target.value = String(Math.max(0.01, event.target.valueAsNumber));
                        transform(field, axis, event.target.valueAsNumber);
                      } else {
                        event.target.value = String(field === "rotation" ? rotation[axis] : e.transform[field][axis]);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
  </>);
  if (properties) return <PropertiesPanel key={e.id} editor={editor} entity={e} kind={kind} thumbnail={thumbnail} world={worldFields} sections={{
    Transform: <>{transformFields}{(e.character || uniform) && <p>{e.character ? "Upright rotation. Proportional scale." : "Proportional scale required."}</p>}</>,
    Appearance: <>{appearanceFields}<Switch label="Visible" checked={e.visible} onChange={(event) => editor.update(e.id, { visible: event.target.checked })} />{resetAppearance}</>,
    Collision: collisionFields,
  }} />;
  return (
    <section className={`${s.panel} ${compact ? s.compactInspector : ""}`}>
      <div className={s.panelHeading}>
        {compact ? <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4" /></svg> : <Icon name="palette" />}
        <h2>{compact ? "Transform" : `Customize ${e.name}`}</h2>
        {compact && <button className={s.inspectorModel} onClick={onModel} disabled={editor.lock} aria-label="Change model" title="Change model"><Icon name="palette" size={19} /></button>}
      </div>
      <fieldset disabled={editor.lock} className={s.fields}>
        <TextInput
          label="Name"
          value={e.name}
          onChange={(event) =>
            editor.update(e.id, { name: event.target.value })
          }
        />
        <div className={s.typeRow}>
          <span>Type</span>
          <strong>{kind}</strong>
        </div>
        {appearanceFields}
        <Slider
          label="Scale"
          value={e.transform.scale.x}
          min={0.2}
          max={3}
          step={0.1}
          formatValue={(value) => `${value.toFixed(1)}×`}
          onValueChange={(value) =>
            editor.update(e.id, {
              transform: {
                ...e.transform,
                scale: { x: value, y: value, z: value },
              },
            })
          }
        />
        {collisionFields}
        {resetAppearance}
        <div className={s.sectionLabel}>
          Transform
          <span />
        </div>
        {transformFields}
        <Button
          className={s.delete}
          variant="subtle"
          size="small"
          onClick={() => editor.remove()}
        >
          Delete object
        </Button>
      </fieldset>
    </section>
  );
}
