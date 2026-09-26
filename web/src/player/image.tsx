import type { CSSProperties } from "react";
// The standalone frame uses ordinary static images, without Next's image proxy.
export default function Image({ src, alt, fill, width, height, className }: { src: string; alt: string; fill?: boolean; width?: number; height?: number; className?: string; sizes?: string; preload?: boolean; unoptimized?: boolean }) {
  const style: CSSProperties | undefined = fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" } : undefined;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={width} height={height} className={className} style={style} crossOrigin="anonymous" />;
}
