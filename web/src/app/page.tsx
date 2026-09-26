import type { Metadata } from "next";
import { nunito } from "@/lib/fonts";
import { Landing } from "@/components/landing/landing";

export const metadata: Metadata = {
  title: "Bark — Big ideas. Little blocks. Your world.",
  description: "A little imagination goes a long way. Explore Bark, meet Byte, and try a playful game creation demo right in your browser.",
};
export default function Home() {
  return <div className={nunito.className}><Landing /></div>;
}
