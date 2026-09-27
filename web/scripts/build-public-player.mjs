import { build } from "../../engine/node_modules/vite/dist/node/index.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  configFile: false, root, publicDir: false,
  resolve: { alias: { "@": resolve(root, "src"), "next/image": resolve(root, "src/player/image.tsx") }, dedupe: ["react", "react-dom"] },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  esbuild: { jsx: "automatic" },
  build: { outDir: "public/community-runtime", emptyOutDir: true, cssCodeSplit: false,
    lib: { entry: resolve(root, "src/player/entry.tsx"), formats: ["es"], fileName: () => "player.js" },
    rolldownOptions: { onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); }, output: { codeSplitting: false } },
  },
});
