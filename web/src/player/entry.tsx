import { createRoot } from "react-dom/client";
import { GameCanvas } from "../components/marketplace/player";
import type { PublicGameDetail } from "../lib/marketplace";
import css from "../components/marketplace/marketplace.module.css?inline";
import uiCss from "../components/ui/ui.module.css?inline";
import foundations from "../app/globals.css?inline";

// CSS Modules' styles are also emitted by Vite; inject that bundle from the static build.
let connected = false;
window.addEventListener("message", (event) => {
  if (connected || event.source !== parent || event.data?.type !== "bark-player-connect" || !event.ports[0]) return;
  connected = true;
  const port = event.ports[0];
  port.onmessage = ({ data }: MessageEvent<{ type: string; game: PublicGameDetail; origin: string }>) => {
    if (data.type !== "load") return;
    port.close();
    const style = document.createElement("style"); style.textContent = `${foundations}\n${css}\n${uiCss}`; document.head.append(style);
    const game = data.game;
    createRoot(document.getElementById("player")!).render(<GameCanvas game={{ slug: game.id, title: game.name }} document={game.document} runtimeBase={data.origin} isolated />);
  };
});
parent.postMessage({ type: "bark-player-ready" }, "*");
