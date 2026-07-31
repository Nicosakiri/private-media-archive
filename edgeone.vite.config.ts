import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(import.meta.dirname, "edgeone-app"),
  publicDir: resolve(import.meta.dirname, "public"),
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, "edgeone-dist"),
    emptyOutDir: true,
  },
});
