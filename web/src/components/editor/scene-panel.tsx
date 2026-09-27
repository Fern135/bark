import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Thumbnail } from "./thumbnail";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import type { EditorState } from "./editor-types";
import s from "./editor.module.css";
export function ScenePanel({
  editor,
  thumbs,
  onAdd,
}: {
  editor: EditorState;
  thumbs: Record<string, string>;
  onAdd(): void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [gridHeight, setGridHeight] = useState(420);
  const [pageRequest, setPageRequest] = useState<{
    selected: string | null;
    capacity: number;
    page: number;
  }>();
  useEffect(() => {
    const node = grid.current!;
    const observer = new ResizeObserver(() => setGridHeight(node.clientHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const objects = editor.game.project.entities
    .filter((entity) => !entity.parentId)
    .sort((a, b) => Number(a.tags.includes("ground")) - Number(b.tags.includes("ground")));
  const capacity = Math.max(4, Math.floor((gridHeight + 8) / 72) * 4);
  const pageCount = Math.max(1, Math.ceil(objects.length / capacity));
  const selectedPage = Math.max(0, Math.floor(objects.findIndex((entity) => entity.id === editor.selected) / capacity));
  const page = Math.min(pageCount - 1,
    pageRequest?.selected === editor.selected && pageRequest.capacity === capacity
      ? pageRequest.page : selectedPage);
  const visible = objects.slice(page * capacity, (page + 1) * capacity);
  const rows = Math.max(1, Math.ceil(visible.length / 4));
  return (
    <section className={`${s.panel} ${s.scenePanel}`} aria-label="Scene objects">
      <div className={s.panelHeading}>
        <Icon name="cube" />
        <h2>Scene</h2>
        <span>
          {objects.length}
        </span>
      </div>
      <button
        className={`${s.worldCard} ${editor.selected === null ? s.selected : ""}`}
        onClick={() => editor.setSelected(null)}
      >
        <span className={s.worldIcon}>
          <Image
            src="/images/editor/world-badge.png"
            alt=""
            width={140}
            height={110}
            unoptimized
          />
        </span>
        <span>
          <strong>World</strong>
          <small>Global code & settings</small>
        </span>
        <Icon name="spark" />
      </button>
      <div className={s.objectHeading}>
        <span>Objects</span>
        {pageCount > 1 && <nav className={s.objectPages} aria-label="Scene object pages">
          <button aria-label="Previous objects" disabled={page === 0} onClick={() => setPageRequest({ selected: editor.selected, capacity, page: page - 1 })}>
            <Icon name="chevron" style={{ rotate: "90deg" }} size={15} />
          </button>
          <span aria-live="polite">{page + 1} / {pageCount}</span>
          <button aria-label="Next objects" disabled={page === pageCount - 1} onClick={() => setPageRequest({ selected: editor.selected, capacity, page: page + 1 })}>
            <Icon name="chevron" style={{ rotate: "-90deg" }} size={15} />
          </button>
        </nav>}
      </div>
      <div ref={grid} className={s.objectGrid} style={{ gridAutoRows: Math.max(0, Math.min(104, (gridHeight - (rows - 1) * 8) / rows)) }}>
        {visible.map((entity) => {
            const key = entity.tags
              .find((tag) => tag.startsWith("starter:"))
              ?.slice(8);
            return (
              <motion.div
                key={entity.id}
                whileHover={{ y: -3 }}
                className={s.objectTile}
              >
              <button
                className={`${s.objectCard} ${entity.id === editor.selected ? s.selected : ""}`}
                aria-pressed={entity.id === editor.selected}
                onClick={() => editor.setSelected(entity.id)}
              >
                <Thumbnail
                  src={
                    key
                      ? thumbs[key]
                      : entity.tags.includes("ground")
                        ? thumbs.world
                        : undefined
                  }
                  name={entity.name}
                />
                <span>{entity.name}</span>
              </button>
              <button
                className={s.objectTrash}
                aria-label={`Delete ${entity.name}`}
                title={`Delete ${entity.name}`}
                disabled={editor.lock}
                onClick={() => editor.remove(entity.id)}
              ><Icon name="trash" size={14} /></button>
              </motion.div>
            );
          })}
      </div>
      <Button
        variant="outline"
        className={s.wide}
        disabled={editor.lock}
        leadingIcon={<Icon name="plus" />}
        onClick={onAdd}
      >
        Add object
      </Button>
    </section>
  );
}
