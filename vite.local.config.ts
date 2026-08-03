import vinext from "vinext";
import { defineConfig } from "vite";
import type { Plugin, ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

function localAppLifecycle(): Plugin {
  let activePages = 0;
  let hasConnectedPage = false;
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;

  return {
    name: "private-media-archive-local-lifecycle",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/__pma/session", (request, response, next) => {
        if (request.method !== "GET") {
          next();
          return;
        }

        hasConnectedPage = true;
        activePages += 1;
        if (shutdownTimer) clearTimeout(shutdownTimer);

        response.writeHead(200, {
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream",
        });
        response.write("data: connected\n\n");

        const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 15000);
        request.on("close", () => {
          clearInterval(keepAlive);
          activePages = Math.max(0, activePages - 1);
          if (!hasConnectedPage || activePages > 0) return;

          shutdownTimer = setTimeout(() => {
            if (activePages > 0) return;
            void server.close().finally(() => process.exit(0));
          }, 5000);
        });
      });
    },
  };
}

// Local-only development config. The full Vite config also starts a
// Cloudflare Workers emulator, which is useful for deployment work but is not
// needed for this app's browser-local archive and Douban route handlers.
export default defineConfig({
  root: projectRoot,
  plugins: [localAppLifecycle(), vinext({ appDir: projectRoot })],
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./build/local-cloudflare-workers.ts", import.meta.url),
      ),
    },
  },
});
