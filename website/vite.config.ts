import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served from GitHub Pages at /storage/. scripts/prerender.mjs renders every
// route into dist/ after this build.
export default defineConfig({
  plugins: [react()],
  base: "/storage/",
  build: { outDir: "dist", emptyOutDir: true },
});
