import type { Metadata } from "next";
import { nunito } from "@/lib/fonts";
import { EditorLoader } from "@/components/editor/loader";

export const metadata: Metadata = {
  title: "Bark — Make a world",
  description: "Build, code, and play your own little world.",
};
export default function EditorPage() {
  return (
    <div className={nunito.className}>
      <EditorLoader />
    </div>
  );
}
