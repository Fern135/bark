import Image from "next/image";
import type { ByteSuggestion } from "@/lib/byte-hints";
import s from "./byte-hint.module.css";

export function ByteHint({ suggestion, dismiss }: { suggestion: ByteSuggestion | null; dismiss: () => void }) {
  return <div className={s.byte}>
    <div role="status" aria-live="polite" aria-atomic="true">
      {suggestion && <section className={s.card} aria-label="Byte suggestion" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); dismiss(); } }}>
        <strong>Byte’s tip</strong>
        <button type="button" aria-label="Dismiss Byte suggestion" onClick={dismiss}>×</button>
        <p>{suggestion.message}</p>
      </section>}
    </div>
    <Image src="/images/editor/byte-peek.png" alt="" width={132} height={132} className={s.mascot} />
  </div>;
}

export function ByteToggle({ enabled, signedIn, toggle }: { enabled: boolean; signedIn: boolean; toggle: (value: boolean) => void }) {
  if (!signedIn) return null;
  return <div className={s.toggle}>
    <label><input type="checkbox" checked={enabled} onChange={(event) => toggle(event.target.checked)} /> Byte hints</label>
    <span>Uses OpenAI to review code</span>
  </div>;
}
