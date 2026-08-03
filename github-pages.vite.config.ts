import { createHash } from "node:crypto";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const pagesBase = "/private-media-archive/";

function offlineWorker(): Plugin {
  return {
    name: "private-media-archive-offline-worker",
    generateBundle(_, bundle) {
      const generatedFiles = Object.keys(bundle).filter(
        (file) => !file.endsWith(".map") && file !== "sw.js",
      );
      const publicFiles = [
        "favicon.svg",
        "manifest.webmanifest",
        "nicosakiri-avatar.png",
        "pma-icon.svg",
        "world-countries.geojson",
      ];
      const files = Array.from(new Set(["", "index.html", ...generatedFiles, ...publicFiles]));
      const version = createHash("sha256")
        .update(generatedFiles.sort().join("|"))
        .digest("hex")
        .slice(0, 12);
      const source = `
const CACHE_NAME = ${JSON.stringify(`pma-${version}`)};
const APP_FILES = ${JSON.stringify(files)};
const scopeUrl = new URL(self.registration.scope);
const scoped = (file) => new URL(file || "./", scopeUrl).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES.map(scoped)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("pma-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(scoped(""), copy));
          return response;
        })
        .catch(() => caches.match(scoped(""))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  base: pagesBase,
  root: resolve(import.meta.dirname, "edgeone-app"),
  publicDir: resolve(import.meta.dirname, "public"),
  plugins: [react(), offlineWorker()],
  build: {
    outDir: resolve(import.meta.dirname, "github-pages"),
    emptyOutDir: true,
  },
});
