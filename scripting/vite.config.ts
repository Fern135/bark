import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => ({
  base: mode === "library" ? "./" : "/",
  server: { hmr: process.env.BARK_TEST_MODE === "1" ? false : undefined },
  plugins: [react()],
  worker: { format: "es" },
  build:
    mode === "library"
      ? {
          outDir: "dist",
          copyPublicDir: false,
          lib: {
            entry: {
              index: resolve("src/index.ts"),
              blocks: resolve("src/blocks.ts"),
              engine: resolve("src/engine.ts"),
            },
            formats: ["es"],
          },
          rolldownOptions: { external: [/^@bark\/engine/, /^blockly/] },
        }
      : { outDir: "dist-playground" },
}));
