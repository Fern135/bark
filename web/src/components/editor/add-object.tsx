import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { defineEntity, createProject } from "@bark/engine";
import { ModelStudio } from "./model-studio";
import { Thumbnail } from "./thumbnail";
import s from "./editor.module.css";
import { Icon } from "@/components/ui/icon";
import { Button, IconButton } from "@/components/ui/button";
import { TextInput, Slider } from "@/components/ui/fields";
import { nunito } from "@/lib/fonts";
import {
  catalog,
  categories,
  makeObject,
  catalogAssets,
  type Category,
  type CatalogItem,
} from "./catalog";
import type { EditorState } from "./editor-types";
const categoryDescriptions = {
  Character: "A player or creature",
  Tool: "Something to build with",
  Object: "Make your world yours",
  Item: "A little extra possibility",
};
export function AddObject({
  open,
  onOpenChange,
  editor,
  thumbs,
  replacing,
  onAdded,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  editor: EditorState;
  thumbs: Record<string, string>;
  replacing: boolean;
  onAdded(): void;
}) {
  const [step, setStep] = useState(replacing ? 1 : 0);
  const [category, setCategory] = useState<Category>("Character");
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [item, setItem] = useState<CatalogItem>(catalog[0]);
  const [name, setName] = useState("Little explorer");
  const [size, setSize] = useState(
    replacing
      ? (editor.game.project.entities.find((e) => e.id === editor.selected)
          ?.transform.scale.x ?? 1)
      : 1,
  );
  const [upload, setUpload] = useState<{ name: string; url: string }>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const uploadEpoch = useRef(0);
  useEffect(() => {
    // Invalidate pending file reads when this dialog is unmounted.
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      uploadEpoch.current++;
    };
  }, []);
  async function add() {
    setError("");
    const project = structuredClone(editor.game.project);
    for (const asset of catalogAssets()) {
      const existing = project.assets.find((a) => a.id === asset.id);
      if (!existing)
        project.assets.push(asset);
      else if (!upload && item.id === "player" && asset.id === "starter-player" && /\/models\/(?:starter|toys)\/player\.glb$/.test(existing.url))
        existing.url = asset.url;
    }
    const old = replacing
      ? project.entities.find((e) => e.id === editor.selected)
      : undefined;
    const id = old?.id ?? crypto.randomUUID();
    const index = project.entities.filter((e) => !e.parentId).length;
    const position = old?.transform.position ?? {
      x: ((index % 4) - 1.5) * 2,
      y: item.size.y / 2 + 0.2,
      z: -3,
    };
    let entities = makeObject(item, id, position);
    if (upload) {
      const assetId = crypto.randomUUID();
      project.assets.push({ id: assetId, type: "model", url: upload.url });
      entities = [
        defineEntity({
          ...entities[0],
          visual: { kind: "model", assetId },
          tags: [`category:${category}`],
          character:
            category === "Character" ? { speed: 5, jumpSpeed: 6 } : null,
          collider:
            category === "Character"
              ? { shape: "capsule", size: { x: 1, y: 2, z: 1 } }
              : { shape: "box", size: { x: 1, y: 1, z: 1 } },
          body: {
            mode: category === "Character" ? "dynamic" : "static",
            rotationLocked: category === "Character",
          },
        }),
      ];
    }
    entities[0].name = name.trim() || upload?.name || item.name;
    entities[0].transform.scale = { x: size, y: size, z: size };
    if (old) {
      // Changing a model keeps the object's gameplay identity and settings.
      entities[0] = {
        ...old,
        name: entities[0].name,
        visual: entities[0].visual,
        tags: [
          ...old.tags.filter((tag) => !tag.startsWith("starter:")),
          ...entities[0].tags.filter((tag) => tag.startsWith("starter:")),
        ],
        transform: { ...old.transform, scale: entities[0].transform.scale },
      };
      const remove = new Set([id]);
      let count = 0;
      while (count !== remove.size) {
        count = remove.size;
        for (const e of project.entities)
          if (e.parentId && remove.has(e.parentId)) remove.add(e.id);
      }
      project.entities = project.entities.filter((e) => !remove.has(e.id));
    }
    project.entities.push(...entities);
    if (await editor.load({ ...editor.game, project })) {
      editor.setSelected(id);
      onAdded();
    } else
      setError(
        "Could not load this model. Check the editor message and choose another file or model.",
      );
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!editor.busy && !uploading) onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content
          className={s.addDialog}
          style={{ fontFamily: nunito.style.fontFamily }}
          onOpenAutoFocus={() => {
            returnFocus.current = document.activeElement as HTMLElement;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
          }}
        >
          <Dialog.Close asChild>
            <IconButton
              className={s.close}
              disabled={editor.busy || uploading}
              aria-label="Close add object"
              icon={<Icon name="close" />}
            />
          </Dialog.Close>
          <div className={s.dialogHeading}>
            <span className={s.eyebrow}>A LITTLE MORE IMAGINATION</span>
            <Dialog.Title>
              {step === 0
                ? "What would you like to add?"
                : step === 1
                  ? "Find your next little thing."
                  : "Make it yours."}
            </Dialog.Title>
            <Dialog.Description>
              {step === 0
                ? "Choose a type. You can change its look next."
                : step === 1
                  ? "Start simple. Build something wonderful."
                  : "Give it a name and a little personality."}
            </Dialog.Description>
          </div>
          {step === 0 && (
            <div className={s.categoryGrid}>
              {categories.map((c, i) => (
                <button
                  className={`${s.categoryCard} ${category === c ? s.selected : ""}`}
                  key={c}
                  onClick={() => setCategory(c)}
                >
                  <Thumbnail
                    src={
                      thumbs[(["player", "flag", "tree", "gem"] as const)[i]]
                    }
                    name={c}
                  />
                  <strong>{c}</strong>
                  <span>{categoryDescriptions[c]}</span>
                  {category === c && (
                    <i>
                      <Icon name="check" />
                    </i>
                  )}
                </button>
              ))}
            </div>
          )}
          {step === 1 && (
            <div className={s.gallery}>
              <div className={s.galleryMain}>
                <div className={s.gallerySearch}>
                  <TextInput
                    label="Search models"
                    type="search"
                    placeholder="Search the starter library…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={uploading}
                    onClick={() => uploadInput.current?.click()}
                    leadingIcon={<Icon name="upload" />}
                  >
                    {uploading ? "Reading…" : "Upload GLB"}
                  </Button>
                </div>
                <div className={s.filters}>
                  {["All", ...categories].map((c) => (
                    <button
                      key={c}
                      aria-pressed={filter === c}
                      onClick={() => setFilter(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div className={s.galleryGrid}>
                  {catalog
                    .filter(
                      (c) =>
                        (filter === "All" || c.category === filter) &&
                        c.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        className={`${s.galleryCard} ${!upload && item.id === c.id ? s.selected : ""}`}
                        onClick={() => {
                          setItem(c);
                          setName(c.name);
                          setUpload(undefined);
                        }}
                      >
                        <Thumbnail src={thumbs[c.id]} name={c.name} />
                        <strong>{c.name}</strong>
                        <small>{c.category}</small>
                      </button>
                    ))}
                </div>
                {!catalog.some(
                  (c) =>
                    (filter === "All" || c.category === filter) &&
                    c.name.toLowerCase().includes(search.toLowerCase()),
                ) && <p>No models match. Try another search.</p>}
              </div>
              <aside className={s.modelPreview}>
                <ModelStudio
                  compact
                  project={previewProject(item, upload)}
                  selected="preview"
                />
                <h3>{upload?.name ?? item.name}</h3>
                <p>
                  {upload
                    ? "Your upload · GLB"
                    : `${item.category} · Starter library`}
                </p>
                <span className={s.modelNote}>
                  {upload
                    ? "Preview loads in your world after adding. Uses a simple collision shape."
                    : "A little piece of your next adventure. Drag the preview to take a look around."}
                </span>
              </aside>
            </div>
          )}
          {step === 2 && (
            <div className={s.customizeNew}>
              <div className={s.newPreview}>
                <ModelStudio
                  compact
                  project={previewProject(item, upload, size)}
                  selected="preview"
                />
              </div>
              <div className={s.fields}>
                <TextInput
                  label="Object name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <Slider
                  label="Starting size"
                  value={size}
                  min={0.2}
                  max={3}
                  step={0.1}
                  onValueChange={setSize}
                  formatValue={(n) => `${n.toFixed(1)}×`}
                />
                <p className={s.help}>
                  You can change its color, position, and physics in Design.
                </p>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className={s.error}>
              {error}
            </p>
          )}
          <input
            hidden
            ref={uploadInput}
            type="file"
            accept=".glb"
            aria-label="Upload GLB model"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const epoch = ++uploadEpoch.current;
              setUploading(true);
              setError("");
              try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                const candidate = structuredClone(editor.game);
                candidate.project.assets.push({
                  id: crypto.randomUUID(),
                  type: "model",
                  url: `data:model/gltf-binary;base64,${await new Promise<string>(
                    (resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () =>
                        resolve(String(reader.result).split(",")[1]);
                      reader.onerror = () =>
                        reject(new Error("Could not read the model."));
                      reader.readAsDataURL(new Blob([bytes]));
                    },
                  )}`,
                });
                const { parseGame } = await import("@bark/scripting/player");
                await parseGame(JSON.stringify(candidate));
                if (epoch !== uploadEpoch.current) return;
                const title = file.name.replace(/\.glb$/i, "");
                setUpload({
                  name: title,
                  url: candidate.project.assets.at(-1)!.url,
                });
                setName(title);
              } catch (e) {
                if (epoch === uploadEpoch.current)
                  setError(e instanceof Error ? e.message : String(e));
              } finally {
                if (epoch === uploadEpoch.current) setUploading(false);
              }
            }}
          />
          <div className={s.dialogFooter}>
            <Button
              variant="outline"
              disabled={editor.busy || uploading}
              onClick={() => {
                if (step === 0 || (replacing && step === 1))
                  onOpenChange(false);
                else setStep(step - 1);
              }}
            >
              {step === 0 || (replacing && step === 1) ? "Cancel" : "Back"}
            </Button>
            <span className={s.steps}>
              {["Type", "Model", "Customize"].map((label, i) => (
                <span className={step === i ? s.currentStep : ""} key={label}>
                  <b>{i + 1}</b>
                  {label}
                </span>
              ))}
            </span>
            <Button
              variant="positive"
              loading={editor.busy || uploading}
              trailingIcon={<Icon name="arrow" />}
              onClick={() => {
                if (step === 0) {
                  setFilter(category);
                  const next = catalog.find((c) => c.category === category)!;
                  setItem(next);
                  setName(next.name);
                  setStep(1);
                } else if (step === 1) setStep(2);
                else void add();
              }}
            >
              {step === 0
                ? "Choose a model"
                : step === 1
                  ? "Customize"
                  : replacing
                    ? "Replace model"
                    : "Add to world"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function previewProject(
  item: CatalogItem,
  upload?: { url: string },
  scale = 1,
) {
  const project = createProject("Preview");
  project.assets = catalogAssets();
  project.entities = makeObject(item, "preview");
  project.entities[0].transform.scale = { x: scale, y: scale, z: scale };
  if (upload) {
    project.assets.push({ id: "upload", type: "model", url: upload.url });
    project.entities[0].visual = { kind: "model", assetId: "upload" };
  }
  return project;
}
