import { useEffect, useState } from "react";
import type { Diagnostic } from "@bark/scripting";
import type { Game } from "./use-editor";
import { explainDiagnostic, reviewProject, type ByteReview } from "./byte-tips";

export function useByteReview(game: Game, selected: string | null, diagnostic?: Diagnostic) {
  const [review, setReview] = useState<ByteReview>({ tips: [] });
  useEffect(() => {
    const timer = setTimeout(() => setReview(reviewProject(game, selected)), 450);
    return () => clearTimeout(timer);
  }, [game, selected]);
  return diagnostic ? { diagnostic, tips: [explainDiagnostic(diagnostic)] } : review;
}
