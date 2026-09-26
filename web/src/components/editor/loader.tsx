"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { findGame, gameFile } from "@/components/marketplace/catalog";
import type { Game } from "./use-editor";
const Editor = dynamic(() => import("./editor"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 48, textAlign: "center" }} role="status">
      Opening your workshop…
    </div>
  ),
});
function CatalogEditor({ slug }: { slug: string }) {
  const [game, setGame] = useState<Game>();
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      if (!findGame(slug))
        throw new Error("That world is not in the Bark collection.");
      const response = await fetch(gameFile(slug), { signal: abort.signal });
      if (!response.ok)
        throw new Error("We couldn’t load this world. Please try again.");
      const { parseGame } = await import("@bark/scripting/player");
      const parsed = await parseGame(await response.text(), {
        baseUrl: location.href,
        signal: abort.signal,
      });
      if (!abort.signal.aborted) setGame(parsed);
    })().catch((value: unknown) => {
      if (!abort.signal.aborted)
        setError(value instanceof Error ? value.message : String(value));
    });
    return () => abort.abort();
  }, [slug]);
  if (error)
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <p role="alert">{error}</p>
        <Link href="/games">Back to games</Link>
      </div>
    );
  if (!game)
    return (
      <p role="status" style={{ padding: 48, textAlign: "center" }}>
        Bringing this world into your workshop…
      </p>
    );
  return <Editor initialGame={game} catalogSlug={slug} />;
}
function EditorEntry() {
  const slug = useSearchParams().get("game");
  return slug ? <CatalogEditor key={slug} slug={slug} /> : <Editor />;
}
export function EditorLoader() {
  return (
    <Suspense fallback={<p>Opening your workshop…</p>}>
      <EditorEntry />
    </Suspense>
  );
}
