import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    target: "es2022",
    assetsInlineLimit: 0, // keep asset URLs stable for the wails asset server
  },
  // Vitest picks up its own config from vitest.config.ts.
});
