import { randomInt } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, hostname, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import {
  mergeArchives,
  parseArchive,
  type LocalArchive,
} from "../app/sync-model";

type StoredSnapshot = {
  revision: number;
  updatedAt: string;
  archive: LocalArchive;
};

const snapshotPath = join(
  homedir(),
  "Library",
  "Application Support",
  "Private Media Archive",
  "lan-sync.json",
);

function isLoopback(request: IncomingMessage) {
  const address = request.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function localUrls(port: number) {
  const addresses = new Set<string>();
  const localName = hostname();
  if (localName) {
    addresses.add(
      `http://${localName.endsWith(".local") ? localName : `${localName}.local`}:${port}`,
    );
  }
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === "IPv4" && !item.internal) {
        addresses.add(`http://${item.address}:${port}`);
      }
    }
  }
  return Array.from(addresses);
}

function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 80 * 1024 * 1024) {
      throw new Error("同步包超过 80MB，请先减少或压缩图片。");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readSnapshot() {
  try {
    const parsed = JSON.parse(await readFile(snapshotPath, "utf8")) as StoredSnapshot;
    return {
      revision: Number(parsed.revision) || 0,
      updatedAt: parsed.updatedAt || "",
      archive: parseArchive(parsed.archive),
    } satisfies StoredSnapshot;
  } catch {
    return null;
  }
}

async function saveSnapshot(snapshot: StoredSnapshot) {
  await mkdir(dirname(snapshotPath), { recursive: true });
  const temporaryPath = `${snapshotPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(snapshot), "utf8");
  await rename(temporaryPath, snapshotPath);
}

export function localSyncServer(): Plugin {
  const pairingCode = String(randomInt(0, 1_000_000)).padStart(6, "0");
  let snapshotPromise = readSnapshot();

  return {
    name: "private-media-archive-lan-sync",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/__pma/sync", async (request, response, next) => {
        const path = (request.url || "/").split("?")[0];
        const hostRequest = isLoopback(request);
        const suppliedCode = request.headers["x-pma-pairing-code"];
        const authorized = hostRequest || suppliedCode === pairingCode;

        if (request.method === "OPTIONS") {
          response.writeHead(204);
          response.end();
          return;
        }

        try {
          if (request.method === "GET" && path === "/status") {
            const snapshot = await snapshotPromise;
            const port = Number(server.config.server.port) || 4317;
            json(response, {
              available: true,
              isHost: hostRequest,
              pairingCode: hostRequest ? pairingCode : null,
              urls: hostRequest ? localUrls(port) : [],
              revision: snapshot?.revision || 0,
              updatedAt: snapshot?.updatedAt || "",
              entryCount: snapshot?.archive.entries.length || 0,
            });
            return;
          }

          if (!authorized) {
            json(response, { error: "配对码不正确，请查看电脑上的同步窗口。" }, 401);
            return;
          }

          if (request.method === "GET" && path === "/pull") {
            const snapshot = await snapshotPromise;
            if (!snapshot) {
              json(response, { error: "电脑端还没有准备同步数据。" }, 404);
              return;
            }
            json(response, snapshot);
            return;
          }

          if (request.method === "POST" && path === "/merge") {
            const body = await readJsonBody(request);
            const incoming = parseArchive(body?.archive);
            const current = await snapshotPromise;
            const archive = current
              ? mergeArchives(current.archive, incoming)
              : incoming;
            const nextSnapshot: StoredSnapshot = {
              revision: (current?.revision || 0) + 1,
              updatedAt: new Date().toISOString(),
              archive,
            };
            snapshotPromise = Promise.resolve(nextSnapshot);
            await saveSnapshot(nextSnapshot);
            json(response, nextSnapshot);
            return;
          }

          next();
        } catch (error) {
          json(
            response,
            {
              error: error instanceof Error ? error.message : "局域网同步失败。",
            },
            400,
          );
        }
      });
    },
  };
}
