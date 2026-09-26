import { Suspense } from "react";
import type { Metadata } from "next";
import { nunito } from "@/lib/fonts";
import Marketplace from "@/components/marketplace/marketplace";
export const metadata: Metadata = {
  title: "Explore games — Bark",
  description:
    "Little worlds. Big possibilities. Find your next adventure in the Bark game collection.",
};
export default function GamesPage() {
  return (
    <div className={nunito.className}>
      <Suspense
        fallback={<p style={{ padding: 40 }}>Finding your next adventure…</p>}
      >
        <Marketplace />
      </Suspense>
    </div>
  );
}
