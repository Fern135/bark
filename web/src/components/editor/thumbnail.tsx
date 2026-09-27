import Image from "next/image";
import s from "./editor.module.css";
import { Icon } from "@/components/ui/icon";
export function Thumbnail({ src, name }: { src?: string; name: string }) {
  // Thumbnails come directly from the same engine and catalog as the viewport.
  return src ? (
    <Image
      src={src}
      alt=""
      data-model={name}
      draggable={false}
      width={240}
      height={200}
      unoptimized
    />
  ) : (
    <span className={s.thumbFallback} aria-label={name}>
      <Icon name="cube" size={34} />
    </span>
  );
}
