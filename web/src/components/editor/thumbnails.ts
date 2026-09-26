import { createProject, createRuntime } from "@bark/engine";
import { catalog, makeObject, catalogAssets, starterGame } from "./catalog";

let thumbnails: Promise<Record<string, string>> | undefined;
export function renderThumbnails() {
  if (!new URLSearchParams(location.search).has("renderThumbnails")) {
    return Promise.resolve(
      Object.fromEntries([
        ...catalog.map((item) => [
          item.id,
          `/models/starter/thumbnails/${item.id}.png`,
        ]),
        ["world", "/models/starter/thumbnails/world.png"],
      ]),
    );
  }
  if (thumbnails) return thumbnails;
  thumbnails = (async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 200;
    canvas.style.cssText =
      "position:fixed;left:-1000px;top:0;width:240px;height:200px;pointer-events:none";
    canvas.setAttribute("aria-hidden", "true");
    document.body.append(canvas);
    const result: Record<string, string> = {};
    try {
      const runtime = await createRuntime({
        canvas,
        havokWasmUrl: "/runtime/HavokPhysics.wasm",
      });
      try {
        for (const item of catalog) {
          const project = createProject(item.name);
          project.entities = makeObject(item, "preview");
          project.assets = catalogAssets().filter(
            (a) => a.id === `starter-${item.id}`,
          );
          project.settings = {
            ...project.settings,
            background: "#FFFFFF",
            shadows: false,
            ambientIntensity: 0.75,
            sunIntensity: 1,
          };
          project.cameras.fieldOfView = 42;
          await runtime.load(project);
          runtime.cameras.frame("preview", 1.05);
          for (let frame = 0; frame < 12; frame++)
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          result[item.id] = canvas.toDataURL("image/png");
        }
        const world = starterGame().project;
        world.settings.background = "#FFFFFF";
        await runtime.load(world);
        runtime.cameras.frame();
        for (let frame = 0; frame < 12; frame++)
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        result.world = canvas.toDataURL("image/png");
      } finally {
        runtime.dispose();
      }
    } finally {
      canvas.remove();
    }
    return result;
  })().catch((error) => {
    thumbnails = undefined;
    throw error;
  });
  return thumbnails;
}
