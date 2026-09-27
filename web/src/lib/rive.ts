import { RuntimeLoader } from "@rive-app/canvas";

// Both renderers are served by Bark, including the fallback for older browsers.
RuntimeLoader.setWasmUrl("/runtime/rive.wasm");
RuntimeLoader.setWasmFallbackUrl("/runtime/rive_fallback.wasm");

export { Alignment, Fit, Layout, Rive, RuntimeLoader } from "@rive-app/canvas";
