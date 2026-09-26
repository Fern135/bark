import { createRuntime } from "@bark/engine";
import type { RuntimeOptions } from "@bark/engine";
import { createEngineAdapter } from "./engine.js";
import { createScriptingSession } from "./session.js";
import { checkCancelled } from "./game-file.js";
import { createPlayerController } from "./player-controller.js";
import type { GamePlayer } from "./player-controller.js";

export { parseGame, serializeGame, GameFileError } from "./game-file.js";
export type { GameFile, GameFileOptions } from "./game-file.js";
export type { GamePlayer, PlayerStatus, PlayerSnapshot, PlayerOutput } from "./player-controller.js";
export interface GamePlayerOptions extends RuntimeOptions { pythonRuntimeUrl: string }

export async function createGamePlayer(options: GamePlayerOptions): Promise<GamePlayer> {
  const runtime = await createRuntime(options);
  try {
    checkCancelled(options.signal);
    const session = createScriptingSession(createEngineAdapter(runtime, {
      hasFocus: () => options.canvas.ownerDocument.activeElement === options.canvas && options.canvas.ownerDocument.hasFocus(),
    }), { runtimeUrl: options.pythonRuntimeUrl });
    const player = createPlayerController(runtime, session);
    const blur = () => session.clearMovement();
    options.canvas.addEventListener("blur", blur);
    const dispose = player.dispose;
    player.dispose = () => { options.canvas.removeEventListener("blur", blur); dispose(); };
    return player;
  } catch (error) { runtime.dispose(); throw error; }
}
