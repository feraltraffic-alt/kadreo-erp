import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `vite build --mode demo` produces one self-contained HTML file (scripts, styles and fonts
// inlined) for the clickable demo page; the regular build emits normal hashed assets.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === "demo" ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
  base: "./",
  server: { port: 5173 },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2500,
    outDir: mode === "demo" ? "dist-demo" : "dist",
    ...(mode === "demo" ? { assetsInlineLimit: 100_000_000 } : {}),
  },
}));
