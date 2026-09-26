import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-test",
    rolldownOptions: {
      input: fileURLToPath(new URL("./test/index.html", import.meta.url)),
    },
  },
});
